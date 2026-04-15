"""Language precedence tests for projects with multiple manifests.

Modern projects rarely ship a single manifest. React Native apps carry a
Gemfile for the CocoaPods bundler. Next.js sites carry a requirements.txt
for a Python-based deploy script. Go CLIs ship a package.json for a docs
site. detect.sh's job is to identify the project's REAL language, not
the one whose manifest happens to sort first in the elif cascade.

These tests exercise the "strong JS/TS framework pre-pass" and verify
that genuine Ruby/Python/Go projects are not accidentally hijacked by
the pre-pass.
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
class TestReactNativeBeatsGemfile(unittest.TestCase):
    """The defining case: RN projects always carry a Gemfile (CocoaPods)."""

    def test_rn_with_root_gemfile_is_typescript(self):
        with tempfile.TemporaryDirectory() as tmp:
            proj = Path(tmp)
            (proj / "package.json").write_text(json.dumps({
                "name": "app",
                "dependencies": {
                    "react-native": "0.83.0",
                    "@tanstack/react-query": "^5.0.0",
                },
            }))
            (proj / "tsconfig.json").write_text("{}")
            (proj / "Gemfile").write_text(
                "source 'https://rubygems.org'\n"
                "gem 'cocoapods'\n"
                "gem 'fastlane'\n"
            )
            (proj / "ios").mkdir()
            (proj / "android").mkdir()

            profile = _run_detect(proj)
            self.assertEqual(profile["language"], "typescript")
            self.assertEqual(profile["framework"], "react-native")
            self.assertIn("tanstack-query", profile["libraries"])

    def test_rn_without_tsconfig_is_javascript(self):
        with tempfile.TemporaryDirectory() as tmp:
            proj = Path(tmp)
            (proj / "package.json").write_text(json.dumps({
                "dependencies": {"react-native": "0.72.0"},
            }))
            (proj / "Gemfile").write_text("gem 'cocoapods'\n")

            profile = _run_detect(proj)
            self.assertEqual(profile["language"], "javascript")
            self.assertEqual(profile["framework"], "react-native")

    def test_expo_app_with_gemfile_is_typescript(self):
        with tempfile.TemporaryDirectory() as tmp:
            proj = Path(tmp)
            (proj / "package.json").write_text(json.dumps({
                "dependencies": {"expo": "^50.0.0", "react-native": "0.73.0"},
            }))
            (proj / "tsconfig.json").write_text("{}")
            (proj / "app.json").write_text('{"expo":{}}')
            (proj / "Gemfile").write_text("gem 'cocoapods'\n")

            profile = _run_detect(proj)
            self.assertEqual(profile["language"], "typescript")
            self.assertEqual(profile["framework"], "react-native")


@unittest.skipUnless(_has_jq(), "jq not installed")
class TestFrontendFrameworkPrecedence(unittest.TestCase):
    """Next.js/Nuxt/Vue/etc. beat sidecar Python or Ruby manifests."""

    def test_nextjs_with_requirements_txt_is_typescript(self):
        # A Next.js app with a Python deployment script ships a
        # requirements.txt for the script, not for the app. The pre-pass
        # should pin language=typescript.
        with tempfile.TemporaryDirectory() as tmp:
            proj = Path(tmp)
            (proj / "package.json").write_text(json.dumps({
                "dependencies": {"next": "^15.0.0", "react": "^18"},
            }))
            (proj / "tsconfig.json").write_text("{}")
            (proj / "next.config.js").write_text("module.exports = {}")
            (proj / "requirements.txt").write_text("boto3==1.34.0\n")

            profile = _run_detect(proj)
            self.assertEqual(profile["language"], "typescript")
            self.assertEqual(profile["framework"], "nextjs")

    def test_nuxt_with_gemfile_is_typescript(self):
        with tempfile.TemporaryDirectory() as tmp:
            proj = Path(tmp)
            (proj / "package.json").write_text(json.dumps({
                "dependencies": {"nuxt": "^3.10.0"},
            }))
            (proj / "tsconfig.json").write_text("{}")
            (proj / "nuxt.config.ts").write_text("export default {}")
            (proj / "Gemfile").write_text("gem 'rake'\n")

            profile = _run_detect(proj)
            self.assertEqual(profile["language"], "typescript")
            self.assertEqual(profile["framework"], "nuxtjs")

    def test_framework_config_file_alone_triggers_pre_pass(self):
        # Even without a dep marker, a framework config file is a strong
        # JS/TS signal: you don't put `angular.json` in a Go project.
        with tempfile.TemporaryDirectory() as tmp:
            proj = Path(tmp)
            (proj / "package.json").write_text('{"name":"app"}')  # no deps
            (proj / "angular.json").write_text('{}')
            (proj / "Gemfile").write_text("gem 'rake'\n")

            profile = _run_detect(proj)
            self.assertIn(profile["language"], ("javascript", "typescript"))


@unittest.skipUnless(_has_jq(), "jq not installed")
class TestPureLanguagesStillWork(unittest.TestCase):
    """The pre-pass must NOT hijack genuine Ruby/Python/Go projects."""

    def test_pure_rails_project_is_ruby(self):
        with tempfile.TemporaryDirectory() as tmp:
            proj = Path(tmp)
            (proj / "Gemfile").write_text(
                "source 'https://rubygems.org'\ngem 'rails', '~> 7.1'\n"
            )
            (proj / "config").mkdir()
            (proj / "config" / "routes.rb").write_text("Rails.application.routes.draw do\nend\n")

            profile = _run_detect(proj)
            self.assertEqual(profile["language"], "ruby")
            self.assertEqual(profile["framework"], "rails")

    def test_pure_fastapi_project_is_python(self):
        with tempfile.TemporaryDirectory() as tmp:
            proj = Path(tmp)
            (proj / "pyproject.toml").write_text(
                '[project]\nname = "api"\ndependencies = ["fastapi"]\n'
            )
            profile = _run_detect(proj)
            self.assertEqual(profile["language"], "python")
            self.assertEqual(profile["framework"], "fastapi")

    def test_python_with_package_json_for_tooling_is_python(self):
        # Python backend ships a package.json at root only for prettier /
        # markdown linting. No framework dep in package.json.
        with tempfile.TemporaryDirectory() as tmp:
            proj = Path(tmp)
            (proj / "pyproject.toml").write_text(
                '[project]\nname = "api"\ndependencies = ["fastapi"]\n'
            )
            (proj / "package.json").write_text(json.dumps({
                "name": "docs-tooling",
                "devDependencies": {"prettier": "^3.0", "markdownlint": "^0.30"},
            }))
            profile = _run_detect(proj)
            self.assertEqual(profile["language"], "python")
            self.assertEqual(profile["framework"], "fastapi")

    def test_go_cli_with_package_json_for_docs_site_is_go(self):
        with tempfile.TemporaryDirectory() as tmp:
            proj = Path(tmp)
            (proj / "go.mod").write_text(
                "module example.com/cli\n\n"
                "go 1.22\n\n"
                "require github.com/spf13/cobra v1.8.0\n"
            )
            (proj / "package.json").write_text(json.dumps({
                "name": "docs",
                "devDependencies": {"vitepress": "^1.0"},
            }))
            profile = _run_detect(proj)
            self.assertEqual(profile["language"], "go")

    def test_pure_laravel_project_is_php(self):
        with tempfile.TemporaryDirectory() as tmp:
            proj = Path(tmp)
            (proj / "composer.json").write_text(json.dumps({
                "require": {"laravel/framework": "^11.0"},
            }))
            (proj / "artisan").write_text("#!/usr/bin/env php\n")
            profile = _run_detect(proj)
            self.assertEqual(profile["language"], "php")
            self.assertEqual(profile["framework"], "laravel")


@unittest.skipUnless(_has_jq(), "jq not installed")
class TestMonorepoHoistCombinedWithPolyglot(unittest.TestCase):
    """End-to-end: parent hoist + polyglot pre-pass in one run."""

    def test_parent_hoist_finds_rn_subdir_with_gemfile(self):
        """Reproduces the user's turna.react → Turna layout exactly."""
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
                    "@tanstack/react-query": "^5.0",
                    "zustand": "^4.4",
                    "zod": "^3.22",
                },
            }))
            (proj / "tsconfig.json").write_text("{}")
            (proj / "Gemfile").write_text(
                "source 'https://rubygems.org'\ngem 'cocoapods'\n"
            )
            (parent / "firebase-debug.log").write_text("")

            profile = _run_detect(parent)

            self.assertTrue(profile["monorepo_hoist"])
            self.assertEqual(profile["language"], "typescript")
            self.assertEqual(profile["framework"], "react-native")
            self.assertTrue(profile["characteristics"]["has_mobile_ui"])
            for lib in ("tanstack-query", "zustand", "zod"):
                self.assertIn(lib, profile["libraries"])


if __name__ == "__main__":
    unittest.main()
