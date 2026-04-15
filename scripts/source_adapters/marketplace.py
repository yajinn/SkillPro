"""Adapter for Claude Code-style marketplace.json sources.

Supports two schema shapes:

**Shape A — Self-authored (SkillForge-native)**
Each plugin has a `skills` array of dict objects that carry full scoring
metadata (tags, boost_when, penalize_when, default_for, match_language, ...).
Used by test fixtures and by marketplaces that publish SkillForge-aware skills.

```
{
  "plugins": [{
    "name": "...",
    "skills": [{"id": "...", "tags": [...], "default_for": [...], ...}]
  }]
}
```

**Shape B — Real Claude Code ecosystem**
Each plugin has a `skills` array of string paths pointing at skill
directories. The adapter fetches each SKILL.md, parses its YAML frontmatter
(name + description), and INFERS scoring metadata from the description
using keyword heuristics in `infer_tags`.

```
{
  "plugins": [{
    "name": "...",
    "source": "./",
    "skills": ["./skills/xlsx", "./skills/docx"]
  }]
}
```

The adapter auto-detects the shape per-skill (dict vs string) and handles
each skill independently, so a marketplace could legally mix both.
"""
from __future__ import annotations

import concurrent.futures
import json
import os
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .base import HttpGet, SkillEntry, parse_json_bytes


# ---------------------------------------------------------------------------
# Heuristic keyword -> tag mapping for Shape B (description-based inference)
# ---------------------------------------------------------------------------

# Each tuple: (characteristic_flag, [keyword_regexes])
# Order matters: later entries can compound (multiple tags per skill).
TAG_KEYWORDS: List[Tuple[str, List[str]]] = [
    ("has_web", [r"\bweb\b", r"\bwebsite\b", r"\blanding page\b", r"\bhtml\b",
                 r"\bcss\b", r"\bdashboard\b", r"\bbrowser\b"]),
    ("has_api", [r"\bapi\b", r"\brest\b", r"\bgraphql\b", r"\bendpoint\b",
                 r"\bopenapi\b", r"\bgrpc\b", r"\bwebhook\b"]),
    ("has_mobile_ui", [r"\bmobile\b", r"\bios\b", r"\bandroid\b",
                       r"\bflutter\b", r"\breact native\b", r"\bswift\b",
                       r"\bkotlin\b"]),
    ("has_ui", [r"\bui\b", r"\binterface\b", r"\bcomponent\b", r"\bfrontend\b",
                r"\blayout\b", r"\bdesign\b", r"\bvisual\b"]),
    ("has_db", [r"\bdatabase\b", r"\bsql\b", r"\bpostgres\b", r"\bmysql\b",
                r"\bmongo\b", r"\bsqlite\b", r"\bschema\b", r"\bmigration\b"]),
    ("handles_auth", [r"\bauth\b", r"\boauth\b", r"\bjwt\b", r"\btoken\b",
                      r"\blogin\b", r"\bcredential\b", r"\bsaml\b"]),
    ("has_user_input", [r"\bform\b", r"\binput\b", r"\bvalidation\b",
                        r"\buser data\b", r"\bupload\b"]),
    ("serves_traffic", [r"\bserver\b", r"\bhttp\b", r"\bproduction\b",
                        r"\bdeployment\b", r"\btraffic\b"]),
    ("serves_public", [r"\bpublic\b", r"\busers\b", r"\baccessibility\b",
                       r"\bseo\b", r"\bmarketing\b"]),
    ("has_docker", [r"\bdocker\b", r"\bcontainer\b", r"\bkubernetes\b", r"\bk8s\b"]),
    ("has_i18n", [r"\bi18n\b", r"\bl10n\b", r"\blocalization\b",
                  r"\binternationalization\b", r"\btranslation\b", r"\blocale\b"]),
    ("has_ecommerce", [r"\becommerce\b", r"\bstripe\b", r"\bcheckout\b",
                       r"\bpayment\b", r"\bshopping cart\b"]),
    ("data_pipeline", [r"\bdata pipeline\b", r"\bjupyter\b", r"\betl\b",
                       r"\bml\b", r"\bmodel training\b", r"\bnotebook\b"]),
    ("cli_only", [r"\bcli\b", r"\bcommand.line\b", r"\bterminal\b", r"\bshell tool\b"]),
]

