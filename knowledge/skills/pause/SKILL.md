---
name: pause
description: 作業を中断するとき、次のセッションが続きから再開できるように、中断点を判断の記録へ書き出す。
id: pause
kind: capability
refs: [skills/decision-log]
provenance:
  added: 2026-11-08
  source: harness-requirements.md H-E9
  patterns: []
  enforced_by: [log:check]
---

中断の前に、作業中の変更をコミットするか、`git stash` で退避する。
未コミットの変更を残したまま中断しない。次のセッションが実物と記録を照合できなくなる。

作業 ID と記録の書き方は `skills/decision-log` の能力に従う。
pause 行は次のように書く。

```
${CLAUDE_PLUGIN_ROOT}/tools/records/log add --task <作業ID> --type pause --step <今の手順> --what "<次にやる手順>" --why "<中断の理由>" --evidence "<コミットまたは退避の内容>" --result "<未完了の項目>"
```

道具が HEAD の SHA とブランチ名を evidence に自動で足す。
`what` には、次のセッションが迷わず始められる粒度で次の手順を書く。
手順書の手順の残りは、`log state` が step 行と step-done、step-skip から数えて出す。`result` に手で書き写さない。
`result` には、手順書の手順の外にある未完了の項目だけを挙げる。無ければ省く。

書く前に、済んだ手順に step-done を、飛ばした手順に step-skip を書いておく。
書いたら `log state --task <作業ID>` を実行し、残りの手順を含め、再開に必要な情報が読み取れることを確かめてから止まる。
