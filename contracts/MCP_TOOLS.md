# Remote MCP Read-only Tool Contract — Proposal v0.2 (R1)

**Status:** NOT_IMPLEMENTED. Tool名・JSONは本プロジェクトが実装する予定の独自スキーマであり、GitHub/MCP標準の既存ツール名ではない。

## 0. 共通型・制御
- URL: `https://github.com/{owner}/{repo}/pull/{number}`。redirect/外部host/任意path禁止。PR番号は正整数。
- `snapshot_id`: 作成済み固定スナップショット。初回を除き必須。
- `request_id`: サーバーが生成する非機密の監査ID。
- `cursor`: 不透明文字列。principal / snapshot_id / tool / filters / expiryと結合。改変・越境を拒否。
- `evidence_ref`: `ev:<snapshot-id-prefix>:<object-id>`形式の不透明識別子。GitHubのpermalinkと別に、証拠のハッシュ/取得元をサーバーで解決可能にする。
- `errors`: `AUTH_REQUIRED`, `ACCESS_DENIED`, `INVALID_PR_URL`, `PR_NOT_FOUND`, `SNAPSHOT_STALE`, `SOURCE_NOT_FOUND`, `SOURCE_NOT_AVAILABLE`, `PATCH_UNAVAILABLE`, `RATE_LIMITED`, `BUDGET_EXCEEDED`, `DIFF_INCONSISTENT`, `GITHUB_API_ERROR`, `INTERNAL_ERROR`。
- すべての結果は`schema_version`, `request_id`, `snapshot_id` (初回成功時のみ), `status`, `provenance`, `limitations`を含む。エラー時に成功風の空結果を返さない。
- `max_response_bytes` / `per_tool_timeout`はサーバー強制。本文/リポジトリ原文を監査ログへ出さない。
- MCPツール定義のannotationsはread-only/idempotent/non-destructiveを提示するが、信頼境界は**コードで強制**する。GitHub write APIのCredentialやrouteを構成しない。

## 1. `open_pr_snapshot`

**目的**: PR URLから固定入力を作成する。**GitHubへの書き込みなし**。snapshotの内部キャッシュ作成は許可する。

```json
{
  "pr_url": "https://github.com/example/project/pull/42",
  "selection_policy": "default-v1"
}
```

出力例（数値やSHAは例示、**PARTIALでありSnapshot READYを証明しない**）：

```json
{
  "schema_version": "0.2.0",
  "request_id": "req-example",
  "status": "PARTIAL",
  "snapshot_id": "sha256:example-placeholder",
  "pr": {
    "repo_id": "10001", "repo_full_name": "example/project", "number": 42,
    "base_sha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "head_sha": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "merge_base_sha": "cccccccccccccccccccccccccccccccccccccccc"
  },
  "file_count_reported": 3,
  "diff_integrity": "UNVERIFIED",
  "provenance": [{"source": "github_rest", "resource": "pulls/42"}],
  "limitations": []
}
```

**設計条件**: APIレスポンス読み取り前後でPR ID・SHAを照合。force push中は新しいSnapshotを作り直すか`STALE`。`selection_policy`はサーバーに登録済みIDのみ許可し任意設定を受け付けない。

## 2. `list_changed_files`

```json
{"snapshot_id":"sha256:...", "cursor":null, "page_size":100}
```

返却情報: `files[]`: `path`, `previous_path`, `status`, `added`, `deleted`, `binary`, `patch_available`, `scope`(INCLUDED / EXCLUDED_BY_POLICY / UNAVAILABLE), `patch_sha256`, `line_map_available`; `next_cursor`, `reported_total`, `returned_total`, `known_missing`, `coverage_status`, `limitations`。

**完了条件**: 固定merge-base/head Git objectの完全なManifest・Hunkを再構築して正しさを証明する。PR Files API件数一致は補助情報でありREADYの必要十分条件ではない。GitHubのAPI上限3000を超えたときは`PARTIAL`。ファイルのpatchが欠落していてもファイルが存在することを記録する。

