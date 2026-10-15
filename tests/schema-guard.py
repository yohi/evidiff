#!/usr/bin/env python3
"""Evidiff offline reference JSON Schema gate; no GitHub/MCP I/O and no code execution from PRs."""
import json
import sys
from pathlib import Path
from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource

BASE = Path(__file__).resolve().parent.parent / "contracts"


def validate_envelope(envelope):
    try:
        receipt = json.loads((BASE / "validated-review-receipt.schema.json").read_text(encoding="utf-8"))
        schema = json.loads((BASE / "validation-tool-response.schema.json").read_text(encoding="utf-8"))
        Draft202012Validator.check_schema(schema)
        Draft202012Validator.check_schema(receipt)
        checker = FormatChecker()
        if "date-time" not in checker.checkers or checker.conforms("not a date", "date-time"):
            return {"valid": False, "reason_codes": ["SCHEMA_FORMAT_CHECKER_UNAVAILABLE"]}
        registry = Registry().with_resource(receipt["$id"], Resource.from_contents(receipt))
        v = Draft202012Validator(schema, registry=registry, format_checker=checker)
        if any(v.iter_errors(envelope)):
            return {"valid": False, "reason_codes": ["SCHEMA_ENVELOPE_INVALID"]}
        return {"valid": True, "reason_codes": []}
    except Exception:
        return {"valid": False, "reason_codes": ["SCHEMA_ENVELOPE_UNAVAILABLE"]}


def validate(snapshot, review):
    result = []
    for field, filename in (
        ("snapshot", "review-snapshot.schema.json"),
        ("review", "review-result.schema.json"),
    ):
        try:
            schema = json.loads((BASE / filename).read_text(encoding="utf-8"))
            Draft202012Validator.check_schema(schema)
            format_checker = FormatChecker()
            # A bare jsonschema install may silently omit the RFC3339 date-time checker.
            # Never treat unknown/unregistered formats as successful validation.
            if "date-time" not in format_checker.checkers or format_checker.conforms("not a date", "date-time"):
                result.append("SCHEMA_FORMAT_CHECKER_UNAVAILABLE")
                continue
            checker = Draft202012Validator(schema, format_checker=format_checker)
            if any(checker.iter_errors((snapshot if field == "snapshot" else review))):
                result.append("SCHEMA_" + field.upper() + "_INVALID")
        except Exception:
            result.append("SCHEMA_" + field.upper() + "_UNAVAILABLE")
    return {"valid": not bool(result), "reason_codes": result}


if __name__ == "__main__":
    try:
        request = json.load(sys.stdin)
        out = (validate_envelope(request["envelope"]) if "envelope" in request else
               validate(request.get("snapshot"), request.get("review")))
        print(json.dumps(out, ensure_ascii=True))
    except Exception:
        print(json.dumps({"valid": False, "reason_codes": ["SCHEMA_GATE_ERROR"]}))
