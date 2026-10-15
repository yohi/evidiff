# Evidiff — Independent PR Review Design v0.1

設計基準日: 2026-10-16 (JST)
状態: **PROPOSED / NOT_IMPLEMENTED / NOT_RUNTIME_VERIFIED**

ChatGPT Web PluginとGemini Web Skills（Gem移行期はGem互換）から、共通Remote MCPを通してGitHub Pull RequestのSHA固定証跡を取得し、それぞれ独立にレビューするための設計です。

## Design documents

- [Architecture and threat model](docs/DESIGN.md)
- [Read-only MCP tool contract](contracts/MCP_TOOLS.md)
- [Snapshot JSON Schema](contracts/review-snapshot.schema.json)
- [Review result JSON Schema](contracts/review-result.schema.json)
- [Shared review policy](contracts/REVIEW_POLICY.md)
- [ChatGPT Web draft](chatgpt/skills/github-pr-review/SKILL.md)
- [Gemini Web draft](gemini-web-skill/SKILL.md)
- [G0–G4 acceptance criteria](tests/ACCEPTANCE_MATRIX.md)
- [Source references](sources/SOURCES.md)

## Initial scope

MCP provides **read-only** evidence. Neither Web client may push code, post a PR review, merge, approve or execute repository code. Fail closed when auth, SHA pinning, coverage or diff evidence cannot be verified. No live MCP deployment exists; the MCP URL is a placeholder.

## Gate

G0 (live ChatGPT Web + Gemini Web Skill-to-MCP orchestration) is unverified. Do not advance to implementation or deployment without a recorded outcome. The schemas and Skills are **proposals**, not operational integrations.


## Design Revision R1 (v0.2, 2026-10-16)

Independent design review of PR #1 found 4 High + 4 Medium issues. The proposed correction and decision mapping are in [docs/REVISION_R1_20261016.md](docs/REVISION_R1_20261016.md). The v0.2 Schema, read-only semantic validation Receipt and redaction safeguards supersede earlier examples. **Not independently accepted; not implemented or deployed.** ChatGPT plugin root is [chatgpt/](chatgpt/) with .codex-plugin/plugin.json and .mcp.json.

**R1 follow-up:** MCP tool sample version normalized to v0.2; Gemini Gem fallback instructions include the server-side Receipt requirement.


## R2 limited correction — independent recheck

R1-IR-001..005 are addressed by a second design/contract proposal: [R2 design correction](docs/REVISION_R2_20261016.md). Added Draft2020-12 preflight, LEFT/FILE_SPAN delivered-line checks, required Codex plugin fields, a nested Receipt envelope, and unambiguous fingerprint identity rules. New offline Node/Python tests and [CI](.github/workflows/offline-contracts.yml) do not constitute deployed MCP or independently accepted closure.

**R2-FIX-001:** GitHub Actions caught a missing RFC3339 date-time checker; the offline schema gate now rejects missing format support and installs jsonschema[format] explicitly. CI pass is required before independent re-review.
