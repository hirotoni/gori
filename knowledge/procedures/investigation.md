---
id: investigation
kind: procedure
when: コードや挙動についての問いに、変更せずに調べて根拠付きで答えるとき
refs: [skills/decision-log, criteria/autonomy]
provenance:
  added: 2026-11-08
  source: harness-requirements.md H-K2
  patterns: []
  enforced_by: [lint:procedure-sections, lint:procedure-steps]
---

## 対象

コード、設定、記録、挙動を読んで、問いに答える作業。
変更を伴う依頼は対象にしない。

## 手順

1. 問いを一文で書き、何が分かれば答えになるかを決める。
2. 調べる範囲を決める。大きな入力（多数のファイル、長いログ）は委任先に読ませ、結論と根拠の場所だけを持ち帰る。
3. ファイルを読み、コマンドを実行して、根拠を集める。観察で決まる問いは、`criteria/autonomy` に従って人間に尋ねずに試す。
4. 根拠のある結論と推測を分けて、答えをまとめる。

## 禁止事項

- コード、設定、データを変更しない。commit しない。
- 推測を事実として書かない。
- 自分で開いていないファイルや実行していないコマンドを、根拠に挙げない。

## 終わりの条件

問いへの答えがあり、各結論に根拠（ファイルと行、コマンドとその出力）が付いている。
調べ方を選んだ判断は、`skills/decision-log` の decision 行に残っている。

## 報告

- 問いと答え。
- 結論ごとの根拠。
- 推測と明記した点と、それを確かめる方法。
