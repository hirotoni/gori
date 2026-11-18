---
id: feature
kind: procedure
when: チケット、要望、改善候補のプールの一件で示された機能を実装し、レビューを通して PR か main への取り込みまで進めるとき
refs: [skills/decision-log, skills/delegate, skills/work-branch, agents/implementer, criteria/autonomy, criteria/done, procedures/integrate-main, skills/commit]
provenance:
  added: 2026-11-08
  source: harness-requirements.md H-K2, H-E5, H-E6。作業の種類 comment-only-fix から、振る舞いを変えない直しの確かめ方を足した
  patterns: []
  enforced_by: [lint:procedure-sections, lint:procedure-steps, verdict:check]
---

## 対象

チケット、要望、改善候補のプールの一件で示された機能を実装し、独立したレビューを通して、draft PR にまとめるか main に取り込む作業。
振る舞いを変えないコメント、注記、文書だけの直し（レビューの勧める指摘への対応を含む）も対象にする。
不具合の修正は対象にしない。

## 手順

1. `skills/work-branch` の 1 に従って、チケットかプールの一件を読む。チケットの受け入れ条件を読み、何が満たされれば完了かを確かめる。曖昧な条件のうち、観察で決められないものだけを人間に尋ねる。確かめた受け入れ条件は、一つずつ `${CLAUDE_PLUGIN_ROOT}/tools/records/log add --task <作業ID> --type accept --what "<条件>"` で記録する。
2. `skills/work-branch` の 2 に従って作業 ID の worktree に入り、その中で受け入れ条件を満たす変更を実装する。実装を委任するなら、`skills/delegate` に従って `agents/implementer` に任せる。
3. 受け入れ条件ごとにテストを書き、実際に動かして通ることを確かめる。振る舞いを変えない変更（コメント、注記、文書だけの直し）なら、テストを書かず、直した文を根拠の実物（コード、出典）と照らし、既存のテストの全体を通すことで代える。
4. 変更を `skills/commit` に従って commit し、`${CLAUDE_PLUGIN_ROOT}/tools/records/review --task <作業ID>` でレビュアーにレビューさせる。E2E の通過と終了コードの扱いは `criteria/done` に従う。
5. 不合格なら、指摘ごとに直すか、直さない理由を示すかを決めて `skills/decision-log` の decision 行に残し、直したら commit して手順 4 に戻る。
6. `skills/work-branch` の 3 に従って、draft PR を作るか main に取り込む。

## 禁止事項

- draft PR の作成のほかの外部への送信は `criteria/autonomy` に従う。

## 終わりの条件

リモートがあれば、draft PR があり、その head の commit で `verdict check` が終了コード 0 を返し、判断の記録に done がある。
リモートが無ければ、`verdict check` が終了コード 0 を返した commit が main に fast-forward で入り（入らなければ `procedures/integrate-main` の作業を始めていて）、判断の記録に done がある。

## 報告

- チケットと PR の URL。リモートが無ければ、取り込んだ main の commit。
- 指摘の一覧と、それぞれへの対応（直した commit、または直さない理由）。
- `verdict check` の出力（レビューした commit の SHA とレビュアーを含む）。
- 指摘と対応を残した判断の記録のパス。