# Map description keywords to default_for project types.
PROJECT_TYPE_KEYWORDS: List[Tuple[str, List[str]]] = [
    ("mobile", [r"\bmobile\b", r"\bios\b", r"\bandroid\b", r"\bflutter\b",
                r"\breact native\b"]),
    ("web-frontend", [r"\bfrontend\b", r"\bwebsite\b", r"\blanding page\b",
                      r"\bdashboard\b", r"\bcomponent\b"]),
    ("backend-api", [r"\bapi\b", r"\bbackend\b", r"\bserver\b", r"\bmicroservice\b"]),
    ("cli-tool", [r"\bcli\b", r"\bcommand.line\b", r"\bterminal\b"]),
    ("data-ml", [r"\bjupyter\b", r"\bml\b", r"\bnotebook\b", r"\bdata pipeline\b"]),
]

# Language keyword → match_language
LANGUAGE_KEYWORDS: List[Tuple[str, List[str]]] = [
    ("python", [r"\bpython\b", r"\bpep.?8\b", r"\bdjango\b", r"\bfastapi\b"]),
    ("typescript", [r"\btypescript\b", r"\btsconfig\b"]),
    ("javascript", [r"\bjavascript\b", r"\bnode\.js\b"]),
    ("dart", [r"\bdart\b", r"\bflutter\b"]),
    ("go", [r"\bgolang\b", r"\bgo 1\.\d"]),
    ("rust", [r"\brust\b", r"\bcargo\b"]),
    ("php", [r"\bphp\b", r"\bcomposer\b", r"\blaravel\b", r"\bwordpress\b"]),
    ("ruby", [r"\bruby\b", r"\brails\b"]),
]


