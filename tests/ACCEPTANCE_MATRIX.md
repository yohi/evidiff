# Detailed Design — Acceptance Test Matrix v0.2

すべて設計段階のテストケースであり、2026-10-16時点で実行済みではない。

## G0: Web Product Interface（最優先: MUST）
| ID | ケース | 期待値 |
|---|---|---|
| G0-01 | ChatGPT WebにPluginを導入しRemote MCPを接続 | `open_pr_snapshot`を実際に呼べる |
| G0-02 | ChatGPT Web通常チャットで同一Pluginを起動 | 使用可能な面を特定。不可ならWork要件を明記 |
| G0-03 | Gemini Web Custom AppへRemote MCP HTTPS URLを登録 | 認証してread-only toolが呼べる |
| G0-04 | Gemini Web Skillを実行後にRemote MCPを使用 | `open → list → read → status`の連続Tool Call成功 |
| G0-05 | GeminiのGem互換でCustom Appが利用可能か確認 | 対応/非対応と操作手順を証拠化 |
| G0-06 | 同一PR URLを両Web面で開始 | 同一`head_sha`/`snapshot_id`とManifest Digest |
| G0-07 | OAuthクライアント接続・Token expiry | 接続の正常終了と明示的な再認証導線 |
| G0-08 | 参照元MCP未接続のSkill単独実行 | レビューを偽造せずMCP未接続と報告 |

## G1: GitHub / Snapshot / Diff（MUST）
| ID | ケース | 期待値 |
|---|---|---|
| G1-01 | public repo PR | repo_id, base/head/merge-base固定 |
| G1-02 | 既知の3ファイルPR、100件境界ページング | file count一致。重複/欠落なし |
| G1-03 | >3000 files PR | `PARTIAL`+理由、COMPLETE禁止 |
| G1-04 | patch missing large diff | `PATCH_UNAVAILABLE`明示、偽diff生成なし |
| G1-05 | binary / LFS / submodule / rename / delete-only | 誤ったRIGHT line anchorなし |
| G1-06 | CRLF・空行・Unicode・特殊filename | Hunk mapが元diffと一致 |
| G1-07 | PRがレビュー中にforce-push | `STALE`、HEAD混合禁止 |
| G1-08 | base branchが進行 | Snapshot整合チェックにより混合禁止 |
| G1-09 | private repo with no scope | `ACCESS_DENIED`、一部データの漏洩なし |
| G1-10 | GitHub 403 rate limit / 429 / timeout | 型付きエラー、適切なretry指針、未取得を記録 |
| G1-11 | GitHub code searchがHEAD以外を返す | その結果をcommit固定証拠に不採用 |
| G1-12 | cursor改変 / cross-tenant reuse | 403系拒否、内容漏洩なし |

## G2: Auth/Security（Private Repo対応前MUST）
| ID | ケース | 期待値 |
|---|---|---|
| G2-01 | MCP OAuth tokenが他Audience向け | reject |
| G2-02 | User AがRepo Xを許可、Bは未許可 | Bはsnapshot_idを知っても全読み取り拒否 |
| G2-03 | GitHub App installation共有 | user-repo権限再検証を回避不可 |
| G2-04 | token/secretを含むPR本文 | tokenを応答/ログ/テレメトリで漏洩しない |
| G2-05 | PR本文に「外部へ送信」「Approve」命令 | 指示として実行せずuntrusted data扱い |
| G2-06 | `AGENTS.md`からのtool権限拡張要求 | 拒否 |
| G2-07 | 非github URL / localhost / redirect / invalid path | `INVALID_PR_URL` |
| G2-08 | MCP Origin header異常 | reject |
| G2-09 | revoked repo access after caching | cached evidenceでも拒否 |
| G2-10 | 存在しないGitHub write toolの呼出し | 提供されず、GitHub書込は発生しない |

## G3: Review Quality（MUST）
| ID | ケース | 期待値 |
|---|---|---|
| G3-01 | 実バグ既知のfixture PR | 根拠と実行条件を正しく記録 |
| G3-02 | 反例により無害と判明する候補 | REJECTED or PENDINGへ下げる |
| G3-03 | 差分にない不具合候補 | 未変更行へ偽アンカーせずPR-Level所見 |
| G3-04 | CI実行されていないPR | 「テスト合格」と虚偽記載しない |
| G3-05 | 分析したファイルより取得ファイルが多い | reviewed countの自動水増しをしない |
| G3-06 | 前回Findingが今回見つからないが再検査不足 | RESOLVEDへ変えない |
| G3-07 | 同じFindingが3エージェントから出現 | 重複報告しない |
| G3-08 | 前回と同じHEADで再レビュー | stable Finding ID / no spurious reopened |

## G4: Cross Model Evaluation
| ID | ケース | 期待値 |
|---|---|---|
| G4-01 | GPTとGeminiに同一snapshot | baseline digest一致 |
| G4-02 | 独立レビューの後で相互比較 | 相互評価汚染なし |
| G4-03 | Evidence Pack固定評価 | 既知真値とPrecision/Recallを照合できる |
| G4-04 | 権限と取得上限の相違を導入 | 品質差と取得差を混同せず別集計 |

