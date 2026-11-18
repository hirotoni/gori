---
name: improvement-add
description: "人間が伝えた改善要望、または gori:extract が会話から見つけた学びを、探索を挟まずそのまま改善候補のプールに proposed で起票する。「このタスクも積んでおいて」「〜を直したいので起票して」「これも改善候補にして」のように、人間が既に内容を把握している改善案を候補にしたいときに使用する。起票した候補は人間が todo に上げるまで着手されない。"
id: improvement-add
kind: capability
refs: [skills/extract, procedures/learning-apply, procedures/harness-change, procedures/feature]
provenance:
  added: 2026-11-08
  source: harness-requirements.md H-I2, H-I4
  patterns: []
  enforced_by: [test:improvement-add]
---

# improvement-add

人間から伝えられた改善要望を、改善候補のプールに `proposed` で起票する。
成果物は起票した一件だけである。このスキルの中でコードは変更しない。
探索や観点選定は行わない。内容は人間から与えられたものをそのまま使う。
プールは `${CLAUDE_PLUGIN_ROOT}/tools/records/pool` だけで読み書きする。

## 候補の状態

候補は `proposed`（起票された候補）から、人間が `todo`（着手を承認した）か `rejected`（却下した）にし、main に入ると `done` になる。
このスキルが動かすのは `proposed` の起票だけである。`todo` は人間が動かすか、人間に頼まれて Claude Code が動かす。`rejected` は人間が決め、人間が会話で頼んだときだけ Claude Code が動かす（道具が頼んだ発言を照らす）。
`todo` の候補は、人間の依頼で、学び（learning）なら `procedures/learning-apply`、手順書の候補（procedure）なら `procedures/harness-change`、それ以外（improvement）なら `procedures/feature` で進める。

使わない場面：

- 特定の不具合を直す依頼（起票せず直接修正する）。
- 起票を伴わないレビューや説明の依頼。

## 引数

人間が伝えた改善要望のテキストをそのまま受け取り、改善候補（`--kind improvement`）として起票する。要望が曖昧で「何をどう変えるか」が特定できない場合は、起票前にユーザーに確認する。推測で内容を埋めない。

`skills/extract` から使われるときは、二回以上起きた事例から書いた内容と、その pattern と事例の id を受け取り、学び（`--kind learning`）として起票する。
内容は事例の id で裏付けられているので、ユーザーへの確認を挟まない。

## 1. 前提を確認する

- 直すファイルのあるリポジトリの中（worktree の中でもよい）で道具を実行し、直すファイルを `--file` に渡す。道具は、`--file` がすべて gori のチェックアウトにあれば gori のプールに回し、どこにも無いか二つのリポジトリに分かれれば止まる。止まったら、直すリポジトリごとに分けて、そのリポジトリの中で起票し直す。
- 道具が `repo.yml` のパスの食い違いで止まったら、推測で `--name` を渡さず、出力をユーザーに示して止まる。
- `pool list --status proposed` が 10 件を超えていたら、新しく起票する前にその事実を報告する。積み増しより承認待ちの解消が先である。

## 2. 既にある候補と照合する

同じ内容が既にプールに無いか、起票の前に必ず確かめる。照らす範囲は、そのリポジトリのプールの全件で、状態を問わない。

```bash
${CLAUDE_PLUGIN_ROOT}/tools/records/pool search <キーワード>
${CLAUDE_PLUGIN_ROOT}/tools/records/pool search --file <対象パス>
${CLAUDE_PLUGIN_ROOT}/tools/records/pool show <ID>
```

- 改善候補は、当たった一件を `pool show` で読み、同じ内容かを自分で決める。同じ内容の一件が `proposed`、`todo`、`rejected` にあれば起票せず、その ID を報告する。`rejected` なら、却下したものがまた要望されたことも報告する。`done` にあれば、その ID を本文の「確認したこと」に書いて起票する。
- 学びは、同じ pattern の一件を道具が照らす。`pool add` が終了コード 3 で断ったら、出力のとおり `pool add-case <ID> <事例id>` で事例を足すか、`done` で対策済みなら `--recurrence-of <ID>` を付けて起票し直す。事例を足した一件が `rejected` なら、却下したものがまた起きたと報告する。
- 既にある一件の本文は書き換えない。足したい情報があれば報告で伝える。

## 3. 起票する

1 件 = 1 コマンド。伝えられた要望を 1 件に詰め込まない。複数の要望が混ざっているときは分けて起票する。

```bash
${CLAUDE_PLUGIN_ROOT}/tools/records/pool add --kind improvement --slug <slug> \
  --title '<何をどうするかが分かる動詞句>' \
  --file <分かっていれば対象のパス> <<'BODY'
## 現状
<分かっている範囲で、いま何がどうなっているか>

## 問題
<どの条件で誰が何に困るか>

## 期待する結果
<満たされるべき状態。実装方法は書かない>

## 確認したこと
<照合で実行したコマンドとその結果、読んだもの>

## 受け入れ条件
- <検証可能な条件>
BODY
```

学びは `--kind learning --pattern <pattern> --case <事例id>` を付け、事例ごとに `--case` を繰り返す。

規約：

- slug は小文字英数字とハイフンで、内容が分かる短い名前にする。道具が起票の時刻を付けて ID にし、出力する。
- 本文は引用符付きのヒアドキュメント（`<<'BODY'`）で渡し、シェルに展開させない。五つの見出しのどれかが無いと道具が断る。
- `--file` は分かっている場合だけ付ける。次回以降 `pool search --file <パス>` で重複を見つけられる。
- 受け入れ条件は振る舞いで書く。「関数を追加する」ではなく「〜のとき〜になる」。実装手順を受け入れ条件にしない。
- 計画は書かない。着手するときに `procedures/feature` で調べ直す。
- 「確認したこと」には実際に見た根拠だけを書く。人間から伝えられた内容をそのまま書き写すだけでなく、照合で実行したコマンドとその結果を書く。
- 要望の内容から受け入れ条件が特定できないときは、推測で埋めずユーザーに確認する。

## 4. 報告する

1. 起票した一件の ID と題。
2. 承認の仕方を添える。着手させるなら、端末で `<gori>/tools/records/pool todo <ID>` を実行するか、会話で todo に上げるよう頼めばよい。不要なら、会話で却下を頼むか、端末で `<gori>/tools/records/pool reject <ID> --why "<理由>"` を実行する。`<gori>` は gori のチェックアウトの絶対パスにして示す。
3. 重複として起票しなかったものと、事例を足したものがあれば、その一件の ID を示す。

本文と報告の言語は会話の言語に合わせる。

## 禁止事項

- プールのファイルを直接書かない。起票も事例の追記も `tools/records/pool` で行う。