# Category taxonomy — flat, single-level. Order matters: the first
# matching category wins. More specific categories precede general ones.
# Used by render-layer grouping (clustering.py), never affects scoring.
CATEGORY_KEYWORDS: List[Tuple[str, List[str]]] = [
    ("language/python",        [r"\bpep.?8\b", r"\bpytest\b", r"\bpython\s+best\b", r"\bmodern\s+python\b", r"\basyncio\b"]),
    ("language/dart",          [r"\bdart\s+code\b", r"\bdart\s+best\b", r"\beffective\s+dart\b"]),
    ("language/go",            [r"\bgolang\b", r"\beffective\s+go\b", r"\bgoroutine\b"]),
    ("language/rust",          [r"\bcargo\b", r"\bclippy\b", r"\brust\s+ownership\b"]),
    ("language/ruby",          [r"\brubocop\b", r"\bruby\s+best\b"]),
    ("language/php",           [r"\bpsr-?12\b", r"\bphp\s+best\b", r"\bphpstan\b"]),
    ("language/javascript",    [r"\bnode\.?js\b", r"\bjs\s+best\b"]),
    ("language/typescript",    [r"\btsconfig\b", r"\btypescript\s+strict\b"]),
    ("framework/flutter",      [r"\bflutter\s+widget\b", r"\bwidget\s+tree\b", r"\bflutter\s+state\b"]),
    ("framework/react-native", [r"\breact\s+native\b", r"\bexpo\b", r"\bflatlist\b"]),
    ("framework/nextjs",       [r"\bnext\.?js\b", r"\bapp\s+router\b", r"\brsc\b"]),
    ("framework/fastapi",      [r"\bfastapi\b"]),
    ("framework/django",       [r"\bdjango\b", r"\bdrf\b"]),
    ("framework/wordpress",    [r"\bwordpress\b", r"\bwp-"]),
    ("framework/laravel",      [r"\blaravel\b", r"\beloquent\b"]),
    ("framework/rails",        [r"\brails\b", r"\bactiverecord\b"]),
    ("quality/review",         [r"\bcode\s+review\b", r"\badversarial\s+review\b", r"\bedge\s+case\s+hunt\b", r"\bcynical\s+review\b"]),
    ("quality/testing",        [r"\bfuzzer?\b", r"\be2e\s+test\b", r"\bunit\s+test\b", r"\bintegration\s+test\b"]),
    ("quality/lint",           [r"\blinter\b", r"\bformatter\b", r"\bstyle\s+check\b"]),
    ("security",               [r"\bsecurity\s+audit\b", r"\bvulnerability\b", r"\bencrypt", r"\bcrypto", r"\bauth\s+best\b", r"\bsecret\s+detect"]),
    ("planning/architecture",  [r"\barchitecture\b", r"\bsystem\s+design\b", r"\bsolution\s+design\b"]),
    ("planning/requirements",  [r"\bprd\b", r"\bproduct\s+requirement\b", r"\bproduct\s+brief\b"]),
    ("planning/methodology",   [r"\bbrainstorm", r"\bideation\b", r"\bsprint\b", r"\bretrospective\b", r"\bmethodology\b"]),
    ("docs/office",            [r"\bspreadsheet\b", r"\bxlsx?\b", r"\bexcel\b", r"\bword\s+doc", r"\bdocx?\b", r"\bpowerpoint\b", r"\bpptx\b", r"\bpdf\b"]),
    ("docs/prose",             [r"\bcopy.?edit", r"\bprose\b", r"\beditorial\b"]),
    ("design/frontend",        [r"\bfrontend\s+design\b", r"\bui\s+design\b", r"\bcomponent\s+design\b", r"\bbrand\s+guideline\b"]),
    ("design/visual",          [r"\bvisual\s+art\b", r"\bcanvas\s+design\b", r"\bgenerative\s+art\b", r"\balgorithmic\s+art\b"]),
    ("mobile/deploy",          [r"\bapp\s+store\b", r"\bplay\s+store\b", r"\bios\s+deploy", r"\bota\b"]),
    ("mobile/simulator",       [r"\bsimulator\b", r"\bemulator\b"]),
    ("infrastructure/docker",  [r"\bdocker\b", r"\bcontainer\b", r"\bkubernetes\b"]),
    ("infrastructure/devcontainer", [r"\bdevcontainer\b"]),
    ("infrastructure/ci",      [r"\bci/?cd\b", r"\bgithub\s+actions\b", r"\bpipeline\b"]),
    ("operations/observability", [r"\bobservab", r"\btracing\b", r"\bmetrics\b", r"\bstructured\s+log"]),
    ("operations/crash",       [r"\bcrash\s+report", r"\bsentry\b", r"\bcrashlytics\b", r"\bsymbolication\b"]),
    ("database",               [r"\bdatabase\b", r"\bsql\b", r"\bpostgres\b", r"\bfirestore\b", r"\bmongo\b"]),
    ("meta/skill-authoring",   [r"\bskill\s+creator\b", r"\bmcp\s+build", r"\bclaude\s+api\b"]),
]


def infer_category(description: str, name: str = "") -> Optional[str]:
    """Pick a single category for a skill from its description + name.

    Returns None if nothing matched — caller may set it to "general"
    or leave it unassigned for the "other" bucket in the UI.
    """
    text = (description + " " + name).lower()
    for category, patterns in CATEGORY_KEYWORDS:
        if any(re.search(p, text) for p in patterns):
            return category
    return None


