---
name: decision-log
description: 長い作業や複数の段階がある作業で、判断ごとに記録を残す。作業を始めるとき、判断や訂正をしたとき、作業を終えるときに使う。
id: decision-log
kind: capability
refs: [criteria/done, agents/reviewer]
provenance:
  added: 2026-11-08
  source: harness-requirements.md H-I1, H-E9
  patterns: [proceed-without-approval, sandbox-incompatible-detection]
  enforced_by: [log:check, log:done-unjudged]
---

**作業 ID**：一回の作業を指す名前。`<YYYYMMDD>-<hhmmss>-<slug>` の形で、作業を始めた時刻を秒まで入れ、slug は小文字英数字とハイフンだけにする。作業 ID は `log start --slug <slug>` で道具が発行し、出力の最終行の `TASK_ID=` に出る。古い形 `<YYYY-MM-DD>-<slug>` の記録はそのまま読める。
判断の記録のファイル名、作業ブランチ名、レビュー結果の task 項目に、同じ値を使う。

作業を始めたら、最初に一度だけ start を書く。
目的は一文で書く。手順書を使うなら、その参照キーを `--procedure` に渡す。
その場で書いた手順書なら、`--procedure -` を渡し、手順書の本文を標準入力で渡す。start 行の evidence には `stdin` と残る。
道具が手順書の「## 手順」の各項目を、start 行の直後に step 行として一行ずつ写す。
手順の写しを会話の中の作業リストに置かない。会話の記録と一緒に消えるためである。

```
${CLAUDE_PLUGIN_ROOT}/tools/records/log start --slug <slug> --what "<目的>" [--procedure procedures/<id>]
${CLAUDE_PLUGIN_ROOT}/tools/records/log add --task <作業ID> --type decision --step <手順> --what "<決めたこと>" --why "<理由>" --evidence "<証拠>" --result "<結果>"
```

手順を終えたら step-done を、飛ばすなら step-skip を書く。
step-skip の `--why` は必須で、飛ばす理由を書く。

```
${CLAUDE_PLUGIN_ROOT}/tools/records/log add --task <作業ID> --type step-done --step <番号> --evidence "<証拠>" --result "<結果>"
${CLAUDE_PLUGIN_ROOT}/tools/records/log add --task <作業ID> --type step-skip --step <番号> --why "<飛ばす理由>"
```

step 行は道具だけが書く。step-done と step-skip は、`--what` を省くと道具が手順の本文を入れる。
step-done か step-skip のどちらも書いていない step が残っていると、done は書けない。

記録は、gori のチェックアウトの git の共通ディレクトリの下の `gori/repos/<名前>/audit/<作業ID>.tsv` に追記される。`<名前>` は、作業しているリポジトリの本体のチェックアウトのディレクトリ名である。
git worktree の中で作業しても同じ場所に書かれ、worktree やクローンを片付けた後も残る。
このファイルは道具だけが書く。直接編集しない。

何を一行にするかは、後から読む人が疑える単位で決める。
次の場合に一行を足す。

- 複数の選択肢から一つを選んだとき。
- 手順を飛ばす、または変えたとき。
- 検証をして結果が出たとき。

判断基準の規則が選択を変えたら、その decision 行の `--why` に参照キー（`criteria/<id>`）を書く。
`evidence` には、コマンドの出力、ファイルの場所、コミットの SHA など、確かめ直せるものを書く。
自分の確信は証拠にならない。
まだ結果が無い判断は、`--result` を省く。

