---
name: self-check
description: commit を独立レビューに出す前に、担当が差分を受け入れ条件と照らし、レビュアーが落とす不足を先に見つけて直す。review を依頼する直前に使う。
id: self-check
kind: capability
refs: [skills/decision-log, criteria/done]
provenance:
  added: 2026-11-10
  source: 改善候補。レビューの不合格のうち、担当が自分で確かめれば見つかった消し残しが続いた
  patterns: [stale-reference-after-change, unchecked-acceptance-item, stale-acceptance-at-review, approved-condition-narrowed, unverified-doc-claim, spec-boundary-untested]
  enforced_by: [test:stale-names, test:review]
---

この点検はレビューの代わりにならない。合否はレビュアーが決める（`criteria/done`）。
点検は、レビューに出す commit で行う。点検の後に変えたら、変えた commit で点検し直す。

1. 受け入れ条件を一つずつ、レビュアーが使うのと同じ確かめ方（コマンド、grep、テスト）で確かめる。結果は、条件ごとに、コマンドと出力の要点を evidence にして check 行に残す（`log add --type check --criterion '行 N'`。N は accept 行、`pool:<ID>` の行は条件 k ごとに `'行 N#k'`）。満たさない条件があれば、直してから続ける。最後の承認の行が、実装した案そのものを承認しているかも確かめ、`--criterion '承認'` の check 行に残す。
2. 承認された案か受け入れ条件が、区切り、空白、終端、対象の範囲を言葉で決めているなら、言い回しの両側（各区切り、含む・含まない、範囲の内と外）を入力にしたテストがあるかを確かめ、無ければ足す。
3. `git diff <起点>..HEAD` の全体を読み、受け入れ条件の外の変更、消し忘れたデバッグの出力や一時ファイルが無いかを確かめる。
4. 名前や言い回しを変えたか消したなら、古い名前でリポジトリ全体を grep し、差分の外に残った参照を直す。経緯として残す記述は直さない。
5. 差分が文書に書いた設定の値、件数、振る舞いを、実物を読むか数えて照らす。照らした結果は `--criterion '文書'` の check 行に残す。
6. 変更に関わるテストを走らせ、通ることを確かめる。リポジトリが変更に従ってテストを選ぶ入口を持つなら、それを使う。全体はレビュアーが走らせる。

サンドボックスの中で確かめられない条件があれば、`skills/decision-log` に従って E2E の通過に書き換えるか、`--e2e` で渡す。
