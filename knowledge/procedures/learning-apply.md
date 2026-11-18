---
id: learning-apply
kind: procedure
when: 改善候補のプールで todo になった学び（kind が learning の一件）を、知識ファイルか道具に適用するとき
refs: [skills/encode, skills/decision-log, skills/doc-writing, procedures/harness-change]
provenance:
  added: 2026-11-10
  source: 作業の種類 learning-apply から手順書にした。学びの適用を harness-change や feature で始め、学びに当てはまらない手順を飛ばしていた
  patterns: []
  enforced_by: [lint:procedure-sections, lint:procedure-steps]
---

## 対象

改善候補のプールで todo になった学びを、知識ファイルか道具に適用する作業。
学びを根拠にしない知識ファイルや道具の変更は、`procedures/harness-change` で進める。

## 手順

1. `${CLAUDE_PLUGIN_ROOT}/tools/records/pool show <ID>` で一件を読み、kind が learning で status が todo であることを確かめる。
2. `skills/encode` の手順 1 で事例を確かめる。encode の手順 6 に当たれば、何も変えずに理由を人間に示し、`pool reject <ID> --why <理由>` を人間に頼んで終える。
3. `skills/encode` の手順 2 で定着の形を選び、変える知識ファイルか道具を一つに絞る。二つ以上に及ぶなら、一つずつの作業に分ける。
4. 変更の内容と受け入れ条件を `skills/doc-writing` に従って書き、番号を振ってふつうの出力で示し、承認を求めて止まる。受け入れ条件は accept 行に、承認は承認の行に、`skills/decision-log` のとおり残す。
5. 承認された変更を、作業 ID の worktree で加える。構造、型と検査、テストの段を選んだなら、encode の手順 3 に従ってテストを足す。文章の段を選んだならテストは足さず、`tools/knowledge/show <参照キー>` の出力で、足した文が読まれる位置にあることを確かめる。
6. `skills/encode` の手順 4 に従って、来歴を書く。
7. `tools/knowledge/lint` と `tools/knowledge/build-index` と `tests/run.sh` を通す。
8. `procedures/harness-change` の手順 8 に従ってレビューを受け、main に入れる。
9. main に入れた commit で `pool done <ID> --commit <SHA>` を実行する。

## 禁止事項

- 承認を得ずに知識ファイルや道具を変えない。
- 来歴に事例の id を書かない。
- 人間に頼まれずに `pool todo` と `pool reject` を実行しない。

## 終わりの条件

変更が main に fast-forward で入って `tests/run.sh` が通り、`verdict check` が終了コード 0 を返し、プールの一件が done になっている。
適用せずに返したなら、理由を人間に示している。

## 報告

- 学びの ID と、選んだ定着の形とその理由。
- 変えた知識ファイルか道具。
- `tests/run.sh` の出力と、判断の記録のパス。
