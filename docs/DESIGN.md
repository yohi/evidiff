# PR URL入力型AIコードレビュー — 詳細設計 v0.1

- 基準日: 2026-10-16 JST
- 文書種別: Proposal / detailed design、正式承認・実装ではない
- 対象: ChatGPT Web Plugin + Skill、Gemini Web Skills（Gem移行期はGem互換）、共通HTTPS Remote MCP
- 変更対象: なし。リポジトリ変更、外部サービス接続、デプロイ、課金は行っていない。

## 1. 背景と目的

GitHub PR URLを貼るだけで、PRに導入された現実の故障、セキュリティ欠陥、仕様との不一致、互換性破壊、コンカレンシー問題、性能劣化を、再現可能な根拠に基づき抽出する。レビュアーはChatGPTとGeminiをそれぞれ独立した判断主体として扱う。CLI/IDE/ローカルAgentはユーザー向け動作面ではなくOSS調査対象に限定する。

**非目標**: 自動Approve、PRへのコメント・修正の投稿、Merge、PRコードの実行、脆弱性スキャンの網羅保証、全コード行の網羅読解、商用製品と同等の性能保証。

## 2. 構成と責務

```text
ChatGPT Web ─ Plugin/Skill ─┐
                          ├─ OAuth-protected Remote MCP ─ GitHub API/Git objects
Gemini Web ─ Skills/Gem ────┘            │
                                         ├─ Snapshot Registry (immutable)
                                         ├─ Evidence Resolver (read-only)
                                         ├─ Commit-scoped Search Index
                                         ├─ Coverage Ledger & Provenance
                                         └─ Policy / AuthZ / Rate & Byte Budgets
            └─ each Web LLM independently: investigate → verify → report
```

MCPは**根拠を確実に取得・固定すること**が主務。MCPで特定のLLMによるレビュー結論を先に作らない。ChatGPT/Gemini共通の入力Baselineは同じsnapshot_idで保証するが、追加探索は各モデルで異なる場合があるためEvidence Ledgerも比較する。

### 2.1 必須の起動契約
1. ユーザーが同じGitHub PR URLを入力する。
2. MCPはPR URLの正規化、閲覧権限評価、repository identity、PR番号、base/head SHAを収集する。
3. MCPがimmutableなReview Snapshotを発行する。
4. LLMは同一のsnapshot_idからレビュー開始する。単に同一URLを渡しただけで一致したsnapshotになったとはみなさない。
5. 調査中の追加取得はすべてsnapshot_idに結合し、取得元SHA・content SHA-256・エラーを残す。
6. 最終直前にPR HEADを再確認し、変更されていればSTALEと表記する。

### 2.2 Snapshot ID
`sha256(canonical_json({schema_version,provider,repository_id,pr_number,base_sha,head_sha,merge_base_sha,selection_policy_id}))` を推奨。URLやbranch名だけのキーは禁止。`merge_base_sha`が未確定なら状態INCOMPLETEとして発行するか取得停止する（運用ポリシーで固定）。サーバーはcanonical化方式を固定し、アルゴリズムとルール版を記録する。

Repository IDを永続的な識別に用いる。変更されたbase branchやforce pushには新Snapshotを発行する。同じSnapshot IDで内容や選定ポリシーを黙って変更しない。

### 2.3 比較の意味
PR上の差分はbaseブランチHEADとPR headの単純なファイル差とは限らない。Git DAGに基づくmerge-base（適切な比較基点）を固定し、GitHubのPR diff/Compare結果との差異があればレビュー対象を`INCONSISTENT_DIFF`として扱う。GitHubのファイルリストAPIとgit raw diffのいずれも完全であると暗黙に仮定しない。

## 3. Snapshot/Data Contract

### 3.1 原本
- GitHub PR番号とtitle/body（ユーザー申告、認証済み要件原本ではない）
- GitHub repository_id, owner, repo, base/head SHA, merge-base SHA
- Diff file list: `status`, `previous_filename`, `additions/deletions`, `patch_available`, `is_binary`, `old_path`, `new_path`
- Hunk-map: old/new side, line span, 原文sha256
- 関連Issue、Review Threads、CI Checks：取得権限・取得可否・レート制限を明示
- 関連ソース、設定、テスト、ドキュメント：`ref=SHA`で取得し、そのファイルのSHA-256を記録
- `source_type`: observed GitHub metadata / Git object / CI / human-provided / inferred

