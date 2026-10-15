"""Strict Draft 2020-12, Receipt envelope and plugin metadata contract tests."""
from copy import deepcopy
import json
import unittest
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource

ROOT = Path(__file__).resolve().parent.parent
CONTRACTS = ROOT / "contracts"


def doc(name):
    return json.loads((CONTRACTS / name).read_text(encoding="utf-8"))


class TestContracts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.snapshot = doc("review-snapshot.schema.json")
        cls.review = doc("review-result.schema.json")
        cls.receipt = doc("validated-review-receipt.schema.json")
        cls.envelope = doc("validation-tool-response.schema.json")
        cls.registry = Registry().with_resource(
            cls.receipt["$id"], Resource.from_contents(cls.receipt)
        )

    def assert_valid(self, schema, payload):
        v = Draft202012Validator(schema, format_checker=FormatChecker(), registry=self.registry)
        err = list(v.iter_errors(payload))
        self.assertFalse(err, "\n".join(e.message for e in err))

    def assert_invalid(self, schema, payload):
        v = Draft202012Validator(schema, format_checker=FormatChecker(), registry=self.registry)
        self.assertTrue(list(v.iter_errors(payload)), "invalid fixture unexpectedly accepted")

    def sample_receipt(self, status="PARTIAL"):
        return {
          "schema_version": "0.2.0", "validation_id": "val:fixture", "snapshot_id": "sha256:fixture",
          "snapshot_manifest_digest": "d"*64, "result_digest": "e"*64,
          "review_status": status, "valid": status == "COMPLETE",
          "reason_codes": [] if status == "COMPLETE" else ["UNPROVEN_SCOPE"],
          "verified_reviewed_files": 2, "verified_eligible_files": 2,
          "checked_current_head_sha": "b"*40, "checked_current_base_sha": "a"*40,
          "checked_current_merge_base_sha": "c"*40, "verified_at": "2026-10-16T00:00:00Z",
          "finding_identities": [], "signature": None
        }

    def sample_envelope(self, receipt):
        return {
            "schema_version":"0.2.0", "request_id":"req:one", "snapshot_id":"sha256:fixture",
            "status":"SUCCESS", "provenance":[{"source":"server","resource":"receipt"}],
            "limitations":[], "result":receipt
        }

    def test_all_contract_schemas_are_draft_2020_12(self):
        for schema in [self.snapshot,self.review,self.receipt,self.envelope]:
            self.assertEqual(schema["$schema"],"https://json-schema.org/draft/2020-12/schema")
            Draft202012Validator.check_schema(schema)

    def test_positive_complete_snapshot_fixture(self):
        self.assert_valid(self.snapshot,doc("../tests/example-review-snapshot.json"))

    def test_positive_complete_review_fixture(self):
        self.assert_valid(self.review,doc("../tests/example-review-result.json"))

    def test_missing_snapshot_repository_denied(self):
        x=doc("../tests/example-review-snapshot.json"); del x["repository"]
        self.assert_invalid(self.snapshot,x)

    def test_missing_model_family_denied(self):
        x=doc("../tests/example-review-result.json"); del x["model_family"]
        self.assert_invalid(self.review,x)

    def test_extra_review_keys_denied(self):
        x=doc("../tests/example-review-result.json"); x["pretend_ok"]=True
        self.assert_invalid(self.review,x)

    def test_wrong_reviewed_paths_type_denied(self):
        x=doc("../tests/example-review-result.json"); x["reviewed_paths"]="a.ts"
        self.assert_invalid(self.review,x)

    def test_receipt_complete_valid(self):
        self.assert_valid(self.receipt,self.sample_receipt("COMPLETE"))

    def test_receipt_partial_valid(self):
        self.assert_valid(self.receipt,self.sample_receipt())

    def test_receipt_cannot_claim_complete_with_invalid_flag(self):
        x=self.sample_receipt("COMPLETE");x["valid"]=False
        self.assert_invalid(self.receipt,x)

    def test_ambiguous_finding_identity_has_no_canonical_id_or_fingerprint(self):
        x=self.sample_receipt()
        x["finding_identities"]=[{"finding_id":"F-1","fingerprint_version":"v1",
          "fingerprint":None,"canonical_finding_id":None,"identity_status":"NEEDS_ADJUDICATION"}]
        self.assert_valid(self.receipt,x)

    def test_ambiguous_finding_cannot_claim_stable_fingerprint(self):
        x=self.sample_receipt()
        x["finding_identities"]=[{"finding_id":"F-1","fingerprint_version":"v1",
          "fingerprint":"f"*64,"canonical_finding_id":None,"identity_status":"NEEDS_ADJUDICATION"}]
        self.assert_invalid(self.receipt,x)

    def test_canonical_identity_requires_real_fingerprint_and_canonical_id(self):
        x=self.sample_receipt("COMPLETE")
        x["finding_identities"]=[{"finding_id":"F-1","fingerprint_version":"v1",
          "fingerprint":"f"*64,"canonical_finding_id":"cf:one","identity_status":"CANONICAL"}]
        self.assert_valid(self.receipt,x)
        x["finding_identities"][0]["canonical_finding_id"]=None
        self.assert_invalid(self.receipt,x)

    def test_tool_success_envelope_with_nested_receipt_valid(self):
        self.assert_valid(self.envelope,self.sample_envelope(self.sample_receipt()))

    def test_tool_envelope_missing_request_id_denied(self):
        x=self.sample_envelope(self.sample_receipt());del x["request_id"]
        self.assert_invalid(self.envelope,x)

    def test_tool_success_must_have_receipt(self):
        x=self.sample_envelope(self.sample_receipt());x["result"]=None
        self.assert_invalid(self.envelope,x)

    def test_tool_error_has_null_result(self):
        x=self.sample_envelope(self.sample_receipt());x["status"]="ERROR";x["result"]=None
        self.assert_valid(self.envelope,x)

    def test_plugin_manifest_has_codex_required_metadata(self):
        manifest=json.loads((ROOT/"chatgpt/.codex-plugin/plugin.json").read_text())
        self.assertTrue(manifest.get("author",{}).get("name"))
        for field in ("displayName","shortDescription","longDescription","developerName",
                      "category","capabilities"):
            self.assertTrue(manifest.get("interface",{}).get(field),field)
        self.assertEqual(manifest.get("skills"),"./skills/")
        self.assertEqual(manifest.get("mcpServers"),"./.mcp.json")

    def test_plugin_skill_yaml_has_interface_metadata(self):
        yaml=(ROOT/"chatgpt/skills/github-pr-review/agents/openai.yaml").read_text()
        self.assertIn("interface:",yaml)
        self.assertIn("display_name:",yaml)
        self.assertIn("short_description:",yaml)
        self.assertIn("dependencies:",yaml)


if __name__ == "__main__":
    unittest.main()
