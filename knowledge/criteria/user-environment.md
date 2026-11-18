---
id: user-environment
kind: criterion
when: 利用者の環境の設定を変える案や、会話の記録など機微情報を含みうる記録を残す案を考えたとき
rule: 利用者の環境の設定は、変えない設計を既定にする。
refs: []
provenance:
  added: 2026-11-08
  source: "学び: touches-user-environment"
  patterns: [touches-user-environment]
  enforced_by: []
---

**利用者の環境の設定**：作業リポジトリの外にあり、利用者が自分で決める設定。`~/.claude/settings.json` の項目（`cleanupPeriodDays` など）、シェルの設定、git のグローバルな設定がこれに当たる。
設定が既定値のままでも動く設計を選ぶ。
人間が依頼の中で設定の変更を明示していれば、その変更は行ってよい。

機微情報を含みうる記録は、写さず、退避せず、残る期間を延ばさない。
会話の記録がこれに当たる。
記録は既定の期間で消えるに任せ、消えた後も動く設計にする。
長く残すものは、記録そのものではなく要約した形で持つ。
