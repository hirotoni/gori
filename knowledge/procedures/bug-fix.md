---
id: bug-fix
kind: procedure
when: 報告された不具合（期待と違う振る舞い、エラー）の原因を突き止めて直すとき
refs: [skills/decision-log, skills/work-branch, criteria/autonomy, criteria/done, procedures/integrate-main, criteria/fix-root-cause, skills/commit]
provenance:
  added: 2026-11-08
  source: harness-requirements.md H-K2, H-E5
  patterns: []
  enforced_by: [lint:procedure-sections, lint:procedure-steps, verdict:check]
---

## 対象

報告された不具合を、原因の場所で直す作業。
新しい機能の追加は対象にしない。

## 手順

1. `skills/work-branch` の 1 に従ってチケットかプールの一件を読み、2 に従って作業 ID の worktree に入る。以後の手順は、その worktree の中で行う。
2. 報告と同じ場所（同じ画面、同じコマンド、同じ入力）で不具合を再現する。再現できなければ、直さずに試した条件を報告して止まる。期待する正しい振る舞いは、`${CLAUDE_PLUGIN_ROOT}/tools/records/log add --task <作業ID> --type accept --what "<振る舞い>"` で accept 行として記録する。
3. 最初に誤った場所を、`criteria/fix-root-cause` に従って特定する。
4. 再現の手順を、今の実装で失敗するテストにする。
5. 最初に誤った場所を直し、手順 4 のテストが通ることを確かめる。
6. 手順 2 と同じ場所で、不具合が再現しないことを確かめる。
7. 修正を `skills/commit` に従って commit し、`${CLAUDE_PLUGIN_ROOT}/tools/records/review --task <作業ID>` でレビュアーにレビューさせる。E2E の通過と終了コードの扱いは `criteria/done` に従い、不合格なら指摘に対応して commit し、レビューさせ直す。
8. `skills/work-branch` の 3 に従って、draft PR を作るか main に取り込む。

## 禁止事項

- 再現していない不具合を、直ったと報告しない。
- 失敗するテストを書く前に直さない。テストにできない場合は、その理由を step-skip に書く（`skills/decision-log`）。
- push と PR の作成は、`criteria/autonomy` に従う。

## 終わりの条件

手順 6 の確認が済み、`verdict check` が終了コード 0 を返した修正が手順 8 で渡され、判断の記録に done がある。
渡した先は、リモートがあれば draft PR で、無ければ main への fast-forward（入らなければ `procedures/integrate-main` の作業の開始）である。

## 報告

- 再現の手順と、そのときの出力。
- 最初に誤った場所（ファイルと行）と、そこが誤っていた理由。
- 追加したテストが修正前に失敗し、修正後に通る出力。
- 渡した先（PR の URL か、取り込んだ main の commit）と、渡した commit の `verdict check` の出力。