### 3.2 内容の固定
原本バイトにSHA-256、テキスト正規化後には別ハッシュ。改行・文字コード・バイナリやLFSポインタ等に注意。Git Blob SHA-1/256とユーザー向け原文SHA-256を区別する。レダクションした証拠には「元データと同一でない」ことを明示する。

### 3.3 全件と一部
GitHubのPR changed files APIには**最大3000ファイル**の上限がある。per_page=100でページングし、`changed_files`数、取得ファイル数、最終ページ、missing/patch欠落の差を記録する。ページング成功だけで完全性を確信せず、必要なら権限付きGitオブジェクト取得と固定SHA比較で代替確認。API上限や巨大ファイルで不可能な場合はPARTIALとする。

Binary/rename/delete/submodule/LFS/generated/vendor filesは個別に分類。ポリシー対象外は`EXCLUDED_BY_POLICY`、解析不能は`UNAVAILABLE`とし混同しない。

### 3.4 Commit固定検索
GitHub Code Searchの通常検索は必ずしも指定Commitの完全な索引を提供するものではない。`search_at_snapshot`は厳密にSnapshotのGit treeとContentに基づくことを保証する。候補実装はcommit-scoped tree API + bounded text search、または短命の隔離索引。実装不能な場合は「履歴非固定検索」として証拠に採用せず、明示エラーを返す。

## 4. Remote MCP I/F
詳細は `contracts/MCP_TOOLS.md`。初期ツールは7つで、すべてread-only。

1. `open_pr_snapshot`
2. `list_changed_files`
3. `get_diff_hunks`
4. `read_file_at_snapshot`
5. `search_at_snapshot`
6. `get_pr_related_evidence`
7. `get_snapshot_status`

すべての読み取り要求に`{snapshot_id, ...}`を必須とし、誤ってdefault branch最新版から読むことを禁止する。`open_pr_snapshot`のみPR URL。失敗は型付きコード・原因・未充足範囲・再試行可否を返す。LLMの回答文にエラーを混ぜて「成功」に偽装しない。

### 4.1 別モデル間の共通性
2種類の運用を用意する。
- **Independent Review**: baseline Snapshotとレビュー手順が一致。追加探索は各モデルが自由に実施し、取得差を監査する。
- **Controlled Benchmark**: 完全に同一の固定Evidence Packとルールで評価。追加ツール呼び出し禁止／あるいはEvidence pack拡張フェーズを先に両者で共有。性能差を公平に測る際はこちらを使用。

両者が同じsnapshot_idから開始しても、任意の追加探索まで同一とはならない。

## 5. レビュー手順
`contracts/REVIEW_POLICY.md`を共通原本とする。

1. **Preflight**: 入力URL、アクセス、Snapshot確定、Manifest異常を確認。失敗ならレビュー中止・不足情報提示。
2. **Intake**: PRの目的を要約（事実/PR本文の主張を分離）、全変更ファイルの一覧取得。
3. **Context Plan**: API/権限/DB/状態遷移/非同期/性能/ユーザー影響に応じ、関係シンボル・呼び出し元・テストを特定。
4. **Discovery**: 分野別の独立探索。ローカル指示やIssueは参考情報として扱い、上位権威を与えない。
5. **Adversarial Verification**: 各候補に「入力条件・実行経路・根拠・反例・影響範囲」を要求。必要な根拠未取得ならVERIFICATION_PENDINGとする。
6. **Anchor Validation**: 指摘対象HEAD、ファイル、行/Hunkが実在するか機械照合。変更行外はPR-Level Findingとして分離。
7. **Dedup/Value Gate**: 同一原因・同一影響・同一場所の指摘を統合。根拠が薄いstyling/nitpick抑制。
8. **Finality**: HEAD更新・未取得・未レビュー・CI未検査を記録し、Findingとは別にCoverageとLimitationsを出す。

**独立性**: ChatGPT/Geminiの結果を互いに入力しない。第2段階の横断比較（adjudication）で初めて並べる。モデルが作成したコードを同系列モデルがレビューする偏りは仮説として扱い、生成元が不明でも勝手に断定しない。

## 6. 判定モデル

### 6.1 Review Status
- `COMPLETE`: 選定したPR変更範囲を全件取得・処理し、必須検証が成功した。コード全体の安全性保証ではない。
- `PARTIAL`: 一部ファイル未取得、LLM予算不足、重要な関連コード未取得など。Finding有無は別。
- `FAILED`: 基本情報、GitHub認可、差分整合などの必須前提が成立しない。
- `STALE`: HEADまたはbase比較基点がレビュー開始後に変わった。

