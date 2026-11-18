#!/usr/bin/env bash
# 無人の作業（tools/auto/run）が担当に渡す環境で commit しても、commit の前の tests/run.sh が人間の作業のときと同じ結果になること。
# tests/run.sh が読む tests/lib/clean-env.sh が、柵の GIT_CONFIG_* と GORI_* を消すことを、tools/repo を扱う二つのテストで確かめる。
set -u
root="$(cd "$(dirname "$0")/../.." && pwd)"
fails=0
fail() { echo "FAIL: $*"; fails=$((fails + 1)); }

# tools/lib/auto.mjs の fenceEnv と、tools/auto/run の childEnv が足す変数。
export GORI_AUTO=1 GORI_IGNORE_UPSTREAM=1
export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0="$root/tools/auto/githooks"

# 掃除をしなければ落ちることを先に確かめる。落ちなければ、このテストは何も確かめていない。
bash "$root/tests/repo/test_sync_main.sh" >/dev/null 2>&1 && fail "掃除の前に test_sync_main.sh が通った。無人の作業の環境を作れていない"

# shellcheck source=../lib/clean-env.sh
. "$root/tests/lib/clean-env.sh"
left="$(env | grep -E '^(GIT|GORI)_' || true)"
[ -z "$left" ] || fail "掃除の後に残った変数がある: $left"
for t in test_sync_main test_worktree; do
  out="$(bash "$root/tests/repo/$t.sh" 2>&1)" || fail "掃除の後に $t.sh が落ちた: $(printf '%s\n' "$out" | grep FAIL | head -3)"
done

[ "$fails" -eq 0 ] || exit 1
echo "ok: test_auto_env"
