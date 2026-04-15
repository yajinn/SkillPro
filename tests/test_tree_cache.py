"""Tests for scripts/tree_cache.py — the local cache for GitHub Trees API
results. Cache key is the api.github.com URL; value is the list of
skill directory paths extracted from the tree. 24h TTL by default.
"""
import json
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import tree_cache  # noqa: E402


URL_A = "https://api.github.com/repos/obra/superpowers/git/trees/main?recursive=1"
URL_B = "https://api.github.com/repos/anthropics/skills/git/trees/main?recursive=1"


class TestTreeCacheBasics(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.cache_file = Path(self.tmp) / "tree-cache.json"
        self._patcher = patch.object(
            tree_cache, "_cache_path", return_value=self.cache_file
        )
        self._patcher.start()

    def tearDown(self):
        self._patcher.stop()
        import shutil
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_get_from_empty_cache_returns_none(self):
        self.assertIsNone(tree_cache.get(URL_A))

    def test_put_then_get_returns_value(self):
        tree_cache.put(URL_A, ["skills/brainstorming", "skills/writing-plans"])
        result = tree_cache.get(URL_A)
        self.assertEqual(result, ["skills/brainstorming", "skills/writing-plans"])

    def test_get_nonexistent_key_returns_none_after_other_put(self):
        tree_cache.put(URL_A, ["skills/x"])
        self.assertIsNone(tree_cache.get(URL_B))

    def test_put_empty_list_is_cached(self):
        """A repo with no skills is a valid, cacheable result."""
        tree_cache.put(URL_A, [])
        result = tree_cache.get(URL_A)
        self.assertEqual(result, [])
        self.assertIsNotNone(result)

    def test_put_overwrites_existing(self):
        tree_cache.put(URL_A, ["old"])
        tree_cache.put(URL_A, ["new1", "new2"])
        self.assertEqual(tree_cache.get(URL_A), ["new1", "new2"])


class TestTreeCacheTTL(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.cache_file = Path(self.tmp) / "tree-cache.json"
        self._patcher = patch.object(
            tree_cache, "_cache_path", return_value=self.cache_file
        )
        self._patcher.start()

    def tearDown(self):
        self._patcher.stop()
        import shutil
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_fresh_entry_returned(self):
        tree_cache.put(URL_A, ["skills/x"])
        self.assertEqual(tree_cache.get(URL_A), ["skills/x"])

    def test_stale_entry_returns_none(self):
        self.cache_file.parent.mkdir(parents=True, exist_ok=True)
        stale_time = time.time() - 100000
        self.cache_file.write_text(json.dumps({
            "version": 1,
            "entries": {
                URL_A: {"cached_at": stale_time, "skill_dirs": ["stale"]}
            }
        }))
        self.assertIsNone(tree_cache.get(URL_A))

    def test_custom_ttl_override(self):
        self.cache_file.parent.mkdir(parents=True, exist_ok=True)
        self.cache_file.write_text(json.dumps({
            "version": 1,
            "entries": {
                URL_A: {"cached_at": time.time() - 60, "skill_dirs": ["x"]}
            }
        }))
        self.assertIsNone(tree_cache.get(URL_A, ttl_seconds=30))
        self.assertEqual(tree_cache.get(URL_A, ttl_seconds=300), ["x"])


class TestTreeCacheFileOps(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.cache_file = Path(self.tmp) / "skillforge" / "tree-cache.json"
        self._patcher = patch.object(
            tree_cache, "_cache_path", return_value=self.cache_file
        )
        self._patcher.start()

    def tearDown(self):
        self._patcher.stop()
        import shutil
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_put_creates_missing_dirs(self):
        self.assertFalse(self.cache_file.parent.exists())
        tree_cache.put(URL_A, ["skills/x"])
        self.assertTrue(self.cache_file.exists())

    def test_atomic_write(self):
        tree_cache.put(URL_A, ["skills/x"])
        tmp_files = list(self.cache_file.parent.glob("*.tmp"))
        self.assertEqual(tmp_files, [])

    def test_corrupt_cache_file_returns_empty(self):
        self.cache_file.parent.mkdir(parents=True, exist_ok=True)
        self.cache_file.write_text("not valid json {{{")
        self.assertIsNone(tree_cache.get(URL_A))
        tree_cache.put(URL_A, ["recovered"])
        self.assertEqual(tree_cache.get(URL_A), ["recovered"])

    def test_wrong_version_treated_as_empty(self):
        self.cache_file.parent.mkdir(parents=True, exist_ok=True)
        self.cache_file.write_text(json.dumps({
            "version": 999,
            "entries": {URL_A: {"cached_at": time.time(), "skill_dirs": ["x"]}}
        }))
        self.assertIsNone(tree_cache.get(URL_A))

    def test_clear_removes_file(self):
        tree_cache.put(URL_A, ["x"])
        self.assertTrue(self.cache_file.exists())
        tree_cache.clear()
        self.assertFalse(self.cache_file.exists())

    def test_clear_on_missing_file_is_noop(self):
        tree_cache.clear()


class TestTreeCacheStats(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.cache_file = Path(self.tmp) / "tree-cache.json"
        self._patcher = patch.object(
            tree_cache, "_cache_path", return_value=self.cache_file
        )
        self._patcher.start()

    def tearDown(self):
        self._patcher.stop()
        import shutil
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_stats_empty_cache(self):
        stats = tree_cache.stats()
        self.assertEqual(stats["entries"], 0)
        self.assertEqual(stats["fresh"], 0)
        self.assertEqual(stats["stale"], 0)

    def test_stats_mixed(self):
        self.cache_file.parent.mkdir(parents=True, exist_ok=True)
        now = time.time()
        self.cache_file.write_text(json.dumps({
            "version": 1,
            "entries": {
                "a": {"cached_at": now, "skill_dirs": ["x"]},
                "b": {"cached_at": now - 100000, "skill_dirs": ["y"]},
                "c": {"cached_at": now - 1000, "skill_dirs": ["z"]},
            }
        }))
        stats = tree_cache.stats()
        self.assertEqual(stats["entries"], 3)
        self.assertEqual(stats["fresh"], 2)
        self.assertEqual(stats["stale"], 1)


if __name__ == "__main__":
    unittest.main()
