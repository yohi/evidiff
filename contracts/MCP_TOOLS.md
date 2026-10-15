# Remote MCP Read-only Tool Contract — Proposal v0.1

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

出力例（数値やSHAは例示）：

```json
{
  "schema_version": "0.1.0",
  "request_id": "req-example",
  "status": "READY",
  "snapshot_id": "sha256:example-placeholder",
  "pr": {
    "repo_id": "10001", "repo_full_name": "example/project", "number": 42,
    "base_sha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "head_sha": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "merge_base_sha": "cccccccccccccccccccccccccccccccccccccccc"
  },
  "file_count_reported": 3,
  "diff_integrity": "NOT_YET_VERIFIED",
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

**完了条件**: 100件ずつ読み込み、`reported_total == 全ページ累積数`を照合。GitHubのAPI上限3000を超えたときは`PARTIAL`。ファイルのpatchが欠落していてもファイルが存在することを記録する。

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

返却: `snapshot_status`(READY/PARTIAL/FAILED/STALE), `baseline_digest`, `coverage`: reported/returned/included/excluded/unavailable/unreviewed, `current_head_sha`, `head_moved`, `access_still_valid`, `evidence_ledger_digest`, `budget_usage`, `warnings`。

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