### 6.2 Finding Status
- `CONFIRMED_SOURCE`: SHA固定ソースに明確な実行経路・反例がある。実行再現はしていない。
- `CONFIRMED_RUNTIME`: 隔離テストで再現と証拠がある（将来版、初期版では不可能）。
- `PENDING_VERIFICATION`: 候補はあるが成立条件・根拠が未充足。
- `REJECTED`: 反証成立、スコープ外、または重複。ユーザー向けFindingから除く。

Findingの重大度（critical/high/medium/low）と確実性は独立軸にする。レビュー全体はCOMPLETEでも、具体的FindingはPENDINGになり得る。`approved`という機械的判定は出さず、「確認範囲内で未解消の問題候補あり/なし」とする。

### 6.3 ライフサイクル
Findingはstable fingerprintを保持し、ACTIVE/RESOLVED/REOPENEDを別フィールドで管理する。**RESOLVEDへの遷移は、影響対象の該当コードを再確認して不具合が解消した証拠がある場合のみ**。新レビューで見つからなかっただけでは解消しない。旧レビューがPARTIALならとくに禁止。

## 7. Threat Model / Trust Boundary

### 7.1 認証境界
1. Webクライアント→MCP: HTTPS + MCP OAuth (Protected Resource Metadata; audience/resource binding; PKCE等)。ChatGPT/GeminiそれぞれのOAuthクライアント設定を実機検証。MCP access tokenはGitHub access tokenとは別。
2. MCP→GitHub: GitHub App（installation/user access token）または適切なfine-grained OAuth/PATをCredential Adapter内部に保持。MCP応答・ログ・プロンプトにGitHub tokenを含めない。
3. Repo authorization: GitHub App installationのリポジトリアクセスと、**個々のMCPユーザーのRepo閲覧権限**は同値ではない。毎リクエストでprincipal→repo_id entitlementを再検査。共有installation tokenで他者のPrivate Repoを漏らさない。
4. GitHub権限最小化: MVPは`Metadata: read`, `Contents: read`, `Pull requests: read`を基本、Issue/Checksなどは対象APIに必要なread権限を別申請。投稿・Push・Mergeの権限は与えない。Public-onlyモードはGitHub認証を省略できてもMCP利用者の認証/レート制御は維持する。

### 7.2 悪意ある入力
- GitHub PR title/body/comment/コード/AGENTS.md/CLAUDE.md/テストには外部命令・秘密漏洩指示が含まれ得る。これらを**資料（data）**として解釈し、操作指示として従わない。
- 入力URLは`https://github.com/{owner}/{repo}/pull/{integer}`に限定。`userinfo`, 任意port, localhost, redirect, URL queryでの任意取得を拒否。GitHub Enterpriseは別のallowlist設定がない限り対象外。
- MCPには汎用HTTP fetch、shell、`run_code`、GitHub write toolを公開しない。
- OAuth tokenのpass-throughは禁止。アクセススコープ、issuer、audience、expiry、replay対策を検査。
- ブラウザ由来のOriginを検証。CORS設定を認可の代わりにしない。API応答からHTML等の実行を許可しない。
- 調査データの保存、テレメトリ、キャッシュはPrivate RepoごとにACLで分離、最小保持期間、ログの機密情報レダクション。

### 7.3 コード実行境界
初期版はコードを実行しない。将来Sandbox実行を追加する場合は別権限/別API/別承認、ネットワークdeny by default、Secretsなし、資源制限、再利用しない短命VM、ログ/生成物の秘密検査を必須とする。コード実行を通常read-only toolの隠し機能として追加しない。

## 8. Runtime・非機能要件

- MCP transport: Remote Streamable HTTP。サーバ側は状態を持たず、Snapshot registryを外部ストレージへ置ける設計。具体ホスト（Workers/Deno/Docker等）は未選定。
- 耐障害性: pagination失敗や部分取得時は処理済みのcursor/etag/content_shaを記録、整合条件を満たす場合のみ再開。
- Quotas: per-principal/repo request limit、1回の取得上限・総byte数、timeout、最大ファイル数、対象外規則を構成値にする。推奨初期例（正式決定前）: `per_page=100`, `tool response<=256KiB`, `snapshot TTL=24h`, `max total source bytes=20MiB`, `max related context files=100`。上限到達時はPARTIAL。セキュリティ境界は予算値とは別に設計。
- キャッシュ: Keyは`repo_id + commit_sha + path + content_hash + auth_scope`; user/repo authorizationを毎回再検証し、過去のキャッシュを横取りさせない。
- 観測性: 全tool callごとにprincipal_id, snapshot_id, tool, response_bytes, API cost, success/failure class, citation referencesを記録。コード原文・トークン・認証情報を原則ログに出さない。
- Cost model: MCP自体はLLM推論しないためGitHub API/ストレージ/CPUを課金主要因として観測。Webモデル側の推論コストやトークン使用量が完全には取得できない可能性を明示。
- Multi-tenant: private-by-default、admin accessは必要最小限、ユーザー間のスナップショット参照は明示共有時のみ。

