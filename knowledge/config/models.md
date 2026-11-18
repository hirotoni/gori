---
id: models
kind: config
refs: []
provenance:
  added: 2026-11-08
  source: harness-requirements.md H-E7
  patterns: []
  enforced_by: [test:models]
---

役割ごとのモデルの対応表である。
`tools/records/review` は reviewer の行（文書だけの変更の軽いレビューでは reviewer-light の行）を、`tools/learning/extract-run` は procedure-scout の行を機械的に読む。
行の形は `| <役割> | <モデル名> |` に固定する。
レビュアーは作業者と別のモデルにするので、implementer と reviewer には違うモデルを書く。
reviewer-light（文書だけの変更の軽いレビュー）は、implementer と同じモデルでもよい。被害の小さい変更に限るので、人間が許容した（2026-11-12）。作業者とレビュアーが別のセッションであることは、道具が確かめる。

| 役割 | モデル |
| --- | --- |
| implementer | sonnet |
| reviewer | opus |
| reviewer-light | sonnet |
| extract-judgment | opus |
| extract-tooling | sonnet |
| extract-alternative | opus |
| procedure-scout | opus |