作業の受け入れ条件は、accept 行として一行に一つずつ書く。
`--type accept --what "<条件>"` と書く。step は `-` のままでよく、why などは任意である。
改善候補のプールの一件から始めた作業では、受け入れ条件を写さず `--type accept --what "pool:<ID>"` の一行だけを書く。
`review` がレビューのたびにプールの一件の「## 受け入れ条件」の各行を読むので、人間が受け入れ条件を書き直しても記録を直さなくてよい。
条件は、観察して満たしたと言える文で書く。レビュアーはこの行を受け入れ基準として読む。
書く前に、条件ごとにレビュアーのサンドボックスの中で確かめられるかを見る。
サンドボックスの中では、レビュアーの一時 worktree と `/tmp/claude-<uid>` の外へ書けず、claude を起動できず、疑似端末を開けず、プロセスの一覧を読めない（`ps`、`pgrep` が失敗する）。
これらを要する条件は、`tests/e2e/` のスクリプトの通過として書き、レビューを依頼するときに `criteria/done` のとおり `--e2e` で渡す。
そのスクリプトが無ければ、作業の中で書いてレビューする commit に入れる。
そう書き換えた条件は、元の条件と書き換えた理由を decision 行に残す。
accept 行が一つも無いと、`review` はレビュアーを起動せず止まる。
accept 行も done の後には書けない。

受け入れ条件を人間に示して承認を得たら、承認の行を書く。
案と受け入れ条件には番号を振って示す。選択式の質問（AskUserQuestion）では尋ねない。承認をもらったら、その返事から承認の言葉を切り出して --quote に渡す。
一つの返事が複数の問いに答えているときは、返事の全文を --quote に渡す。

```
${CLAUDE_PLUGIN_ROOT}/tools/records/log add --task <作業ID> --type approval --what "<承認された案>" --quote "<承認の言葉>"
```

道具が確かめるのは、引用が今の会話の最後の人間の入力に含まれるかだけである（含まれなければ approval-unverified で止まる）。
返事が案を変える指示や、一部の問いへの答えでないかは、担当が読んで確かめ、レビュアーも確かめる（agents/reviewer）。承認の返事の後に別の発言があれば、もらい直す。
セッション ID が無い端末の人間が書くときは、照合しない。
受け入れ条件を書き足すか、訂正するか、取り下げたら、承認をもらい直して承認の行を書く。最後の受け入れ条件（その訂正と取り下げを含む）より後に承認の行が無ければ、`review` はレビュアーを起動しない。

過去の行が誤りだと分かったら、消さずに fix 行で訂正する。
`--type fix --what "行 N を訂正: <正しい内容>"` と書く。N は記録のファイルの物理行で、列名の行が 1 行目である。
accept 行を訂正する fix は、レビュアーに訂正として渡る。

作業の途中で実装の方針が変わり、受け入れ条件が合わなくなったら、実装を続ける前に条件を直す。
要らなくなった条件は `--type fix --what "行 N を取り下げ: <理由>"` で取り下げ、新しい条件は accept 行で足し、人間の承認をもらい直す。
プールの一件から始めた作業では、`pool:<ID>` の行を取り下げ、今も有効な条件と新しい条件を accept 行で書き直す。プールの本文は書き換えない。
取り下げた条件は、レビュアーに基準として渡らず、取り下げた条件として理由とともに渡る。

判断の記録には、秘密情報を書かない。
トークン、パスワード、個人情報、顧客データは、what、why、evidence、result のどの列にも入れない。
証拠は、それを指す場所や SHA で示し、中身を写さない。
`log` は秘密情報らしい形（接続文字列のパスワード、トークンなど）を検査し、当たれば secret-like で拒む。拒まれたら、伏せるか言い換えて書き直す。

作業が終わったら `--type done` を一行書く。done の後は追記できない。
commit を伴う作業（start の時点から作業ツリーの HEAD に、自分が作った commit が足された作業。main の上で commit しても当たる）では、その HEAD の `verdict check` が 0 でないと、道具が done を拒む。
done は作業の worktree の HEAD で、マージより前に書く。マージは作業の記録の外の操作である。
書き終えたら `${CLAUDE_PLUGIN_ROOT}/tools/records/log check <log start が出力したパス>` で形式を確かめる。
中断するときは pause の能力、再開するときは resume の能力を使う。