## 3. `get_diff_hunks`

```json
{"snapshot_id":"sha256:...", "path":"src/guard.ts", "cursor":null, "max_bytes":65536}
```

返却: 変更行side/old_line/new_line/hunk、raw_patchの一部、`hunk_ids[]`, `evidence_ref`, `content_sha256`, `truncated`, `next_cursor`, `limitations`。

変更行と文脈行を区別する。delete-onlyのLEFT位置とnew-sideのRIGHT位置を混同しない。`patch`がGitHub APIから取得できない場合に存在しないHunkを生成しない。Git object経由の固定Diffで代替できる場合はprovenanceとして明記。

## 4. `read_file_at_snapshot`

```json
{"snapshot_id":"sha256:...", "path":"src/auth.ts", "ref_side":"head", "start_line":1, "end_line":160}
```

返却: `repo_id`, `commit_sha`, `path`, `lines[]`, `total_lines`, `encoding`, `raw_sha256`, `returned_span_sha256`, `evidence_ref`, `binary`, `lfs_pointer`, `truncated`, `limitations`。

**安全条件**: path traversal/絶対パス拒否、refは`head`/`base`/`merge_base`固定、ブランチ名引数禁止。指定SHAから取得した原文であることを検査。Private Repo ACLを再チェック。

## 5. `search_at_snapshot`

```json
{"snapshot_id":"sha256:...", "query":"AuthorizationService", "glob":"src/**/*.ts", "max_results":30}
```

返却: `matches[]`: `path`, `line`, `snippet`(幅制限), `commit_sha`, `evidence_ref`; `search_coverage`, `truncated`, `limitations`。

**禁止**: 最新default branchにしか索引のない検索APIを、commit固定検索と偽ること。検索が本当にfixed commitに紐付くことを検証できないときは`SOURCE_NOT_AVAILABLE`。

## 6. `get_pr_related_evidence`

```json
{"snapshot_id":"sha256:...", "kinds":["ci_checks","issue_links","review_threads"], "cursor":null}
```

返却: `items[]`: type, title/status, source URL, source SHA/ref、観測時刻、証拠参照、`next_cursor`, `limitations`。

**注意**: Issue本文/PR本文/既存コメントはuntrusted assertions。CI結果は対象commit SHAとの紐付きが取れなければ証明根拠にしない。チェック情報の取得権限がない場合は`NOT_FETCHED_PERMISSION`。

## 7. `get_snapshot_status`

```json
{"snapshot_id":"sha256:...", "verify_live_head":true}
```

返却: `snapshot_status`(READY/PARTIAL/FAILED/STALE), `baseline_digest`, `evidence_coverage`(MCP-owned), `snapshot_head_sha`, `snapshot_base_sha`, `snapshot_merge_base_sha`, `current_head_sha`, `current_base_sha`, `current_merge_base_sha`, `head_moved`, `base_moved`, `merge_base_moved`, `identity_changed`, `stale_reasons[]`, `checked_at`, `access_still_valid`, `evidence_ledger_digest`, `budget_usage`, `warnings`。LLMが読解したファイル数はMCPが勝手に計上しない。

MCPは各モデルが「読んだ」かどうかを正確に把握できない。**MCP ledgerは取得済み証拠を示すもので、LLMが実際に検討した範囲と同値ではない**。最終review_resultの`reviewed_paths`はモデル側が主張する情報であり、MCP台帳との突合が必要。

## 8. ツール追加の判断
- P2候補: `get_symbol_references_at_snapshot`（AST/LSIF/静的index必要）。
- P3候補: `get_test_evidence`（既存CIの読み取りのみ）。
- v0.1禁止: `post_pr_review`, `approve_pr`, `push_commit`, `merge_pr`, `execute_shell`, `fetch_any_url`, `manage_credentials`。

