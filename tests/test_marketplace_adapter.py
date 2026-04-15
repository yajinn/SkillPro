"""Tests for the marketplace.json source adapter."""
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from source_adapters.marketplace import (  # noqa: E402
    MarketplaceAdapter,
    infer_category,
)
from source_adapters.base import SkillEntry  # noqa: E402


class TestInferCategory(unittest.TestCase):
    """Category inference — description-based primary + tag-based fallback."""

    # --- existing categories still work (regression guard) ---

    def test_python_language(self):
        self.assertEqual(
            infer_category("Use pytest for testing, follow pep-8 style"),
            "language/python",
        )

    def test_fastapi_framework(self):
        self.assertEqual(
            infer_category("FastAPI expert patterns for REST APIs"),
            "framework/fastapi",
        )

    def test_code_review(self):
        self.assertEqual(
            infer_category("Adversarial code review with parallel hunters"),
            "quality/review",
        )

    # --- NEW categories ---

    def test_arize_ml_observability(self):
        self.assertEqual(
            infer_category("Annotate ML experiments in Arize for LLM observability"),
            "data-ml/observability",
        )

    def test_wandb_ml_observability(self):
        self.assertEqual(
            infer_category("Log ML training runs to Weights and Biases"),
            "data-ml/observability",
        )

    def test_mlflow_ml_observability(self):
        self.assertEqual(
            infer_category("Track experiments with MLflow for model registry"),
            "data-ml/observability",
        )

    def test_llm_rag(self):
        self.assertEqual(
            infer_category("Build RAG pipelines with vector stores and embeddings"),
            "data-ml/llm",
        )

    def test_langchain_llm(self):
        self.assertEqual(
            infer_category("LangChain agent patterns and prompt engineering"),
            "data-ml/llm",
        )

    def test_data_pipeline(self):
        self.assertEqual(
            infer_category("Build ETL pipelines with Airflow and Dagster"),
            "data-ml/pipeline",
        )

    def test_data_visualization(self):
        self.assertEqual(
            infer_category("Create interactive charts and graphs with D3.js"),
            "data-ml/visualization",
        )

    def test_aws_cloud(self):
        self.assertEqual(
            infer_category("Deploy Lambda functions and manage S3 buckets with AWS"),
            "cloud/aws",
        )

    def test_azure_cloud(self):
        self.assertEqual(
            infer_category("Azure App Service deployment and Cosmos DB integration"),
            "cloud/azure",
        )

    def test_gcp_cloud(self):
        self.assertEqual(
            infer_category("Google Cloud Run and BigQuery best practices"),
            "cloud/gcp",
        )

    def test_iac_terraform(self):
        self.assertEqual(
            infer_category("Terraform module design and Pulumi IaC patterns"),
            "infrastructure/iac",
        )

    def test_vector_database(self):
        self.assertEqual(
            infer_category("Pinecone vector search and Weaviate embeddings store"),
            "database/vector",
        )

    def test_slack_integration(self):
        self.assertEqual(
            infer_category("Build Slack bots and webhook integrations"),
            "integration/messaging",
        )

    # --- Tag-based fallback (NEW) ---

    def test_tag_fallback_data_pipeline(self):
        """Description has no keywords but tag says it's ML → data-ml/general."""
        self.assertEqual(
            infer_category(
                "Analyze tabular records and emit structured results",
                tags=["data_pipeline"],
            ),
            "data-ml/general",
        )

    def test_tag_fallback_cli_only(self):
        self.assertEqual(
            infer_category(
                "Command-runner utility for ad-hoc tasks",
                tags=["cli_only"],
            ),
            "cli/general",
        )

    def test_tag_fallback_mobile(self):
        self.assertEqual(
            infer_category(
                "Build screens with gesture handling and state",
                tags=["has_mobile_ui"],
            ),
            "mobile/general",
        )

    def test_tag_fallback_docker_traffic(self):
        self.assertEqual(
            infer_category(
                "Deploy containerized services to production",
                tags=["has_docker", "serves_traffic"],
            ),
            "infrastructure/docker",
        )

    def test_description_match_wins_over_tag_fallback(self):
        """If description matches, tag fallback does NOT override."""
        # Description clearly matches quality/review
        result = infer_category(
            "Adversarial code review with parallel hunters",
            tags=["data_pipeline"],  # would fallback to data-ml/general, but shouldn't
        )
        self.assertEqual(result, "quality/review")

    def test_no_match_anywhere_returns_none(self):
        """Neither description nor tags match → None (caller uses 'other')."""
        self.assertIsNone(
            infer_category(
                "Wibble the foo bars with wobble protocol",
                tags=[],
            )
        )




FIXTURE = ROOT / "tests" / "fixtures" / "marketplace_sample.json"


def fake_http_get(url: str) -> bytes:
    return FIXTURE.read_bytes()


class TestMarketplaceAdapter(unittest.TestCase):
    def setUp(self):
        self.adapter = MarketplaceAdapter()

    def test_type_field(self):
        self.assertEqual(self.adapter.type, "marketplace")

    def test_fetch_returns_skill_entries(self):
        result = self.adapter.fetch("http://any", fake_http_get)
        self.assertEqual(len(result), 2)
        self.assertIsInstance(result[0], SkillEntry)
        ids = {e.id for e in result}
        self.assertEqual(ids, {"security-guardian", "git-safety"})

    def test_fetch_preserves_scoring_metadata(self):
        result = self.adapter.fetch("http://any", fake_http_get)
        sg = next(e for e in result if e.id == "security-guardian")
        self.assertIn("has_user_input", sg.tags)
        self.assertIn("serves_public", sg.boost_when)
        self.assertIn("backend-api", sg.default_for)
        self.assertEqual(sg.commit_sha, "deadbeef1234")

    def test_fetch_handles_missing_optional_fields(self):
        minimal = json.dumps({
            "name": "min",
            "plugins": [{
                "name": "p",
                "skills": [{
                    "id": "minimal",
                    "name": "Minimal",
                    "description": "",
                    "tags": [],
                    "default_for": [],
                    "install_url": "http://x/SKILL.md",
                }]
            }]
        }).encode()
        result = self.adapter.fetch("http://any", lambda u: minimal)
        self.assertEqual(len(result), 1)
        self.assertIsNone(result[0].version)
        self.assertIsNone(result[0].commit_sha)
        self.assertEqual(result[0].boost_when, [])

    def test_fetch_on_malformed_json_returns_empty(self):
        result = self.adapter.fetch("http://any", lambda u: b"not json at all")
        self.assertEqual(result, [])

    def test_fetch_on_missing_plugins_key_returns_empty(self):
        body = json.dumps({"name": "x"}).encode()
        result = self.adapter.fetch("http://any", lambda u: body)
        self.assertEqual(result, [])


if __name__ == "__main__":
    unittest.main()
