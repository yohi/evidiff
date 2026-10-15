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