## 9. 標準GitHub RESTとの対応
- PR情報: `GET /repos/{owner}/{repo}/pulls/{pull_number}`
- PR files: `GET /repos/{owner}/{repo}/pulls/{pull_number}/files` (最大3000ファイル)
- 比較/コミット原本: commit/tree/blob API or bounded read-only Git object fetch
- CI Check: `GET /repos/{owner}/{repo}/commits/{ref}/check-runs` 等（read:Checks必須の場合あり）
- Reviews: PR reviews/comments API（read:Pull requests）

参照 https://docs.github.com/en/rest/pulls/pulls 、 https://docs.github.com/en/rest/checks/runs 、https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization

## v0.2 normative addendum (supersedes earlier sections)

**Eighth read-only tool: validate_review_result.**
- Input: snapshot_id, ReviewResult v0.2 candidate.
- Server-owned inputs: authenticated principal, immutable Snapshot and manifest, committed Git object/hunk proofs, ACL-bound evidence delivery ledger, fresh PR HEAD/base/merge-base.
- Output: validated-review-receipt.schema.json including accepted status, typed refusal reasons, digest of snapshot and result, verified reviewed count, checked live SHAs and finding fingerprint grouping. Receipt with signature=null is not cryptographically signed.
- COMPLETE requires exact manifest partition; included=reported=enumerated=attested verified path count, excluded=unavailable=0, diff_integrity/line maps VERIFIED, all attestation refs valid and delivered, no blocked security evidence, no source/analysis gaps, no fresh SHA drift. Model claim alone cannot upgrade. This tool does not mutate GitHub or run PR code.

**Git object contract:** Every READY manifest/diff derives from immutable merge_base_sha and head_sha tree/blob contents and verified hunk map. PR Files API is a diagnostic hint only, not immutable input, regardless of paging success. Raw Git object digest and exposed source SHA-256 are distinct.

**Typed evidence:** DIFF_LINE requires verified LEFT old-line + old path or RIGHT new-line + new path, hunk_id and evidence_ref; FILE_SPAN must match exact SHA-scoped file bounds; PR_LEVEL intentionally carries no file/line. Block incorrect rename/side anchoring.

**Secret gate:** scan all model-visible responses including source/patch/search/PR metadata/CI/error and logs; raw source/hash server-only; exposed redacted bytes have separate hash and redaction_state. Block unmaskable/uncertain secrets, mark PARTIAL. Do not claim universal detection of unknown credentials.

**Freshness:** get_snapshot_status returns current/snapshot base, head and merge-base SHA and moved flags/reasons. A base change is STALE even if merge-base stays the same. Validator repeats check at final Receipt issuance.

**Fingerprints:** canonical v1 from repo_id, verified path alias + symbol identity, enumerated category, controlled root cause and trigger; no line, prose or model name. No auto-resolve/reopen without separate registry proof.

See docs/REVISION_R1_20261016.md and tests/ACCEPTANCE_MATRIX.md. The original sections 8–9 are retained as historic extension/API references, not current tool count.


## R2 authoritative tool contract (supersedes conflicting older examples)

validate_review_result's successful MCP response MUST have **outer** fields schema_version, request_id, snapshot_id, status=SUCCESS, provenance[], limitations[] and result, where result validates against validated-review-receipt.schema.json. For error response, use status=ERROR and result=null with generic nonsecret limitations. Validate outer against validation-tool-response.schema.json.

The server MUST validate Snapshot and ReviewResult with strict JSON Schema Draft 2020-12 (required and additionalProperties) before semantic validation. A schema failure never produces COMPLETE. For normal non-renamed modified/deleted DIFF_LINE LEFT evidence, oldPath=path; for verified rename, oldPath=previous_path. FILE_SPAN's claimed interval must be within lines **delivered** in the referenced ledger event and match pinned commit, content digest and redaction state; the whole-file length is insufficient.

A complete Receipt must be server-authored and tied to the authenticated user's snapshot, not model-generated. For ambiguous Finding identity, fingerprint and canonical_finding_id are null, with status NEEDS_ADJUDICATION or PROVISIONAL. See docs/REVISION_R2_20261016.md.


