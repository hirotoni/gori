---
id: design-doc-sync
kind: procedure
when: gori の README と docs/ の下の文書を、既に変わった仕組み（決まった設計、消した部品、変えた名前）に合わせて直すとき
refs: [skills/work-branch, skills/decision-log, skills/doc-writing, criteria/done, procedures/harness-change, procedures/design-dialogue, skills/commit]
provenance:
  added: 2026-11-14
  source: 作業の種類 design-doc-sync から手順書にした。文書だけを直す作業を、その場で書いた手順書か harness-change で始め、知識ファイル向けの手順を飛ばしていた
  patterns: []
  enforced_by: [lint:procedure-sections, lint:procedure-steps]
---

## 対象

gori リポジトリの `README.md` と `docs/` の下の文書を、既に変わった仕組み（決まった設計、消した部品、変えた名前）に合わせて直す作業。
知識ファイルと道具は変えない。それらを変える作業は `procedures/harness-change` で進め、文書との食い違いもその中で直す。
まだ決まっていない設計を人間と決めて文書に書く作業は、`procedures/design-dialogue` で進める。

## 手順

1. `skills/work-branch` の 2 に従って作業 ID の worktree に入り、合わせる先の仕組みを、実物（知識ファイル、道具、設定、その仕組みを決めた作業の判断の記録）で確かめる。依頼の言う仕組みと実物が食い違えば、文書を直す前に人間に示す。
2. 古い仕組みを指す語（消した名前、旧い言い回し）を、別名と派生の名前まで挙げ、`README.md` と `docs/` の下のすべてを grep して、触れている箇所を洗い出す。
3. 洗い出した箇所を、今の振る舞いを説明する箇所と、経緯を記録する箇所（いつ何を決めたか、採らなかった案とその理由）に分ける。箇所ごとの直し方を受け入れ条件として番号を振って人間に示し、承認を求めて止まる。受け入れ条件は accept 行に、承認は承認の行に、`skills/decision-log` のとおり残す。
4. 今の振る舞いを説明する箇所は、`skills/doc-writing` に従って今の形に直す。経緯を記録する箇所は書き換えず、変えたことと理由を書き足す。設定で変わる値は書き写さず、設定の場所を指す。
5. 直した文が述べる設定と振る舞いを、一文ずつ実物と照らして確かめる。
6. `tests/run.sh` を通して `skills/commit` に従って commit し、`criteria/done` に従ってレビューを依頼する。
7. `procedures/harness-change` の手順 8 に従って main に入れる。

## 禁止事項

- 知識ファイルと道具を変えない。
- 経緯を記録する箇所を、今の形に書き換えない。

## 終わりの条件

洗い出した箇所がすべて、直されたか書き足されている。
その commit で `tests/run.sh` が通り、`verdict check` が終了コード 0 を返し、main に fast-forward で入っている。

## 報告

- 合わせた先の仕組みと、それを確かめた実物。
- 直した箇所と、経緯として残して書き足した箇所。
- `tests/run.sh` の出力と、判断の記録のパス。
