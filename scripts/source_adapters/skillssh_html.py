"""skills.sh HTML adapter — no GitHub Tree API, no rate limit.

Motivation
----------
skills.sh is a skill directory hosted by Vercel. The previous
sitemap_aggregator.py walked its sitemap expecting GitHub repos,
then hit the GitHub Tree API for each one, which burned the 60/hr
unauthenticated quota within seconds and produced zero results.

Key realization: **every skill on skills.sh has its own dedicated
page**, not just the parent repos. The sitemap contains paths like
``/anthropics/skills/frontend-design`` where the third segment is
already the skill id. Each page HTML embeds:

  - ``<h1>frontend-design</h1>``          — the skill id
  - ``npx skills add https://github.com/anthropics/skills --skill frontend-design``
    — the full source URL, extractable with one regex
  - Summary text inside the Summary section — fetchable with a
    DOTALL regex

Walking the sitemap and parsing each skill page directly gives us
everything SkillForge needs to build a SkillEntry WITHOUT touching
GitHub at all. skills.sh handles the whole dependency.

Architecture
------------
- ``fetch(url, http_get, source=None)`` is the standard adapter API
- Default URL is ``https://skills.sh/sitemap.xml``
- Parallel sub-probes (8 workers via ThreadPoolExecutor) to keep
  total time under ~30s for 200+ skill pages
- Cap per-run with source.max_skills (default 50) so refresh
  doesn't balloon when skills.sh adds more content later
- Filters duplicate skill ids — if two pages happen to share the
  same id we keep the first one seen
- Every SkillEntry gets the skills.sh page URL as install_url
  (for display) and the github.com raw URL as the actual source
  pointer for future install_skill.py use

The adapter is bash-free: uses stdlib regex only, no external deps.
"""
from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from typing import List, Optional

try:
    # Work when loaded via refresh_index.py (sys.path has scripts/)
    from source_adapters.base import SkillEntry, HttpGet
except ImportError:  # pragma: no cover — when imported standalone
    from .base import SkillEntry, HttpGet


DEFAULT_MAX_SKILLS = 50
SUBPROBE_WORKERS = 8
URL_PATH_RE = re.compile(r"^/([^/]+)/([^/]+)/([^/]+)$")

# Regex heuristics — paired with a real-site HTML sample in tests
INSTALL_RE = re.compile(
    r"npx skills add\s*(?:<[^>]+>)?\s*(https://github\.com/[^<\s]+)\s*(?:<[^>]+>)?\s*--skill\s*(?:<[^>]+>)?\s*([a-zA-Z0-9._-]+)"
)
H1_RE = re.compile(r"<h1[^>]*>([^<]+)</h1>")
OG_DESC_RE = re.compile(r'property="og:description"\s+content="([^"]*)"')
SUMMARY_RE = re.compile(
    r"Summary</div>.*?<p>(?:<strong>)?([^<]+)",
    re.DOTALL,
)


@dataclass
class SkillPageUrl:
    """A sitemap URL broken into its three slugs."""
    url: str
    owner: str
    repo: str
    skill_id: str


def _parse_sitemap(xml_bytes: bytes) -> List[SkillPageUrl]:
    """Extract skill URLs from skills.sh sitemap.xml.

    Only accepts depth-3 paths like ``/owner/repo/skill-id``. Depth-1
    (`/picks`) and depth-2 (`/owner/repo`) are ignored because they're
    index pages, not skill pages.
    """
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError:
        return []
    ns = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    urls: List[SkillPageUrl] = []
    for loc in root.findall(".//sm:loc", ns):
        text = (loc.text or "").strip()
        if not text:
            continue
        # Split off scheme+host
        if "skills.sh/" not in text:
            continue
        path = "/" + text.split("skills.sh/", 1)[1]
        m = URL_PATH_RE.match(path)
        if not m:
            continue
        owner, repo, skill_id = m.group(1), m.group(2), m.group(3)
        # Filter out known non-skill slugs
        if skill_id in {"picks", "official", "audits", "docs", "about"}:
            continue
        urls.append(SkillPageUrl(url=text, owner=owner, repo=repo, skill_id=skill_id))
    return urls