## R2-IR-NEW-001 / NEW-002 — Limited follow-up contract (2026-10-16)

Review baseline: HEAD 1a3caf1afa9452bbea2d32dc3ade798aee768cf2. Both findings remain **RESOLVED_IN_PROPOSAL ONLY / PENDING FRESH INDEPENDENT RECHECK** following the correction commit.

### NEW-001: snapshot acquisition and evidence delivery use distinct digest domains

- **Acquisition/capture digest**: snapshot.evidence_ledger_digest is sealed at the immutable Snapshot capture. For READY it MUST be a non-null lowercase SHA-256 of a versioned canonical representation of server-verified repository_id, selected PR SHA triple, selection policy ID, frozen manifest digest and the acquisition file manifest. It is **not** the running tool-delivery ledger; a missing capture digest makes READY/COMPLETE impossible.
- **Delivery digest**: review.evidence_ledger_digest is the model-proposed digest of the server's *per-principal, ACL-bound append-only evidence delivery prefix*. The model must also supply review.evidence_delivery_epoch (nonnegative, monotonically increasing delivery event count). Each actual outgoing evidence response creates an ordered delivered event (sequence, authenticated principal, snapshot ID, evidence_ref, source commit/ref side, line interval, redaction state, SHA-256 of emitted sanitized bytes). The trusted server recomputes both prefix digest and epoch from these event bytes/metadata, not from user-provided digests or arbitrary live fields.
- **Submission-time binding**: when the model finalizes, validator atomically fences the current delivery epoch, recomputes the digest, and rejects nulls, arbitrary strings, mismatched epoch or missing delivery sequence. If new tool evidence arrives after submission, conservative v0.2 returns PARTIAL/STALE-like retry reason (DELIVERY_EPOCH_MISMATCH); the model must resubmit based on a new frozen prefix. Later evidence MUST NOT be silently considered as reviewed or retroactively change a published receipt.
- **Explicit distinction**: snapshot acquisition digest is stable once sealed, but the delivery digest legitimately changes as evidence is sent. Requiring snapshot.evidence_ledger_digest == review.evidence_ledger_digest would be incorrect. Integrity checks are two independently recomputed equations: server-captured acquisition bytes/digest == snapshot acquisition digest, and SHA-256(server-owned delivered prefix) == review digest == live server digest, with matching epoch. Three-way equality between merely supplied nullable values cannot certify either.
- **Canonicalization**: the offline reference uses versioned fixed-field JSON object material and Node SHA-256 for reproducibility. Production must pin an interoperable canonical byte representation (for example RFC 8785 JCS), hash domain separators, scoped repository/principal binding, manifest/snapshot policy and revocation rules. The test ledger does not verify GitHub's raw Git bytes and does not provide production cryptographic provenance. A format-valid 64-hex digest in a Schema is necessary but not proof of underlying content integrity.
- **Refusal**: missing/incorrect capture digest => MISSING_ACQUISITION_DIGEST or ACQUISITION_DIGEST_MISMATCH; missing delivery digest => MISSING_DELIVERY_DIGEST; malformed delivery log => DELIVERY_LEDGER_INVALID; wrong digest => DELIVERY_DIGEST_MISMATCH; inconsistent sequence/epoch => DELIVERY_EPOCH_MISMATCH. Schema additionally forbids null capture for READY and null delivery digest for COMPLETE. A failed check cannot issue COMPLETE.

### NEW-002: server response envelope/receipt snapshot binding

