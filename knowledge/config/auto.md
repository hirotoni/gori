---
id: auto
kind: config
refs: []
provenance:
  added: 2026-11-13
  source: harness-requirements.md H-E11
  patterns: []
  enforced_by: [test:auto-limits]
---

無人の作業の上限と、見回りの間隔の表である。
`tools/auto/run`、`tools/auto/watch`、`tools/records/review` が機械的に読む。
行の形は `| <名前> | <数> |` に固定する。
行が欠けているか、数が正の数でなければ、`tools/auto/run` と `tools/auto/watch` は何も起動しない。

| 上限 | 値 |
| --- | --- |
| run-minutes | 60 |
| worker-budget-usd | 10 |
| reviewer-budget-usd | 5 |
| runs-per-day | 10 |
| watch-minutes | 30 |

run-minutes は、一回の実行の時間の上限（分）である。
worker-budget-usd と reviewer-budget-usd は、作業者とレビュアーの一回の起動に付ける金額の上限（ドル）である。金額は実績に基づかない仮の値で、実行の記録の金額がたまったら見直す。
runs-per-day は、一日に無人で起動する回数の上限である。
watch-minutes は、`tools/auto/watch` が `tools/auto/run` を呼ぶ間隔（分）である。