def _infer_install_url(github_url: str, skill_id: str) -> str:
    """Build the raw.githubusercontent.com URL for the SKILL.md file.

    skills.sh's install command is ``npx skills add <github-url>
    --skill <skill-id>``. We convert that into the raw.githubusercontent
    URL for the SKILL.md so install_skill.py can fetch it directly.

    Assumes skills live at ``skills/<id>/SKILL.md`` which is the
    Claude Code convention. If a repo uses a different layout this
    URL will 404 on install, but that's handled downstream.
    """
    # github.com/owner/repo[.git] → raw.githubusercontent.com/owner/repo/main/skills/<id>/SKILL.md
    cleaned = github_url.rstrip("/")
    if cleaned.endswith(".git"):
        cleaned = cleaned[:-4]
    m = re.match(r"^https://github\.com/([^/]+)/([^/]+)$", cleaned)
    if not m:
        return cleaned  # fallback: give the raw github url and let install_skill cope
    owner, repo = m.group(1), m.group(2)
    return f"https://raw.githubusercontent.com/{owner}/{repo}/main/skills/{skill_id}/SKILL.md"


def _parse_skill_page(html: str, url: SkillPageUrl) -> Optional[SkillEntry]:
    """Turn a skills.sh skill page into a SkillEntry.

    Returns None if the install command can't be located — that means
    the page is probably not a skill page at all (sitemap drift).
    """
    install_match = INSTALL_RE.search(html)
    if not install_match:
        return None
    github_url = install_match.group(1).strip()
    page_skill_id = install_match.group(2).strip()
    # Prefer the install command's skill id over the URL slug —
    # the install command is the authoritative source.
    skill_id = page_skill_id or url.skill_id

    # H1 usually matches skill id but sometimes has a friendlier name
    h1 = H1_RE.search(html)
    name = h1.group(1).strip() if h1 else skill_id

    # Description priority: summary section > og:description > empty
    description = ""
    summary = SUMMARY_RE.search(html)
    if summary:
        description = summary.group(1).strip()
    if not description:
        og = OG_DESC_RE.search(html)
        if og:
            desc = og.group(1).strip()
            # skills.sh uses a generic og:description for every page
            if desc and desc != "Discover and install skills for AI agents.":
                description = desc
    if not description:
        description = f"{skill_id} (via skills.sh)"

    return SkillEntry(
        id=skill_id,
        name=name,
        description=description[:500],
        tags=[],
        boost_when=[],
        penalize_when=[],
        default_for=[],
        match_language=None,
        match_framework=None,
        match_sub_framework=None,
        install_url=_infer_install_url(github_url, skill_id),
        version=None,
        commit_sha=None,
        category=None,
        popularity=0,
    )


class SkillsShHtmlAdapter:
    """Adapter for skills.sh that parses HTML pages, not GitHub trees."""
    type = "skills-sh-html"

    def fetch(
        self,
        url: str,
        http_get: HttpGet,
        source: Optional[dict] = None,
    ) -> List[SkillEntry]:
        """Walk skills.sh sitemap, fetch each skill page, parse metadata.

        Args:
            url: sitemap URL (default: https://skills.sh/sitemap.xml)
            http_get: injected HTTP client (used by production + tests)
            source: optional adapter config dict (max_skills override)
        """
        max_skills = (source or {}).get("max_skills", DEFAULT_MAX_SKILLS)

        try:
            sitemap_bytes = http_get(url)
        except Exception as exc:
            print(f"[skills-sh-html] sitemap fetch failed: {exc}")
            return []

        pages = _parse_sitemap(sitemap_bytes)
        if not pages:
            print(f"[skills-sh-html] no skill pages in sitemap at {url}")
            return []

        # Deduplicate by skill_id before fetching (skills.sh sometimes
        # has the same skill under multiple (owner, repo) paths)
        seen_ids: set = set()
        deduped: List[SkillPageUrl] = []
        for page in pages:
            if page.skill_id in seen_ids:
                continue
            seen_ids.add(page.skill_id)
            deduped.append(page)
            if len(deduped) >= max_skills:
                break

        entries: List[SkillEntry] = []

        def _probe(page: SkillPageUrl) -> Optional[SkillEntry]:
            try:
                html_bytes = http_get(page.url)
                html = html_bytes.decode("utf-8", errors="replace")
                return _parse_skill_page(html, page)
            except Exception as exc:
                print(f"[skills-sh-html] probe failed for {page.url}: {exc}")
                return None

        with ThreadPoolExecutor(max_workers=SUBPROBE_WORKERS) as pool:
            futures = [pool.submit(_probe, p) for p in deduped]
            for fut in as_completed(futures):
                entry = fut.result()
                if entry is not None:
                    entries.append(entry)

        return entries
