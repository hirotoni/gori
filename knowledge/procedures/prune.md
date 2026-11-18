---
id: prune
kind: procedure
when: gori の知識ファイル、道具、テスト、文書から、使われなくなったもの、重複、消えた仕組みの残りを探して刈り込むとき
refs: [skills/delegate, criteria/encode-in-structure, procedures/harness-change, procedures/design-doc-sync]
provenance:
  added: 2026-11-18
  source: harness-requirements.md H-I8。人間の依頼で手で行った刈り込みを振り返って手順書にした
  patterns: []
  enforced_by: [lint:procedure-sections, lint:procedure-steps]
---

## 対象

gori のリポジトリ全体（`knowledge/`、`tools/`、`tests/`、`README.md`、`docs/`）の棚卸しと、承認された候補の刈り込み。
見つけた候補を直す作業は、この手順書から `procedures/harness-change` と `procedures/design-doc-sync` の作業に分けて進める。

## 手順

1. `tools/records/usage` を実行し、知識ファイルごとの使用回数を得る。判断基準は規則の一文が毎回注入されるので、本体の読み込みが 0 回でも、不要の根拠にしない。
2. 知識ファイル、道具とテスト、文書と散文の三つの観点に分け、読むだけの委任先に並行で棚卸しさせる（`skills/delegate`）。候補ごとに、パス:行、種類（消し残り、誤記、重複、使われない export やフラグ、互換の分岐、保留の計画、経緯だけの段落）、根拠（実行したコマンドと結果）、確度（確か／要判断）を返させる。
3. 確かとされた候補を、自分で開いて確かめる。
4. 候補を束に分け、束ごとに、直すものと外すものを理由とともに人間に示し、承認を求めて止まる。束の順は、判断の要らない消し残りと誤記、重複、使われない export・フラグ・互換の分岐、保留の計画と経緯の段落とする。
   - 重複は、両方の本文を読み、片方にしか無い内容があれば統合しない。
   - 経緯と根拠を記録する文は、書いた日付があっても消さない。
   - 互換の分岐は、今もそれを通る入力があるかを確かめてから消す。
5. 同じ種類の候補が二件以上あれば、直すのに加えて、それを見つける検査（lint やテスト）を足す案を、同じ束で示す（`criteria/encode-in-structure`）。
6. 承認された束を、知識ファイルと道具は `procedures/harness-change`、文書は `procedures/design-doc-sync` の作業に分けて進める。並行する作業は別の作業 ID と worktree で進め、レビューに出す前に main を取り込み、main への取り込みは一つずつ行う。

## 禁止事項

- 棚卸しの段階で、ファイルを変えない。
- 使用回数だけを理由に、削除の候補にしない。

## 終わりの条件

棚卸しの候補が、直したものと、理由を付けて外したものに分かれ、承認された束が main に入っている。

## 報告

- 束ごとの、直したものと外したもの、その理由。
- 足した検査。
- 残した候補と、残した理由。