- Outer envelope schema and inner Receipt schema remain independent Draft2020-12 documents. A schema-valid envelope is **not yet semantically valid**.
- The server MUST verify outer snapshot_id == inner result.snapshot_id == authenticated request's expected snapshot ID **before** returning SUCCESS. Also match server-generated request_id to current request context. Mismatch => ENVELOPE_RECEIPT_SNAPSHOT_MISMATCH or ENVELOPE_REQUEST_ID_MISMATCH; never publish or consume a COMPLETE Receipt.
- With ERROR status, result=null and outer snapshot_id must still match authenticated request context. Schema failure => SCHEMA_ENVELOPE_INVALID, never accepted. A valid PARTIAL Receipt may produce SUCCESS at the tool-call level but must not be described as review COMPLETE.
- The offline reference exports validateToolEnvelope() and checks both schema and semantic binding. This is not a real server and does not authenticate users or issue genuine receipts.

### Validation evidence and pending gates

The expanded Node test suite adds the three-null regression, null capture, null proposal, null trusted live digest, arbitrary matching digest, epoch drift, late delivery, missing sequence, modified exposed digest, and Envelope/Receipt snapshot/request mismatch tests. Python schema tests add nulls and demonstrate that cross-object equality requires semantic checking. GitHub CI results must be read from the fixed correction HEAD independently. G0-G4 remain NOT PROVEN. Do not merge PR #1 or authorize private-repo scope on this basis.

## R2-IR-NEW-003 — Canonical Payload v2 / full-field integrity (normative correction)

This section supersedes every v1 canonicalization/field-selection description in R1/R2 and is **limited to the offline contract proposal**. The R2-IR-NEW-003 independent review found that captureDigest omitted pull_request_number, binary and line_map_available and that deliveryDigest omitted old_path and total_lines.

### Acquisition digest — evidiff.capture.v2

The captured Snapshot SHA-256 covers ALL fields of the full Draft 2020-12-validated Snapshot object, with exactly one exclusion: evidence_ledger_digest (which cannot hash itself). This includes repository identity, repository full name, pull_request_number, snapshot_id, selected policy, created_at, state, pinned SHA triple, every member of every file (binary, line_map_available, old/new path, statuses, content_state, digests and counts), all evidence_coverage fields and limitations. Every Schema-accepted field automatically participates. The sealed digest must be compared against an independently recomputed value; format/non-null alone is not an integrity proof.

### Delivery digest — evidiff.delivery.v2

The SHA-256 covers the sealed capture digest, snapshot_id, delivery epoch and ALL properties of every delivered event, not an allowlist. The authoritative dictionary entry key is bound as event id, and cannot be shadowed by an id property within the event. Events are ordered by verified contiguous delivery_seq, and contain old_path, total_lines, hunk/line, commit SHA, ref_side, source_type, redaction state, response exposed_digest and any future event metadata. Changing the ledger key or any value must invalidate the recomputed digest or fail event validation. Nulls, malformed sequence and unproven delivery fail closed.

### Canonical bytes / compatibility

The reference encoding canonical-json-v2 recursively sorts JSON object member names by JavaScript UTF-16 code unit order, retains array order, uses JSON escaping, rejects cyclic, nonfinite, undefined, non-JSON values; SHA-256 is over its UTF-8 bytes. Domain fields and versions differentiate capture from delivery. This is **not** a claim of RFC 8785/JCS compliance; production or cross-language consumers require an explicit interoperability suite and a normative encoding standard decision. Digest v1 must not be interpreted as v2 or silently accepted.

### Trust restrictions

The reference hashes synthetic JSON objects and delivery entries; a production server must independently compare these with original immutable Git objects, sealed manifest byte content, actually emitted sanitized response bytes and authenticated/principal-scoped ledger events. An attacker that can replace both trusted data and the local recomputed hash is not prevented by hashing alone. The server must protect the seal and enforce authorization, revalidation, provenance and epoch fencing. This correction does NOT establish G0–G4 and does NOT authorize Private Repo use or PR #1 merge.

### Test contract

Negative regression tests alter pull_request_number, binary, line_map_available, every major Snapshot field, old_path, total_lines, commit/ref-side, line/hunk, delivery intervals, redaction and event key, and assert no COMPLETE. Positive tests verify canonical member-order independence and distinct capture/delivery domains. This is a proposal-only revision pending independent limited recheck on the new fixed HEAD.