## 9. Web別の提供方式

### 9.1 ChatGPT Web
- Root `plugin.json` + root `mcp.json` + `skills/github-pr-review/SKILL.md`。
- サーバはHTTPSの`streamable-http`。プラグインそのものがMCPサーバーをホストするわけではない。
- プラグイン内にGitHub tokenを埋め込まない。必要なOAuthをMCP接続フローで完了する。
- 試験対象はChatGPT Webのプラグイン利用可能な面。公式QuickstartはChatGPT Work on Webを使うが、すべてのチャット面で同一ツールが使えると仮定しない。

### 9.2 Gemini Web
- Web Skills画面でSkill ZIP（最上位`SKILL.md`、reference files）をアップロード。Gem互換のInstructionsも用意。
- Custom AppsでRemote MCP URLと認証を登録。Gemini側の`@app`による強制呼び出し可否をE2Eで検証。
- **未確立の点**: Skills起動時に紐づけMCPが必ず呼ばれるか、内部で複数ツール呼び出しが継続するか、同一スナップショットをモデルの文脈で維持するか。検証前は「対応予定」とする。
- Skills内スクリプトがインターネットへ接続することを前提にしない。通信はCustom AppのMCPが担う。
- 公式のCustom Apps利用条件にはUS/英語/個人アカウント等の制約が記載される。実利用可能アカウントでの実機確認を優先する。

## 10. 重要な設計Gate

**G0 — Web Integration Feasibility (必須)**
- G0-A: ChatGPT Web PluginがRemote MCPの読み取りツールを呼び出し、同じURLで再呼び出しできる。
- G0-B: Gemini Web Custom AppからRemote MCP呼び出しが可能。
- G0-C: Gemini Web Skillsから一連の複数MCPツールを意図どおり使用できる（Gem互換も確認）。
- G0-D: 両者に同一snapshot_idを入力し、MCPが同一のbaseline manifestを返せる。

**G1 — Input & Coverage**
- 対象PRのHEAD/base、Git diff/Hunk map、ファイル数一致、missing/oversize/rename/binary分類が検証できる。
- 数千ファイルのAPI制限・Rate limit・パッチ欠落がPARTIALと正しく表記される。

**G2 — Auth & Security**
- Private Repo利用時、MCPユーザーとGitHub repo ACLの強制、別ユーザー越境拒否、token漏洩防止を実証。

**G3 — Review Contract**
- 既知バグを含むPRで、発生条件・ソース根拠・行アンカー・反証がFindingに記録され、誤検知は除外される。

**G4 — Independent Evaluation**
- 両モデルを同一baseline Snapshotで独立実行し、既知バグRecall/Precision、Coverage、Duplicate Rate、費用・時間を記録。跨モデルのJudgeはレビュー終了後にのみ使用。

## 11. ADR候補と未決事項

- ADR-001: Remote MCP read-only = 推奨採用。
- ADR-002: GitHub Repo Auth = GitHub App + per-user entitlementを推奨。OAuth連携方式はG2で最終決定。
- ADR-003: No code execution in v0.1 = 推奨採用。
- ADR-004: Frozen snapshot + dynamic bounded evidence = 推奨採用。
- ADR-005: Web-host Runtime = 未選定（Cloudflare Workers/Deno Deploy/Docker等から性能/セキュリティ/運用性で決定）。
- ADR-006: Gemini Skill/MCP orchestration capability = G0-C 未実証。
- ADR-007: Private repoの初期リリース適用 = G2に依存。

## 12. 根拠

一次資料と各OSSソースへの参照は `../sources/SOURCES.md` 。とくにGitHub PR files上限、OpenAI Plugin package、Gemini Skills/Custom Apps、MCP Auth/Transport仕様を正式実装の前に再確認する。