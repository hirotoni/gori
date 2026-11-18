---
name: resume
description: 中断した作業を再開するとき。判断の記録から状態を読み、済んだ手順をやり直さずに続きから進める。
id: resume
kind: capability
refs: [skills/decision-log, skills/pause]
provenance:
  added: 2026-11-08
  source: harness-requirements.md H-E9
  patterns: []
  enforced_by: [log:check]
---

最初に、会話の文脈ではなく記録を読む。

```
${CLAUDE_PLUGIN_ROOT}/tools/records/log state --task <作業ID>
```

作業 ID が分からないときは、gori のチェックアウトの `.git/gori/repos/<名前>/audit/` にあるファイル名から探す。`<名前>` は、作業しているリポジトリの本体のチェックアウトのディレクトリ名である。

出力の「残りの手順」が、続きから行う手順である。
この行を書いた中断の手順は `skills/pause` の能力にある。

出力の SHA の行が「不一致」なら、他の何より先に、そのことを報告する。
記録した SHA、現在の HEAD、ブランチの違いを、そのまま伝える。
そのうえで、記録の後に何が変わったかを `git log` と `git status` で確かめてから進める。

次の原則に従う。

- 済んだ手順をやり直さない。step-done がある手順は済んでいる。記録にある手順でも、実物が既に出来ているかを先に確かめる。
- 記録と実物（git の状態、ファイル）が食い違ったら、実物を信じる。記録は fix 行で直す。fix 行の書き方は `skills/decision-log` の能力に従う。
- done 済みの作業には追記しない。

再開すると決めたら、`--type resume` の行を書く。evidence を省くと、道具が記録した SHA と現在の HEAD の照合結果を入れる。

```
${CLAUDE_PLUGIN_ROOT}/tools/records/log add --task <作業ID> --type resume --what "<どの手順から再開するか>"
```

pause 行の `what` と残りの手順から続け、手順ごとに step-done か step-skip を書き、終えたら done 行を書く。