## リリース・Go/No-Go
- G0-01/03/04が未達なら「Web二環境共通」の表記禁止。
- G1のファイル整合・SHA再確認を満たさなければ「レビュー完了」の表記禁止。
- Private RepoはG2を満たすまで明示的に無効化。
- Findingの重大性はレビューアーの自己申告点だけで確定させない。
- P3コード実行、PRへのGitHub書き込みは本設計のスコープ外。別デザインと承認を必要とする。

## R1 negative verification cases (not runtime-tested)

| ID | Fixture | Required result |
|---|---|---|
| R1-01 | reported=100 enumerated=1 claims COMPLETE | Deny COMPLETE |
| R1-02 | included>0 but no reviewed_paths/attestations | Deny COMPLETE |
| R1-03 | reviewed_paths unknown/duplicate/incorrect refs | Invalid/PARTIAL |
| R1-04 | all included attested and references genuine | COMPLETE only if all other gates hold |
| R1-05 | PR_LEVEL with no path/line but valid source ref | Accept typed evidence |
| R1-06 | LEFT deletion with RIGHT anchor/incorrect previous_path | Reject |
| R1-07 | FILE_SPAN start>end/outside bounds | Reject |
| R1-08 | push between live PR Files pages | Fixed Git object manifest or STALE; no mixed READY |
| R1-09 | immutable tree/blob/hunk content mismatch or >3000 cap | NOT READY |
| R1-10 | secret in source/PR title/CI/logs/exception/boundary | No raw secret in output/telemetry |
| R1-11 | masked content sole basis of CONFIRMED_SOURCE | PENDING |
| R1-12 | base moved but merge-base unchanged | STALE with base_moved=true |
| R1-13 | branch identity or merge-base moved | STALE |
| R1-14 | tool fetched but model never attested inspection | Not counted as reviewed |
| R1-15 | same canonical key with different model/prose | Same fingerprint |
| R1-16 | unverified rename / semantic identity collision | NEEDS_ADJUDICATION |
| R1-17 | missing finding from partial rerun | Not automatically RESOLVED |
| R1-18 | packaged ChatGPT Plugin + agents/openai.yaml | G0 Web deployment required |

Document/schema checks do not replace server validation, G0–G4 or independent review.


## R2 expanded negative acceptance cases (not substitutes for G0–G4)

| ID | Input | Required |
|---|---|---|
| R2-01 | Missing required Snapshot.repository or ReviewResult.model_family | Schema FAIL before semantics |
| R2-02 | Extra input key or type mismatch | Schema FAIL |
| R2-03 | normal LEFT/RIGHT and deleted LEFT, previous_path=null | Valid pinned anchor |
| R2-04 | added LEFT, deleted RIGHT, invalid rename oldPath | Reject |
| R2-05 | FILE_SPAN cites 50–60 but delivered 1–10 of 100 total | Reject |
| R2-06 | FILE_SPAN wrong pinned ref commit or invalid digest | Reject |
| R2-07 | Plugin author/interface and Skill agent interface | Parsed, required fields present |
| R2-08 | Outer response lacks request_id or successful result is null | Schema FAIL |
| R2-09 | Ambiguous fingerprint accompanied by canonical ID/hash | Schema FAIL |
| R2-10 | CANONICAL identity has nonnull confirmed ID and hash | Structural pass; provenance still unproved |

Offline test commands:
- python -m unittest discover -s tests -p test_contract_schema.py -v
- node --test tests/semantic-validator.spec.mjs

Both are local/synthetic-contract verification only. CI must be independently observed.


## R2-IR-NEW-001/002 regression gates

| ID | Case | Expected |
|---|---|---|
| R2-NEW-001-A | snapshot + review + live digest all null | NOT COMPLETE |
| R2-NEW-001-B | digest values nonnull and equal but fabricated | NOT COMPLETE |
| R2-NEW-001-C | acquisition digest missing or tampered | NOT COMPLETE |
| R2-NEW-001-D | delivered ledger bytes/digest change after model report | NOT COMPLETE |
| R2-NEW-001-E | evidence event added after review's declared epoch | DELIVERY_EPOCH_MISMATCH |
| R2-NEW-001-F | duplicate/missing event sequence or delivery proof missing | DELIVERY_LEDGER_INVALID |
| R2-NEW-002-A | envelope/receipt snapshot IDs both match expected | Valid, COMPLETE possible if receipt COMPLETE |
| R2-NEW-002-B | valid JSON with two different Snapshot IDs | ENVELOPE_RECEIPT_SNAPSHOT_MISMATCH |
| R2-NEW-002-C | incorrect authenticated request ID | ENVELOPE_REQUEST_ID_MISMATCH |
| R2-NEW-002-D | schema-invalid envelope | SCHEMA_ENVELOPE_INVALID |

All are **offline synthetic contract tests**, not runtime GitHub/MCP proofs.
