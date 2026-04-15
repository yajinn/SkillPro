"""End-to-end tests for detect.sh's monorepo / multi-project parent hoist.

Users don't always open Claude Code in the directory that contains their
project's manifest. A common layout is:

    parent/
      Certificates/
      firebase-debug.log
      Turna/               ← real project lives here
        package.json
        ios/
        android/
        src/

Before the monorepo hoist, running `detect.sh parent/` returned
`language=unknown, framework=""` because `parent/` has no manifest at
root. Now `find_project_root` walks up to three levels deep, scores
candidate subdirectories by manifest count + project markers, and
hoists `PROJECT_DIR` to the best match. The profile JSON gains three
new fields:

  - cwd_project_dir    absolute path the user passed in
  - detection_dir      absolute path where manifests were actually found
  - monorepo_hoist     true iff the two differ

These tests cover the happy path, the anti-hijack case (a real project
at root should not be derailed by a rogue `docs/example/package.json`),
and the "nothing to find" fallback.
"""
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DETECT_SH = ROOT / "hooks" / "detect.sh"


def _has_jq() -> bool:
    return shutil.which("jq") is not None


def _run_detect(project_dir: Path) -> dict:
    subprocess.run(
        ["bash", str(DETECT_SH), str(project_dir)],
        check=True, capture_output=True,
    )
    return json.loads((project_dir / ".claude" / "project-profile.json").read_text())


@unittest.skipUnless(_has_jq(), "jq not installed")
class TestMonorepoHoist(unittest.TestCase):
    def test_parent_with_single_project_subdir_hoists(self):
        """Simulates a user's turna.react/Turna layout."""
        with tempfile.TemporaryDirectory() as tmp:
            parent = Path(tmp) / "turna.react"
            proj = parent / "Turna"
            (proj / "ios").mkdir(parents=True)
            (proj / "android").mkdir()
            (proj / "src").mkdir()
            (parent / "Certificates").mkdir()
            (proj / "package.json").write_text(json.dumps({
                "name": "turna",
                "dependencies": {
                    "react-native": "0.83.0",
                    "@tanstack/react-query": "^5.0.0",
                    "zustand": "^4.4.0",
                },
            }))
            (proj / "tsconfig.json").write_text("{}")
            (parent / "firebase-debug.log").write_text("")

            profile = _run_detect(parent)

            self.assertTrue(profile["monorepo_hoist"])
            self.assertEqual(profile["cwd_project_dir"], str(parent))
            self.assertEqual(profile["detection_dir"], str(proj))
            self.assertEqual(profile["language"], "typescript")
            self.assertEqual(profile["framework"], "react-native")
            self.assertIn("tanstack-query", profile["libraries"])
            self.assertIn("zustand", profile["libraries"])

    def test_parent_with_competing_subdirs_picks_best_scorer(self):
        """Two candidates — the one with more markers wins."""
        with tempfile.TemporaryDirectory() as tmp:
            parent = Path(tmp) / "workspace"
            # Weak candidate: just a package.json, nothing else
            weak = parent / "scratch"
            weak.mkdir(parents=True)
            (weak / "package.json").write_text('{"name":"scratch"}')

            # Strong candidate: full project layout
            strong = parent / "app"
            (strong / "src").mkdir(parents=True)
            (strong / "ios").mkdir()
            (strong / "tests").mkdir()
            (strong / "package.json").write_text(json.dumps({
                "name": "app",
                "dependencies": {"next": "^15", "zustand": "^4"},
            }))
            (strong / "tsconfig.json").write_text("{}")
            (strong / "README.md").write_text("# App")
            (strong / "next.config.js").write_text("module.exports = {}")

            profile = _run_detect(parent)

            self.assertTrue(profile["monorepo_hoist"])
            self.assertTrue(profile["detection_dir"].endswith("/app"))
            self.assertEqual(profile["framework"], "nextjs")

    def test_shallower_depth_wins_on_score_tie(self):
        """Equal markers — shallower directory wins."""
        with tempfile.TemporaryDirectory() as tmp:
            parent = Path(tmp) / "parent"

            # Depth 1
            shallow = parent / "shallow"
            shallow.mkdir(parents=True)
            (shallow / "package.json").write_text('{"name":"s"}')
            (shallow / "tsconfig.json").write_text("{}")

            # Depth 2 — same marker count
            deep = parent / "a" / "deep"
            deep.mkdir(parents=True)
            (deep / "package.json").write_text('{"name":"d"}')
            (deep / "tsconfig.json").write_text("{}")

            profile = _run_detect(parent)

            self.assertTrue(profile["detection_dir"].endswith("/shallow"))

    def test_root_with_manifest_does_not_hoist(self):
        """Real project at root — no hoist even if subdirs also have manifests."""
        with tempfile.TemporaryDirectory() as tmp:
            proj = Path(tmp) / "pyapp"
            (proj / "src").mkdir(parents=True)
            (proj / "docs" / "example").mkdir(parents=True)
            (proj / "pyproject.toml").write_text(
                '[project]\nname = "pyapp"\ndependencies = ["fastapi"]\n'
            )
            # Rogue docs/example/package.json — should NOT derail detection
            (proj / "docs" / "example" / "package.json").write_text(
                '{"name":"example","dependencies":{"react":"^18"}}'
            )
            profile = _run_detect(proj)

            self.assertFalse(profile["monorepo_hoist"])
            self.assertEqual(profile["language"], "python")
            self.assertEqual(profile["framework"], "fastapi")
            self.assertEqual(profile["detection_dir"], str(proj))

    def test_empty_parent_falls_back_gracefully(self):
        """No manifests anywhere — language=unknown, no hoist, no crash."""
        with tempfile.TemporaryDirectory() as tmp:
            parent = Path(tmp) / "empty"
            (parent / "some-dir").mkdir(parents=True)
            (parent / "readme.txt").write_text("nothing here")

            profile = _run_detect(parent)

            self.assertFalse(profile["monorepo_hoist"])
            self.assertEqual(profile["language"], "unknown")
            self.assertEqual(profile["detection_dir"], str(parent))

    def test_profile_file_stays_in_cwd_not_detection_dir(self):
        """The profile JSON lands at <cwd>/.claude/, not <detection>/.claude/.

        This matters because /sf reads .claude/project-profile.json
        from the user's current directory, not from the hoisted subdir.
        """
        with tempfile.TemporaryDirectory() as tmp:
            parent = Path(tmp) / "parent"
            proj = parent / "app"
            (proj / "src").mkdir(parents=True)
            (proj / "package.json").write_text(json.dumps({
                "name": "app",
                "dependencies": {"next": "^15"},
            }))
            _run_detect(parent)

            # Profile should be at parent/.claude/ (where the user called from)
            self.assertTrue((parent / ".claude" / "project-profile.json").exists())
            # NOT inside the hoisted subdir
            self.assertFalse((proj / ".claude" / "project-profile.json").exists())

    def test_node_modules_is_excluded(self):
        """A package.json deep in node_modules must never hijack detection."""
        with tempfile.TemporaryDirectory() as tmp:
            parent = Path(tmp) / "parent"
            # Rogue node_modules package.json at depth 2
            (parent / "something" / "node_modules" / "lib").mkdir(parents=True)
            (parent / "something" / "node_modules" / "lib" / "package.json").write_text(
                '{"name":"lib"}'
            )
            # No legitimate manifest anywhere
            profile = _run_detect(parent)

            self.assertFalse(profile["monorepo_hoist"])
            self.assertEqual(profile["language"], "unknown")


if __name__ == "__main__":
    unittest.main()
