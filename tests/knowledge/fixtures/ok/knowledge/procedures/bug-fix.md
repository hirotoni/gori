---
id: bug-fix
kind: procedure
when: bug-fix の依頼を受けたとき # 適用場面
refs: [criteria/verification, skills/reproduce, agents/worker, config/models, cases/2026-01-01-example]
provenance:
  added: 2026-11-10
  source: harness-requirements.md H-K2
  patterns: []
  enforced_by: []
---
## 対象

不具合の修正 を行う作業が対象になる。

## 手順

1. 不具合の修正 の前提を確かめる。`skills/reproduce` で再現する。
2. 変更を小さな単位に分けて進める。
   実装は `agents/worker` に委任し、モデルは `config/models` に従う。

## 禁止事項

確かめていないことを確かめたと報告しない。

## 終わりの条件

不具合の修正 の結果を実物で確かめ終えている。
確かめ方は `criteria/verification` に従う。

## 報告

何をしたかと、確かめた証拠を日本語で書く。
過去の例は `cases/2026-01-01-example` にある。
