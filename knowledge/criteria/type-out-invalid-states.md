---
id: type-out-invalid-states
kind: criterion
when: 型のある言語で、型や関数の引数を設計するとき
rule: 起きてはならない状態と値の取り違えは、型で書けなくする。
refs: [criteria/validate-at-boundary]
provenance:
  added: 2026-11-18
  source: 人間が、開発で当たり前とする規則として選んだ
  patterns: []
  enforced_by: []
---

型で書けない誤りは、実行するまで見つからず、検査の書き忘れがそのまま不具合になる。

同じ基本の型でも意味の違う値には、別々の型を与え、作るときに一度だけ検証する。
外から来たデータを型にする場所は、`criteria/validate-at-boundary` に従う。
形の正本がスキーマにあるなら、型はそこから導き、手で並行して書かない。