def infer_tags(description: str, name: str = "") -> dict:
    """From a SKILL.md description, infer scoring metadata.

    Returns a dict with the same keys the scoring engine reads:
        tags, default_for, match_language, match_framework
    """
    text = (description + " " + name).lower()
    tags = []
    for flag, patterns in TAG_KEYWORDS:
        if any(re.search(p, text) for p in patterns):
            tags.append(flag)

    default_for = []
    for project_type, patterns in PROJECT_TYPE_KEYWORDS:
        if any(re.search(p, text) for p in patterns):
            default_for.append(project_type)

    match_language: Optional[str] = None
    for lang, patterns in LANGUAGE_KEYWORDS:
        if any(re.search(p, text) for p in patterns):
            match_language = lang
            break

    return {
        "tags": tags,
        "boost_when": [],
        "penalize_when": [],
        "default_for": default_for,
        "match_language": match_language,
        "match_framework": None,
        "match_sub_framework": None,
    }


# ---------------------------------------------------------------------------
# SKILL.md frontmatter parser (stdlib-only, no PyYAML)
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Enrichment layer — community-curated metadata overlay
# ---------------------------------------------------------------------------
# After heuristic inference produces a SkillEntry from a real SKILL.md, the
# adapter looks up the skill's id in an enrichment dict and merges any
# hand-curated fields on top. This lets the community override noisy
# inference with accurate metadata for known skills, without touching the
# adapter code.
#
# Merge semantics per field:
#   - tags, boost_when, penalize_when, default_for: enrichment fields
#     REPLACE the inferred list when the enrichment provides a non-None
#     value. (Union would double-count tags; replace is deterministic.)
#   - match_language, match_framework, match_sub_framework: enrichment
#     replaces inference if non-None.
#
# Lookup order (first hit wins):
#   1. ~/.claude/skillforge/enrichment.json (user override, full replace)
#   2. config/enrichment.json in the repo (built-in)
#   3. no enrichment

_ENRICHMENT_CACHE: Optional[Dict[str, Any]] = None

# Process-wide circuit breaker for GitHub Trees API rate limiting.
# Once we see a 403/429 from the API, subsequent tree calls in the same
# refresh short-circuit to empty, avoiding the "rapid-fire 60 failed
# requests" pattern that was filling stderr with noise. Reset between
# runs (module unload / fresh process).
_TREE_API_RATE_LIMITED = False


def _reset_tree_api_rate_limit() -> None:
    global _TREE_API_RATE_LIMITED
    _TREE_API_RATE_LIMITED = False


def _load_enrichment() -> Dict[str, Any]:
    global _ENRICHMENT_CACHE
    if _ENRICHMENT_CACHE is not None:
        return _ENRICHMENT_CACHE

    candidates = [
        Path(os.path.expanduser("~/.claude/skillforge/enrichment.json")),
        Path(__file__).resolve().parent.parent.parent / "config" / "enrichment.json",
    ]
    for path in candidates:
        if path.exists():
            try:
                with open(path) as f:
                    doc = json.load(f)
                _ENRICHMENT_CACHE = doc.get("enrichment", {}) or {}
                return _ENRICHMENT_CACHE
            except (json.JSONDecodeError, OSError) as exc:
                print(
                    f"[marketplace] enrichment load failed at {path}: {exc}",
                    file=sys.stderr,
                )
    _ENRICHMENT_CACHE = {}
    return _ENRICHMENT_CACHE


def _reset_enrichment_cache() -> None:
    """Used by tests to force re-load between cases."""
    global _ENRICHMENT_CACHE
    _ENRICHMENT_CACHE = None


