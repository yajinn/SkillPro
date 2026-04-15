"""End-to-end tests for detect.sh's deep library introspection.

For each detected language we build a minimal synthetic project with a few
known dependencies in the language's manifest file, run detect.sh against
it, and assert the `libraries` array in the resulting profile contains the
expected canonical IDs.

These tests shell out to the real detect.sh — they verify the bash logic
end-to-end, not just the helpers. They depend on `jq` being installed
(which is also a runtime requirement of detect.sh).
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
    """Run detect.sh against project_dir and return the parsed profile."""
    subprocess.run(
        ["bash", str(DETECT_SH), str(project_dir)],
        check=True, capture_output=True,
    )
    profile_path = project_dir / ".claude" / "project-profile.json"
    return json.loads(profile_path.read_text())


@unittest.skipUnless(_has_jq(), "jq not installed")
class TestJavaScriptLibraries(unittest.TestCase):
    def test_nextjs_with_tanstack_zustand_drizzle(self):
        with tempfile.TemporaryDirectory() as tmp:
            proj = Path(tmp)
            (proj / "package.json").write_text(json.dumps({
                "name": "app",
                "dependencies": {
                    "next": "^15.0.0",
                    "@tanstack/react-query": "^5.0.0",
                    "zustand": "^4.4.0",
                    "zod": "^3.22.0",
                    "drizzle-orm": "^0.30.0",
                    "@trpc/server": "^11.0.0",
                },
                "devDependencies": {
                    "vitest": "^1.0.0",
                    "tailwindcss": "^3.4.0",
                    "@playwright/test": "^1.40.0",
                },
            }))
            (proj / "tsconfig.json").write_text("{}")
            (proj / "next.config.js").write_text("module.exports = {}")
            profile = _run_detect(proj)
            self.assertEqual(profile["language"], "typescript")
            self.assertEqual(profile["framework"], "nextjs")
            libs = set(profile["libraries"])
            self.assertIn("tanstack-query", libs)
            self.assertIn("zustand", libs)
            self.assertIn("zod", libs)
            self.assertIn("drizzle", libs)
            self.assertIn("trpc", libs)
            self.assertIn("vitest", libs)
            self.assertIn("tailwindcss", libs)
            self.assertIn("playwright", libs)

    def test_empty_package_json_no_libraries(self):
        with tempfile.TemporaryDirectory() as tmp:
            proj = Path(tmp)
            (proj / "package.json").write_text(json.dumps({
                "name": "x", "dependencies": {}
            }))
            profile = _run_detect(proj)
            self.assertEqual(profile["libraries"], [])


@unittest.skipUnless(_has_jq(), "jq not installed")
class TestPythonLibraries(unittest.TestCase):
    def test_fastapi_stack_via_pyproject(self):
        with tempfile.TemporaryDirectory() as tmp:
            proj = Path(tmp)
            (proj / "pyproject.toml").write_text(
                '[project]\n'
                'name = "api"\n'
                'dependencies = ['
                '"fastapi>=0.100", "pydantic>=2.0", "sqlalchemy", '
                '"alembic", "celery", "openai", "anthropic"]\n'
            )
            profile = _run_detect(proj)
            self.assertEqual(profile["language"], "python")
            self.assertEqual(profile["framework"], "fastapi")
            libs = set(profile["libraries"])
            for expected in {"fastapi", "pydantic", "sqlalchemy", "alembic",
                             "celery", "openai-sdk", "anthropic-sdk"}:
                self.assertIn(expected, libs)

    def test_requirements_txt_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            proj = Path(tmp)
            (proj / "requirements.txt").write_text(
                "pandas==2.0.0\nnumpy==1.26.0\npytest==8.0\nhttpx==0.27\n"
            )
            profile = _run_detect(proj)
            libs = set(profile["libraries"])
            self.assertIn("pandas", libs)
            self.assertIn("numpy", libs)
            self.assertIn("pytest", libs)
            self.assertIn("httpx", libs)


@unittest.skipUnless(_has_jq(), "jq not installed")
class TestPHPLibraries(unittest.TestCase):
    def test_laravel_with_livewire_sanctum(self):
        with tempfile.TemporaryDirectory() as tmp:
            proj = Path(tmp)
            (proj / "composer.json").write_text(json.dumps({
                "name": "app/laravel",
                "require": {
                    "laravel/framework": "^11.0",
                    "laravel/sanctum": "^4.0",
                    "livewire/livewire": "^3.0",
                    "spatie/laravel-permission": "^6.0",
                    "filament/filament": "^3.0",
                },
            }))
            (proj / "artisan").write_text("#!/usr/bin/env php\n")
            profile = _run_detect(proj)
            self.assertEqual(profile["language"], "php")
            self.assertEqual(profile["framework"], "laravel")
            libs = set(profile["libraries"])
            self.assertIn("laravel-sanctum", libs)
            self.assertIn("livewire", libs)
            self.assertIn("spatie-permission", libs)
            self.assertIn("filament", libs)


@unittest.skipUnless(_has_jq(), "jq not installed")
class TestRubyLibraries(unittest.TestCase):
    def test_rails_with_devise_sidekiq(self):
        with tempfile.TemporaryDirectory() as tmp:
            proj = Path(tmp)
            (proj / "Gemfile").write_text(
                'source "https://rubygems.org"\n'
                "gem 'rails', '~> 7.1'\n"
                "gem 'devise'\n"
                "gem 'sidekiq'\n"
                "gem 'rspec-rails'\n"
                "gem 'pundit'\n"
            )
            (proj / "config").mkdir()
            (proj / "config" / "routes.rb").write_text("Rails.application.routes.draw do\nend\n")
            profile = _run_detect(proj)
            self.assertEqual(profile["language"], "ruby")
            self.assertEqual(profile["framework"], "rails")
            libs = set(profile["libraries"])
            self.assertIn("devise", libs)
            self.assertIn("sidekiq", libs)
            self.assertIn("rspec", libs)
            self.assertIn("pundit", libs)


@unittest.skipUnless(_has_jq(), "jq not installed")
class TestGoLibraries(unittest.TestCase):
    def test_gin_with_gorm(self):
        with tempfile.TemporaryDirectory() as tmp:
            proj = Path(tmp)
            (proj / "go.mod").write_text(
                "module example.com/app\n\n"
                "go 1.22\n\n"
                "require (\n"
                "  github.com/gin-gonic/gin v1.9.1\n"
                "  gorm.io/gorm v1.25.0\n"
                "  github.com/spf13/cobra v1.8.0\n"
                "  github.com/stretchr/testify v1.9.0\n"
                ")\n"
            )
            profile = _run_detect(proj)
            self.assertEqual(profile["language"], "go")
            self.assertEqual(profile["framework"], "gin")
            libs = set(profile["libraries"])
            self.assertIn("gin", libs)
            self.assertIn("gorm", libs)
            self.assertIn("cobra", libs)
            self.assertIn("testify", libs)


@unittest.skipUnless(_has_jq(), "jq not installed")
class TestRustLibraries(unittest.TestCase):
    def test_axum_tokio_sqlx(self):
        with tempfile.TemporaryDirectory() as tmp:
            proj = Path(tmp)
            (proj / "Cargo.toml").write_text(
                '[package]\n'
                'name = "app"\n'
                'version = "0.1.0"\n\n'
                '[dependencies]\n'
                'tokio = { version = "1", features = ["full"] }\n'
                'axum = "0.7"\n'
                'serde = { version = "1", features = ["derive"] }\n'
                'sqlx = "0.7"\n'
                'tracing = "0.1"\n'
            )
            profile = _run_detect(proj)
            self.assertEqual(profile["language"], "rust")
            self.assertEqual(profile["framework"], "axum")
            libs = set(profile["libraries"])
            self.assertIn("tokio", libs)
            self.assertIn("axum", libs)
            self.assertIn("serde", libs)
            self.assertIn("sqlx", libs)
            self.assertIn("tracing", libs)


@unittest.skipUnless(_has_jq(), "jq not installed")
class TestDartLibraries(unittest.TestCase):
    def test_flutter_bloc_dio_freezed(self):
        with tempfile.TemporaryDirectory() as tmp:
            proj = Path(tmp)
            (proj / "pubspec.yaml").write_text(
                "name: app\n"
                "dependencies:\n"
                "  flutter:\n"
                "    sdk: flutter\n"
                "  flutter_bloc: ^8.0.0\n"
                "  dio: ^5.0.0\n"
                "  freezed: ^2.0.0\n"
                "  go_router: ^13.0.0\n"
                "  firebase_auth: ^4.0.0\n"
                "  cloud_firestore: ^4.0.0\n"
            )
            profile = _run_detect(proj)
            self.assertEqual(profile["language"], "dart")
            self.assertEqual(profile["framework"], "flutter")
            libs = set(profile["libraries"])
            self.assertIn("flutter-bloc", libs)
            self.assertIn("dio", libs)
            self.assertIn("freezed", libs)
            self.assertIn("go-router", libs)
            self.assertIn("firebase-auth", libs)
            self.assertIn("firestore", libs)


@unittest.skipUnless(_has_jq(), "jq not installed")
class TestJavaLibraries(unittest.TestCase):
    def test_spring_boot_with_jpa(self):
        with tempfile.TemporaryDirectory() as tmp:
            proj = Path(tmp)
            (proj / "pom.xml").write_text(
                '<?xml version="1.0"?>\n'
                '<project>\n'
                '  <dependencies>\n'
                '    <dependency>\n'
                '      <groupId>org.springframework.boot</groupId>\n'
                '      <artifactId>spring-boot-starter-data-jpa</artifactId>\n'
                '    </dependency>\n'
                '    <dependency>\n'
                '      <groupId>org.springframework.boot</groupId>\n'
                '      <artifactId>spring-boot-starter-web</artifactId>\n'
                '    </dependency>\n'
                '    <dependency>\n'
                '      <groupId>org.projectlombok</groupId>\n'
                '      <artifactId>lombok</artifactId>\n'
                '    </dependency>\n'
                '    <dependency>\n'
                '      <groupId>com.fasterxml.jackson.core</groupId>\n'
                '      <artifactId>jackson-databind</artifactId>\n'
                '    </dependency>\n'
                '  </dependencies>\n'
                '</project>\n'
            )
            profile = _run_detect(proj)
            self.assertEqual(profile["language"], "java")
            libs = set(profile["libraries"])
            self.assertIn("spring-boot", libs)
            self.assertIn("spring-data-jpa", libs)
            self.assertIn("lombok", libs)
            self.assertIn("jackson", libs)


@unittest.skipUnless(_has_jq(), "jq not installed")
class TestCSharpLibraries(unittest.TestCase):
    def test_aspnet_with_ef_serilog(self):
        with tempfile.TemporaryDirectory() as tmp:
            proj = Path(tmp)
            (proj / "App.csproj").write_text(
                '<Project Sdk="Microsoft.NET.Sdk.Web">\n'
                '  <ItemGroup>\n'
                '    <PackageReference Include="Microsoft.AspNetCore.App" Version="8.0.0" />\n'
                '    <PackageReference Include="Microsoft.EntityFrameworkCore" Version="8.0.0" />\n'
                '    <PackageReference Include="MediatR" Version="12.0.0" />\n'
                '    <PackageReference Include="AutoMapper" Version="13.0.0" />\n'
                '    <PackageReference Include="Serilog" Version="3.1.1" />\n'
                '    <PackageReference Include="FluentValidation" Version="11.9.0" />\n'
                '  </ItemGroup>\n'
                '</Project>\n'
            )
            profile = _run_detect(proj)
            self.assertEqual(profile["language"], "csharp")
            libs = set(profile["libraries"])
            self.assertIn("entity-framework", libs)
            self.assertIn("mediatr", libs)
            self.assertIn("automapper", libs)
            self.assertIn("serilog", libs)
            self.assertIn("fluent-validation", libs)


@unittest.skipUnless(_has_jq(), "jq not installed")
class TestLibrariesAreSortedAndUnique(unittest.TestCase):
    def test_no_duplicates_when_multiple_packages_map_to_same_id(self):
        # @tanstack/react-query AND @tanstack/query-core both → tanstack-query
        with tempfile.TemporaryDirectory() as tmp:
            proj = Path(tmp)
            (proj / "package.json").write_text(json.dumps({
                "dependencies": {
                    "@tanstack/react-query": "^5.0.0",
                    "@tanstack/query-core": "^5.0.0",
                }
            }))
            profile = _run_detect(proj)
            libs = profile["libraries"]
            self.assertEqual(libs.count("tanstack-query"), 1)

    def test_libraries_are_sorted(self):
        with tempfile.TemporaryDirectory() as tmp:
            proj = Path(tmp)
            (proj / "package.json").write_text(json.dumps({
                "dependencies": {
                    "zustand": "^4.0.0",
                    "@tanstack/react-query": "^5.0.0",
                    "drizzle-orm": "^0.30.0",
                }
            }))
            profile = _run_detect(proj)
            libs = profile["libraries"]
            self.assertEqual(libs, sorted(libs))


if __name__ == "__main__":
    unittest.main()
