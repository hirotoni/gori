---
name: commit
description: 変更を commit するとき、そのリポジトリの慣習に合わせ、一つの commit を一つの目的にする。commit を作る直前に使う。
id: commit
kind: capability
refs: [criteria/verify-each-unit]
provenance:
  added: 2026-11-18
  source: 人間が、開発作業のベースラインとして選んだ。commit の粒度とメッセージの決まりを持つ知識ファイルが無かった
  patterns: []
  enforced_by: []
---

1. commit の前に、そのリポジトリの決まりを読む。`git log` の直近の履歴と、決まりを書いた文書（CONTRIBUTING、README、commit のテンプレート）があればそれを読み、メッセージの言語、接頭辞、チケット番号の書き方、長さを合わせる。決まりが見つからなければ、直近の履歴の形に合わせる。
2. 一つの commit には、一つの目的の変更だけを入れる。分け方は `criteria/verify-each-unit` に従う。
3. `git add` は、ファイルを名指しして行う。入れる前に `git status` と `git diff --staged` を読み、関係のない変更、生成物、秘密情報、消し忘れたデバッグの出力が入っていないことを確かめる。
4. メッセージの一行目に、何を変えたかを書く。理由が差分から読み取れないときは、本文に理由を書く。作業の経過や、試して捨てた案は書かない。
5. commit の前の検査（pre-commit のフック）が落ちたら、落ちた原因を直す。検査を飛ばす指定（`--no-verify`）は使わない。
