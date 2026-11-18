---
id: dependency-update
kind: procedure
when: 依存、ランタイム、フレームワークの版を上げるとき
refs: [skills/work-branch, skills/commit, criteria/verify-each-unit, criteria/done]
provenance:
  added: 2026-11-18
  source: 人間が、開発作業のベースラインとして選んだ。版を上げる作業を機能の実装の手順で進めていて、変更点の確認と見送りの理由の記録が手順に無かった
  patterns: []
  enforced_by: [lint:procedure-sections, lint:procedure-steps]
---

## 対象

依存、ランタイム、フレームワークの版を上げ、動くことを確かめ、レビューを通して渡す作業。
版を上げるのに伴って壊れた箇所の直しは含む。新しい版の機能を使う変更は対象にしない。

## 手順

1. `skills/work-branch` の 1 に従って依頼を読む。上げる対象、今の版、上げる先の版を決め、「上げた先の版で、ビルド、テスト、起動が通る」を accept 行に記録する。
2. 今の版から上げる先までの変更点（リリースノート、移行の案内）を読み、破壊的変更と非推奨のうち、このリポジトリに影響する箇所を挙げる。
3. `skills/work-branch` の 2 に従って worktree に入り、一つずつ上げる（`criteria/verify-each-unit`）。上げるたびに、ロックファイルの差分を読んで意図しない版の変化が無いことを確かめ、ビルド、テスト、起動を確かめる。
4. 版を固定したもの、見送ったものは、理由を decision 行と commit メッセージに残す。
5. `skills/commit` に従って commit し、`criteria/done` に従ってレビューを依頼する。
6. `skills/work-branch` の 3 に従って渡す。

## 禁止事項

- 変更点を読まずに上げない。
- 上げるのに要らない変更（リファクタリング、新しい機能の利用）を混ぜない。
- テストが落ちたとき、テストの側を緩めて通さない。

## 終わりの条件

上げた先の版で `verdict check` が終了コード 0 を返し、`skills/work-branch` の 3 のとおり渡してあり、判断の記録に done がある。

## 報告

- 上げた対象と、前後の版。
- 影響した破壊的変更と、その対応。
- 固定したもの、見送ったものと、その理由。
- `verdict check` の出力。
