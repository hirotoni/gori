---
id: harness-change
kind: procedure
when: gori の知識ファイル（手順書、判断基準、能力、役割、設定）や、それを支える道具を足す、直す、消すとき
refs: [skills/decision-log, skills/doc-writing, procedures/learning-apply, criteria/autonomy, criteria/done, criteria/harness-shape]
provenance:
  added: 2026-11-08
  source: harness-requirements.md H-I4, H-I5, H-K4
  patterns: []
  enforced_by: [lint:procedure-sections, lint:procedure-steps, lint:duplicated-paragraph, lint:unmentioned-ref]
---

## 対象

gori リポジトリの `knowledge/` にある知識ファイルと、それを支える道具（`tools/`）を、足す、直す、消す作業。
道具の変更も、知識ファイルと同じく以後のすべての作業に効くので、同じ手順で承認を挟む。
学び（kind が learning の一件）の適用は `procedures/learning-apply` で進める。

## 手順

1. 変える知識ファイルを一つに絞り、何をどう変えるかと、その根拠（要件の番号、事例）を一文で書く。部品を足すか形を変えるなら、部品の種類と道具に寄せる範囲を `criteria/harness-shape` で決める。二つ以上の知識ファイルに及ぶ変更や大きな変更は、一度に済ませず知識ファイルごとの作業に分ける。ただし、判断基準の規則を足すか変えるのに伴って食い違う記述を直す変更は、同じ作業に含める。食い違う箇所をリポジトリ全体から洗い出し、直し方をまとめて手順 2 で示す。
2. 変更の内容を `skills/doc-writing` に従って書き、人間に示し、明示的な承認を求めて止まる。知識ファイルの変更は以後のすべての作業に効くので、`criteria/autonomy` で取り消せる操作に当たっても承認を待つ。
3. 承認された変更を、承認された知識ファイルにだけ加える。他の知識ファイルの内容が要るときは書き写さず、参照キーを refs に挙げて本文で名指しする。
4. 部品の形を変えたか消したなら、旧い形の言い回しと消した名前（ファイル名、参照キー、道具の名前）で、リポジトリ全体を grep し、今の形と食い違う記述を直してからレビューに出す。消した経緯として残す記述は直さない。
5. 書いた文のうち、無くても振る舞いが変わらない文を削る。迷ったら削る。
6. `tools/knowledge/lint` を実行して形式の違反が無いことを確かめ、`tools/knowledge/build-index` で索引を作り直す。
7. `tools/knowledge/show <参照キー>` の出力を読み、上から順に追えることを確かめる。
8. `${CLAUDE_PLUGIN_ROOT}/tools/records/verdict check --task <作業ID>` が終了コード 0 を返したら、`${CLAUDE_PLUGIN_ROOT}/tools/repo/sync-main --task <作業ID>` を実行する。`UP_TO_DATE` なら、done を書いてから、本体のチェックアウトで `git merge --ff-only <作業ID>` で main に取り込む。`MERGED` か `REBASED` なら、検証をやり直し、`verdict check` が 0 でなければレビューさせ直す（`criteria/done`）。終了コード 1 か 2 の扱いは `criteria/done` に従う。リモート（origin）があっても PR は作らない。GitHub への push は、人間が指示したときだけ行う（`criteria/autonomy`）。

## 禁止事項

- 他の知識ファイルの段落を書き写さない。
- `knowledge/index.md` を手で書かない。

## 終わりの条件

承認された変更だけが commit されて main に fast-forward で入り、その commit で `tests/run.sh` が通り、`criteria/done` のレビューを通っている。

## 報告

- 変えた知識ファイルの参照キーと、変更の根拠。
- 承認した人と、承認された内容。
- `tests/run.sh` の出力。
- 判断の経過を残した `skills/decision-log` の記録のパス。
