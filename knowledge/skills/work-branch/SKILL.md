---
name: work-branch
description: 作業 ID のブランチで成果を作る作業で、受け入れ条件をチケットかプールの一件から読み、作業 ID の worktree に入り、レビューに合格した成果を draft PR か main への取り込みで渡す。機能の開発と不具合の修正の始めと終わりに使う。
id: work-branch
kind: capability
refs: [criteria/autonomy, criteria/done, procedures/integrate-main]
provenance:
  added: 2026-11-11
  source: 改善候補。feature と bug-fix に、チケットの読み方、worktree の入り方、渡し方が書き写されていた
  patterns: []
  enforced_by: []
---

## 1. 受け入れ条件を読む

チケット番号だけが渡されたら、課題管理の MCP（Jira など）でチケットの本文、受け入れ条件、コメントを読む。
読めないとき（MCP が無い、権限が無い、チケットが見つからない）は、推測で進めず止まり、人間に本文を貼ってもらう。

プールの一件から始めた作業では、`${CLAUDE_PLUGIN_ROOT}/tools/records/pool show <ID>` で本文と受け入れ条件を読み、受け入れ条件は `--type accept --what "pool:<ID>"` の一行だけを記録する。
着手するのは人間が `todo` にした一件だけで、`proposed` の一件なら、人間に `todo` に上げるよう頼んで止まる。

## 2. worktree に入る

`${CLAUDE_PLUGIN_ROOT}/tools/repo/worktree <作業ID>` で作業 ID の git worktree を作り、出力の最終行の `WORKTREE_DIR` のパスを `path` に渡して EnterWorktree ツールで入る。
EnterWorktree が拒否されたら、止まらずにその worktree を指して続ける。
Edit と Write には `WORKTREE_DIR` の下の絶対パスだけを渡し、Bash のコマンドは `cd "<WORKTREE_DIR>" &&` で始めるか `git -C "<WORKTREE_DIR>"` で実行する。
記録の道具（`log`、`review`、`verdict`）は、`--repo` が無ければ作業 ID のブランチの worktree を自動で指す。
以後の作業は、その worktree の中で行う。
本体のチェックアウトでブランチを切り替えない。人間や並行する作業が同じ作業ツリーを使っているためである。

## 3. 渡す

`${CLAUDE_PLUGIN_ROOT}/tools/records/verdict check --task <作業ID>` が終了コード 0 を返したら、リモート（origin）があれば、`${CLAUDE_PLUGIN_ROOT}/tools/repo/draft-pr --task <作業ID>` で draft PR を作る。
PR の本文の末尾に付ける文が環境で決まっていれば、`--footer` で渡す。
道具は push しない。作業のブランチが origin に無いか古いと道具が止まったら、push してよいかを人間に尋ねる（`criteria/autonomy`）。
リモートが無ければ、done を書く前に `${CLAUDE_PLUGIN_ROOT}/tools/repo/sync-main --task <作業ID>` を実行する。
`MERGED` なら（レビューの後に main が進んだ）、検証をやり直し、`verdict check` が 0 でなければレビューさせ直す（`criteria/done`）。終了コード 1 か 2 の扱いは `criteria/done` に従う。
`UP_TO_DATE` なら、done を書いてから、本体のチェックアウトで `git merge --ff-only <作業ID>` で main に取り込み、プールの一件から始めた作業なら `${CLAUDE_PLUGIN_ROOT}/tools/records/pool done <ID> --commit <main に取り込んだ commit の SHA>` で done にする。
`git merge --ff-only` が失敗したら（done の後に main が進んだ）、この作業の中で取り込み直さず、`procedures/integrate-main` を別の作業として始める。プールの一件は、その作業が main に取り込んでから done にする。

draft PR の作成は、この能力を使う手順書が手順として明示している送信なので、`criteria/autonomy` のとおり承認を取り直さない。
リモートがあるときはマージしない。
