---
id: triggers
kind: config
refs: [skills/decision-log, skills/pause, skills/resume, skills/delegate, skills/encode, skills/self-check, criteria/autonomy, criteria/done, criteria/user-environment, criteria/design-scope]
provenance:
  added: 2026-11-08
  source: harness-requirements.md H-E3, H-E5, H-E6
  patterns: []
  enforced_by: [lint:uninvocable-trigger]
---

次の状況では、対応するものを必ず使う。
能力は Skill ツールで `gori:<id>` として呼び、判断基準は索引のパスを Read で読む。

| 状況 | 使うもの |
| ---- | -------- |
| 作業を始めるとき、判断や訂正をしたとき、手順を終えたとき | `skills/decision-log` |
| 作業を途中で止めるとき | `skills/pause` |
| 中断した作業を続けるとき | `skills/resume` |
| 作業を委任するとき | `skills/delegate` |
| 承認された学び（事例）を知識ファイルや道具に適用するとき | `skills/encode` |
| 確認なしに進めてよいか迷ったとき | `criteria/autonomy` |
| 利用者の環境の設定を変える案や、機微な記録を残す案を考えたとき | `criteria/user-environment` |
| 仕組みや手順の設計案を考えるとき、とくに状態や他の実行環境への対応や作り直しを案に含めたくなったとき | `criteria/design-scope` |
| commit をレビューに出す前（`tools/records/review` を実行する前） | `skills/self-check` |
| 完了と報告する前 | `criteria/done` |