def apply_enrichment(entry: SkillEntry) -> SkillEntry:
    """Merge enrichment metadata on top of an inferred SkillEntry."""
    enrichment = _load_enrichment()
    overlay = enrichment.get(entry.id)
    if not overlay:
        return entry
    return SkillEntry(
        id=entry.id,
        name=entry.name,
        description=entry.description,
        tags=list(overlay["tags"]) if "tags" in overlay and overlay["tags"] is not None else entry.tags,
        boost_when=list(overlay["boost_when"]) if "boost_when" in overlay and overlay["boost_when"] is not None else entry.boost_when,
        penalize_when=list(overlay["penalize_when"]) if "penalize_when" in overlay and overlay["penalize_when"] is not None else entry.penalize_when,
        default_for=list(overlay["default_for"]) if "default_for" in overlay and overlay["default_for"] is not None else entry.default_for,
        match_language=overlay["match_language"] if "match_language" in overlay else entry.match_language,
        match_framework=overlay["match_framework"] if "match_framework" in overlay else entry.match_framework,
        match_sub_framework=overlay["match_sub_framework"] if "match_sub_framework" in overlay else entry.match_sub_framework,
        install_url=entry.install_url,
        version=entry.version,
        commit_sha=entry.commit_sha,
        category=overlay["category"] if "category" in overlay and overlay["category"] is not None else entry.category,
        popularity=entry.popularity,
    )


_FRONTMATTER_RE = re.compile(r"\A---\s*\n(.*?)\n---", re.DOTALL)


def parse_skill_frontmatter(body: bytes) -> Optional[dict]:
    """Extract name + description from SKILL.md YAML frontmatter.

    Minimal parser: only handles `key: value` and `key: "quoted value"` on
    single lines. Multi-line values are joined until the next key-colon line
    or the closing `---`. Enough for the `name` and `description` keys that
    Claude Code SKILL.md files always carry.
    """
    try:
        text = body.decode("utf-8", errors="replace")
    except Exception:
        return None
    m = _FRONTMATTER_RE.search(text)
    if not m:
        return None
    fm = m.group(1)
    result: dict = {}
    current_key: Optional[str] = None
    current_val: List[str] = []
    for line in fm.splitlines():
        kv = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$", line)
        if kv:
            if current_key:
                result[current_key] = " ".join(current_val).strip().strip('"')
            current_key = kv.group(1)
            current_val = [kv.group(2)]
        elif current_key:
            current_val.append(line.strip())
    if current_key:
        result[current_key] = " ".join(current_val).strip().strip('"')
    return result


# ---------------------------------------------------------------------------
# Adapter
# ---------------------------------------------------------------------------


