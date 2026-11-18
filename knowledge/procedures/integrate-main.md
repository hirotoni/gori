---
id: integrate-main
kind: procedure
when: レビューを通って done になった作業のブランチが、その後に main が進んだために fast-forward で入らなくなり、main を取り込んでから main に入れるとき
refs: [skills/decision-log, skills/work-branch, criteria/autonomy, criteria/done, skills/commit]
provenance:
  added: 2026-11-08
  source: 利用者の依頼。レビュー済みのブランチに main を取り込む作業を、その場で書いた手順書で進めていたのを手順書にした
  patterns: []
  enforced_by: [lint:procedure-sections, lint:procedure-steps, verdict:check]
---

## 対象

レビューを通って判断の記録が done になった作業のブランチに、その後に進んだ main を取り込み、レビューし直して main に入れる作業。
守るのは、元の変更の意図が進んだ main の上でも成り立つことと、main に入る commit がレビューを通った commit そのものであることである。
done より前に main が進んだとき（レビューの依頼が終了コード 2 で止まったときを含む）は、元の作業の手順書のまま `criteria/done` に従い、この手順書を使わない。

## 手順

1. 本体のチェックアウトで `git branch <作業ID> <元のブランチ>` として、この作業 ID のブランチを元のブランチの先端に作る。元の作業の記録は done で閉じていて追記できず、記録の道具は作業 ID のブランチから作業ツリーを引くためである。`skills/work-branch` の 2 に従って、その worktree を作って入る。
2. リモート（origin）があれば、先に `git fetch origin` し、この手順の `main` を origin の既定ブランチ（`origin/HEAD`、無ければ `origin/main`）に読み替える。main で何が変わったかを `git log <作業ID>..main` と `git diff <作業ID>...main --stat` で読み、元の変更が依っている名前（ファイル、関数、文書の見出し）のうち、main で消えたか変わったものを挙げる。元の作業の受け入れ条件のうち検証のコマンドがあるもの（テスト、E2E）と、挙げた名前が main の今の形で参照されていることを、`${CLAUDE_PLUGIN_ROOT}/tools/records/log add --task <作業ID> --type accept --what "<状態>"` で accept 行として記録する。
3. `${CLAUDE_PLUGIN_ROOT}/tools/repo/sync-main --task <作業ID>` で main を取り込む。元の commit はレビューを受けているので、道具は書き換えずに merge で取り込む。リモート（origin）があれば、道具は fetch したうえで、ローカルの main も最新にする。終了コード 2 なら、出力を人間に示して止まる。終了コード 1（衝突）なら、commit する前にファイルごとに `git diff <作業ID>...main -- <ファイル>`（分岐点から見た main 側の変更）を読み、解いた結果に main 側の変更が残っていることを確かめてから commit する。どちらの側を採ったかは、ファイルごとに `skills/decision-log` の decision 行に残す。衝突を解くのに受け入れ条件の外の判断が要るなら、`--abort` で戻して人間に尋ねる。
4. 手順 2 で挙げた名前で worktree の中を grep し、main の今の形と食い違う参照を直して `skills/commit` に従って commit する。
5. 手順 2 の accept 行の検証と、リポジトリのテスト全体を走らせ、通ることを確かめる。テスト全体には main 側のテストも入るので、衝突せずに意味が壊れた箇所もここで拾う。
6. `${CLAUDE_PLUGIN_ROOT}/tools/records/review --task <作業ID> --base main` でレビューさせる。E2E があるなら `--e2e tests/e2e/<スクリプト>.sh` を付ける。不合格なら指摘に対応して commit し、レビューさせ直す。
7. `${CLAUDE_PLUGIN_ROOT}/tools/records/verdict check --task <作業ID>` が終了コード 0 を返したら、done を書く。リモート（origin）があれば、`${CLAUDE_PLUGIN_ROOT}/tools/repo/draft-pr --task <作業ID>` で draft PR を作る。ただし、gori 自身の変更の作業なら、リモートがあっても PR を作らず、リモートが無いときと同じく main に取り込む。リモートが無ければ、本体のチェックアウトで `git merge --ff-only <作業ID>` で main に取り込み、元のブランチに worktree が無ければ `git branch -d <元のブランチ>` で消す。worktree があれば `${CLAUDE_PLUGIN_ROOT}/tools/repo/prune-worktrees` が片付けるので、ここでは消さない。

## 禁止事項

- レビューを受けた commit を書き換えない（`rebase`、`commit --amend`、`reset`）。
- 元の作業の判断の記録に追記しない。
- 衝突を解くついでに、元の作業の範囲の外の変更を足さない。
- 元のブランチを `git branch -D` で消さない。
- リモートがあるときはマージしない。draft PR の作成のほかの外部への送信は `criteria/autonomy` に従う。

## 終わりの条件

`verdict check` が終了コード 0 を返した commit が、リモートがあれば draft PR の head にあり、無ければ main に fast-forward で入っていて、判断の記録に done がある。

## 報告

- 元のブランチと、取り込んだ main の commit。
- 衝突したファイルと、main 側の変更が残っていることを確かめた差分。
- 食い違う参照を直した箇所と、その commit。
- `verdict check` の出力（レビューした commit の SHA とレビュアーを含む）。
- PR の URL。リモートが無ければ、取り込んだ main の commit。
