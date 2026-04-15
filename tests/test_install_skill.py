"""Tests for the install_skill pipeline."""
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import install_skill  # noqa: E402


SAMPLE_SKILL_BODY = (ROOT / "tests" / "fixtures" / "skill_sample.md").read_bytes()
SAMPLE_SHA = hashlib.sha256(SAMPLE_SKILL_BODY).hexdigest()


def make_index(extra=None):
    entry = {
        "id": "security-guardian",
        "name": "Security Guardian",
        "description": "",
        "tags": ["has_user_input"],
        "boost_when": [], "penalize_when": [], "default_for": [],
        "match_language": None, "match_framework": None, "match_sub_framework": None,
        "source": {
            "name": "test",
            "install_url": "http://local/SKILL.md",
            "commit_sha": None,
            "version": "1.0.0",
        },
        "audit": {"status": "unaudited", "tool": None, "scanned_at": None},
    }
    if extra:
        entry["source"].update(extra)
    return {
        "version": 1,
        "fetched_at": "now",
        "ttl_seconds": 604800,
        "partial": False,
        "sources": [{
            "name": "test", "type": "marketplace", "url": "http://local",
            "status": "ok", "require_audit": False
        }],
        "conflicts": [],
        "skills": [entry],
    }


class TestInstallSkill(unittest.TestCase):
    def test_install_writes_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            skills_dir = Path(tmp) / "skills"
            selections = Path(tmp) / "selections.json"
            install_skill.install(
                skill_id="security-guardian",
                index=make_index(),
                skills_dir=skills_dir,
                selections_path=selections,
                http_get=lambda u: SAMPLE_SKILL_BODY,
                dry_run=False,
            )
            target = skills_dir / "security-guardian" / "SKILL.md"
            self.assertTrue(target.exists())
            self.assertEqual(target.read_bytes(), SAMPLE_SKILL_BODY)
            sel = json.loads(selections.read_text())
            self.assertTrue(sel["selections"]["security-guardian"]["enabled"])
            self.assertEqual(sel["selections"]["security-guardian"]["sha"], SAMPLE_SHA)

    def test_dry_run_does_not_write(self):
        with tempfile.TemporaryDirectory() as tmp:
            skills_dir = Path(tmp) / "skills"
            selections = Path(tmp) / "selections.json"
            result = install_skill.install(
                skill_id="security-guardian",
                index=make_index(),
                skills_dir=skills_dir,
                selections_path=selections,
                http_get=lambda u: SAMPLE_SKILL_BODY,
                dry_run=True,
            )
            self.assertEqual(result["status"], "dry-run")
            self.assertFalse(skills_dir.exists())
            self.assertFalse(selections.exists())

    def test_sha_mismatch_aborts(self):
        idx = make_index(extra={"commit_sha": "deadbeef"})
        with tempfile.TemporaryDirectory() as tmp:
            skills_dir = Path(tmp) / "skills"
            selections = Path(tmp) / "selections.json"
            with self.assertRaises(install_skill.TamperError):
                install_skill.install(
                    skill_id="security-guardian",
                    index=idx,
                    skills_dir=skills_dir,
                    selections_path=selections,
                    http_get=lambda u: SAMPLE_SKILL_BODY,
                    dry_run=False,
                )
            self.assertFalse((skills_dir / "security-guardian" / "SKILL.md").exists())

    def test_unknown_skill_raises(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(install_skill.SkillNotFound):
                install_skill.install(
                    skill_id="nope",
                    index=make_index(),
                    skills_dir=Path(tmp) / "skills",
                    selections_path=Path(tmp) / "selections.json",
                    http_get=lambda u: b"",
                    dry_run=False,
                )

    def test_reinstall_overwrites_existing_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            skills_dir = Path(tmp) / "skills"
            selections = Path(tmp) / "selections.json"
            target_dir = skills_dir / "security-guardian"
            target_dir.mkdir(parents=True)
            (target_dir / "stale.md").write_text("old")
            install_skill.install(
                skill_id="security-guardian",
                index=make_index(),
                skills_dir=skills_dir,
                selections_path=selections,
                http_get=lambda u: SAMPLE_SKILL_BODY,
                dry_run=False,
            )
            self.assertFalse((target_dir / "stale.md").exists())
            self.assertTrue((target_dir / "SKILL.md").exists())


if __name__ == "__main__":
    unittest.main()