class MarketplaceAdapter:
    type = "marketplace"

    def fetch_repo_via_tree_api(
        self,
        owner: str,
        repo: str,
        ref: str,
        http_get: HttpGet,
    ) -> List[SkillEntry]:
        """Walk a repo's skill/ tree directly, without requiring marketplace.json.

        Useful for callers (e.g. sitemap-aggregator) that know a repo
        hosts SKILL.md files but don't know (or care) whether it ships a
        marketplace.json manifest. Internally reuses the same Shape C
        path used when a marketplace.json has an empty skills list:
        discover skill dirs via Trees API, fetch each SKILL.md, parse
        frontmatter, apply heuristic inference + enrichment.
        """
        synthetic_plugin = {"name": repo, "source": "./"}
        synthetic_marketplace_url = (
            f"https://raw.githubusercontent.com/{owner}/{repo}/{ref}/.claude-plugin/marketplace.json"
        )
        # _skills_from_plugin's Shape C branch does exactly what we need:
        # detect empty skills → parse the marketplace URL → Trees API →
        # per-skill SKILL.md fetch. No code duplication.
        return self._skills_from_plugin(
            synthetic_plugin, synthetic_marketplace_url, http_get
        )

    def fetch(self, url: str, http_get: HttpGet, source: Optional[dict] = None) -> List[SkillEntry]:
        try:
            body = http_get(url)
            doc = parse_json_bytes(body)
        except (IOError, ValueError) as exc:
            print(f"[marketplace] fetch/parse failed for {url}: {exc}", file=sys.stderr)
            return []

        plugins = doc.get("plugins")
        if not isinstance(plugins, list):
            print(f"[marketplace] {url}: no 'plugins' array", file=sys.stderr)
            return []

        entries: List[SkillEntry] = []
        for plugin in plugins:
            if not isinstance(plugin, dict):
                continue
            entries.extend(self._skills_from_plugin(plugin, url, http_get))
        return entries

    # ------------------------------------------------------------------

    # Cap the number of skill dirs we probe via Trees API per plugin — a
    # sanity limit that protects against huge repos accidentally ingested.
    MAX_SKILLS_PER_PLUGIN_FROM_TREE = 50

    def _skills_from_plugin(
        self,
        plugin: dict,
        marketplace_url: str,
        http_get: HttpGet,
    ) -> List[SkillEntry]:
        skills = plugin.get("skills") or []
        if not isinstance(skills, list):
            return []

        # Shape A/B: explicit skills list present
        if skills:
            entries: List[SkillEntry] = []
            for skill in skills:
                if isinstance(skill, dict):
                    # Shape A — self-authored, full metadata
                    try:
                        entries.append(self._from_dict(skill))
                    except (KeyError, TypeError) as exc:
                        print(
                            f"[marketplace] skipping malformed skill in {marketplace_url}: {exc}",
                            file=sys.stderr,
                        )
                elif isinstance(skill, str):
                    # Shape B — real ecosystem, path-based
                    entry = self._from_path(skill, plugin, marketplace_url, http_get)
                    if entry is not None:
                        entries.append(entry)
            return entries

        # Shape C — no skills array (e.g. obra/superpowers). Fall back to
        # walking the repo tree via GitHub Trees API for any `skills/*/SKILL.md`
        # files. Single API call per repo, followed by parallel SKILL.md
        # fetches (one per discovered skill).
        parsed = _parse_github_raw_url(marketplace_url)
        if parsed is None:
            return []
        owner, repo, ref = parsed
        skill_dirs = self._discover_skills_via_tree_api(owner, repo, ref, http_get)
        if not skill_dirs:
            return []
        capped = skill_dirs[: self.MAX_SKILLS_PER_PLUGIN_FROM_TREE]
        entries: List[SkillEntry] = []
        with concurrent.futures.ThreadPoolExecutor(
            max_workers=min(8, len(capped))
        ) as pool:
            fetched = pool.map(
                lambda sd: self._from_path(sd, plugin, marketplace_url, http_get),
                capped,
            )
            for entry in fetched:
                if entry is not None:
                    entries.append(entry)
        return entries

    @staticmethod
    def _discover_skills_via_tree_api(
        owner: str,
        repo: str,
        ref: str,
        http_get: HttpGet,
    ) -> List[str]:
        """List skill directories in a repo via the GitHub Trees API.

        One HTTP request per repo; returns relative paths like
        `skills/brainstorming`. Returns [] on any failure (rate-limit,
        404, parse error). Once a rate-limit error is observed, the
        process-wide circuit breaker short-circuits all subsequent
        calls to return [] immediately — suppresses noise and speeds
        up the rest of the refresh.
        """
        global _TREE_API_RATE_LIMITED
        if _TREE_API_RATE_LIMITED:
            return []
        api_url = (
            f"https://api.github.com/repos/{owner}/{repo}/git/trees/{ref}?recursive=1"
        )
        try:
            body = http_get(api_url)
        except IOError as exc:
            msg = str(exc)
            if "403" in msg or "429" in msg or "rate limit" in msg.lower():
                _TREE_API_RATE_LIMITED = True
                print(
                    "[marketplace] tree API rate limited — suppressing further "
                    "calls (set GITHUB_TOKEN to raise limit from 60/hr to 5000/hr)",
                    file=sys.stderr,
                )
            else:
                print(
                    f"[marketplace] tree API failed for {owner}/{repo}: {exc}",
                    file=sys.stderr,
                )
            return []
        try:
            doc = json.loads(body)
        except (json.JSONDecodeError, ValueError):
            return []
        tree = doc.get("tree")
        if not isinstance(tree, list):
            return []
        dirs: List[str] = []
        seen = set()
        for node in tree:
            if not isinstance(node, dict):
                continue
            path = node.get("path", "")
            if not isinstance(path, str):
                continue
            if path.endswith("/SKILL.md"):
                d = path[: -len("/SKILL.md")]
                if d not in seen:
                    seen.add(d)
                    dirs.append(d)
            elif path == "SKILL.md":
                if "" not in seen:
                    seen.add("")
                    dirs.append("")
        return dirs

    @staticmethod
    def _from_dict(skill: dict) -> SkillEntry:
        return SkillEntry(
            id=skill["id"],
            name=skill["name"],
            description=skill.get("description", ""),
            tags=list(skill.get("tags") or []),
            boost_when=list(skill.get("boost_when") or []),
            penalize_when=list(skill.get("penalize_when") or []),
            default_for=list(skill.get("default_for") or []),
            match_language=skill.get("match_language"),
            match_framework=skill.get("match_framework"),
            match_sub_framework=skill.get("match_sub_framework"),
            install_url=skill["install_url"],
            version=skill.get("version"),
            commit_sha=skill.get("commit_sha"),
            category=skill.get("category"),
            popularity=skill.get("popularity", 0),
        )

    @staticmethod
    def _from_path(
        skill_path: str,
        plugin: dict,
        marketplace_url: str,
        http_get: HttpGet,
    ) -> Optional[SkillEntry]:
        """Fetch the SKILL.md at `skill_path`, parse frontmatter, infer tags."""
        # Compose the SKILL.md URL by joining the marketplace root with the path.
        base = _marketplace_root(marketplace_url)
        path = skill_path.lstrip("./")
        skill_md_url = f"{base}/{path}/SKILL.md"

        try:
            body = http_get(skill_md_url)
        except IOError:
            return None

        fm = parse_skill_frontmatter(body)
        if not fm or "name" not in fm:
            return None

        inferred = infer_tags(fm.get("description", ""), fm.get("name", ""))
        inferred_category = infer_category(
            fm.get("description", ""), fm.get("name", "")
        )
        skill_id = fm.get("name", path.split("/")[-1])
        entry = SkillEntry(
            id=skill_id,
            name=skill_id,
            description=fm.get("description", ""),
            tags=inferred["tags"],
            boost_when=inferred["boost_when"],
            penalize_when=inferred["penalize_when"],
            default_for=inferred["default_for"],
            match_language=inferred["match_language"],
            match_framework=None,
            match_sub_framework=None,
            install_url=skill_md_url,
            version=plugin.get("version"),
            commit_sha=None,
            category=inferred_category,
            popularity=0,
        )
        return apply_enrichment(entry)


def _marketplace_root(marketplace_url: str) -> str:
    """Derive the repo root URL from a marketplace.json URL.

    For `https://.../owner/repo/main/.claude-plugin/marketplace.json`,
    returns `https://.../owner/repo/main`.
    """
    if marketplace_url.endswith("/.claude-plugin/marketplace.json"):
        return marketplace_url[: -len("/.claude-plugin/marketplace.json")]
    if marketplace_url.endswith("/marketplace.json"):
        return marketplace_url[: -len("/marketplace.json")]
    return marketplace_url


_RAW_GITHUB_RE = re.compile(
    r"https?://raw\.githubusercontent\.com/([^/]+)/([^/]+)/([^/]+)/"
)


def _parse_github_raw_url(url: str) -> Optional[Tuple[str, str, str]]:
    """Extract (owner, repo, ref) from a raw.githubusercontent.com URL.

    Returns None for non-GitHub or malformed URLs.
    """
    m = _RAW_GITHUB_RE.match(url)
    if not m:
        return None
    return (m.group(1), m.group(2), m.group(3))
