---
id: pr-review
kind: procedure
when: AI レビューとリントを通った後、人間の確認が要ると分類された PR を、人間と一緒にレビューし、pending review を作るとき
refs: [skills/delegate, skills/decision-log, criteria/done]
provenance:
  added: 2026-11-08
  source: harness-requirements.md H-K2
  patterns: []
  enforced_by: [lint:procedure-sections, lint:procedure-steps, test:pr]
---

## 対象

人間の確認が要ると分類された PR について、差分の前捌きをし、人間の文脈と観点を加えて指摘を作り、pending review を作るまで。
submit は対象にしない。

## 手順

1. `${CLAUDE_PLUGIN_ROOT}/tools/pr/collect <PR> --out <一時ディレクトリ>/pr.json` で材料を集める。差分が大きければ `skills/delegate` で要点の抽出を委任し、結論と根拠の場所だけを持ち帰る。
2. 差分の要点（何を、なぜ変えたか、影響範囲）をまとめ、既存のレビュー（AI レビューを含む）が見ていない観点で指摘の候補を挙げる。既存の指摘と重なるものは挙げない。
3. 要点と候補を人間に示して止まり、AI が持っていない文脈（背景、チームの合意、今後の予定）と、人間が気になる観点をまとめて尋ねる。
4. 受け取った文脈と観点で追加のレビューをやり直し、候補を直す。
5. 指摘を一件ずつ人間と決め、決まった指摘だけを drafts.json（形は `${CLAUDE_PLUGIN_ROOT}/tools/lib/pr.mjs` の checkDrafts の注釈）に書く。
6. `${CLAUDE_PLUGIN_ROOT}/tools/pr/check <PR> drafts.json` が終了コード 0 になるまで直す。直し方が人間の決めた内容（位置や趣旨）を変えるなら、人間に確かめる。
7. `${CLAUDE_PLUGIN_ROOT}/tools/pr/pending <PR> drafts.json` で pending review を作る。終了コードが 0 でなければ、出力を人間に示して止まる。

## 禁止事項

- review を submit しない。
- `${CLAUDE_PLUGIN_ROOT}/tools/pr/pending` 以外の手段（gh api の直接の呼び出しなど）で、レビューやコメントを送らない。
- PR のコードを直さない。
- 人間が決めていない指摘を drafts.json に入れない。

## 終わりの条件

`${CLAUDE_PLUGIN_ROOT}/tools/pr/pending` が終了コード 0 を返し、その出力（レビュー ID、URL、件数）を `skills/decision-log` の記録の証拠に残している。
`criteria/done` の commit を伴わない作業に当たり、独立レビューのレビュー結果は求めない。

## 報告

- PR の URL、pending review の URL と指摘の件数。
- 人間が足した文脈のうち、指摘を変えたもの。
- 判断の記録のパス。
