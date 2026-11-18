#!/usr/bin/env bash
# レビュアーのサンドボックスの中では疑似端末を開けず、端末の人間の verdict record を確かめるテストが飛ばされる。
# そこで review が --e2e としてサンドボックスの外で走らせ、tests/records/worktree.test.mjs が一件も飛ばさずに通ることを確かめる。
# 確かめること: git worktree の中で log start、verdict record、review を実行すると記録が gori のチェックアウトの .git/gori/repos/<本体の名前>/ に書かれ、worktree を消しても残る。
# 使い方: tests/e2e/keep-records-from-worktree.sh
set -u
gori="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$gori" || exit 1
out="$(node --test --test-reporter=spec tests/records/worktree.test.mjs 2>&1)"
code=$?
printf '%s\n' "$out"
if [ "$code" -ne 0 ]; then
  echo "FAILED: tests/records/worktree.test.mjs が終了コード $code で終わった" >&2
  exit 1
fi
if ! printf '%s\n' "$out" | grep -Eq '^ℹ skipped 0$'; then
  echo "FAILED: 飛ばされたテストがある（疑似端末を開けない環境で走らせた可能性がある）" >&2
  exit 1
fi
echo "PASSED: worktree で書いた記録は gori のチェックアウトの .git/gori/repos/<本体の名前>/ に残る"
