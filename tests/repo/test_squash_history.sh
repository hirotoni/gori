#!/usr/bin/env bash
# tools/repo/squash-history が、main をツリーを変えずに親の無い一つの commit に畳み、畳めない状態では何も変えずに止まること。
set -u
tool="$(cd "$(dirname "$0")/../.." && pwd)/tools/repo/squash-history"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/gori-squash-history.XXXXXX")" || exit 1
tmp="$(cd "$tmp" && pwd -P)"
trap 'rm -rf "$tmp"' EXIT
fails=0
fail() { echo "FAIL: $*"; fails=$((fails + 1)); }
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.invalid GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.invalid

# main に三つの commit を持ち、origin（bare）に push 済みのリポジトリを作る
setup() {
  local r=$1
  git -c init.defaultBranch=main init -q "$r"
  for f in a b c; do echo "$f" >"$r/$f.txt" && git -C "$r" add "$f.txt" && git -C "$r" commit -q -m "$f"; done
  git init -q --bare "$r.origin" && git -C "$r" remote add origin "$r.origin" && git -C "$r" push -q origin main
}
# 止まったときに何も変えていないこと。使い方: unchanged <リポジトリ> <実行前の main> <実行前の status>
unchanged() {
  [ "$(git -C "$1" rev-parse main)" = "$2" ] || fail "$4: main が動いた"
  [ "$(git -C "$1" status --porcelain)" = "$3" ] || fail "$4: 作業ツリーが変わった"
}

# 畳むと、main が親の無い一つの commit になり、ツリーは同じで、作業ツリーは clean のまま。控えを作らず、origin も動かさない
setup "$tmp/r1"
old="$(git -C "$tmp/r1" rev-parse main)"; tree="$(git -C "$tmp/r1" rev-parse 'main^{tree}')"; remote="$(git -C "$tmp/r1.origin" rev-parse main)"
out="$(cd "$tmp/r1" && "$tool" 2>&1)"; code=$?
new="$(git -C "$tmp/r1" rev-parse main)"
[ "$code" -eq 0 ] && [ "$out" = "SQUASHED=$old..$new" ] || fail "畳めない: $code $out"
[ "$new" != "$old" ] || fail "main が動いていない"
[ "$(git -C "$tmp/r1" rev-list --count main)" -eq 1 ] || fail "commit が一つでない"
[ -z "$(git -C "$tmp/r1" rev-list --parents -n 1 main | cut -s -d' ' -f2-)" ] || fail "親がある"
[ "$(git -C "$tmp/r1" rev-parse 'main^{tree}')" = "$tree" ] || fail "ツリーが変わった"
[ -z "$(git -C "$tmp/r1" status --porcelain)" ] || fail "作業ツリーが clean でない"
[ ! -e "$tmp/r1/.git/gori/history-backup" ] || fail "控えを作った"
[ "$(git -C "$tmp/r1.origin" rev-parse main)" = "$remote" ] || fail "origin を動かした"
[ "$(git -C "$tmp/r1" rev-parse origin/main)" = "$remote" ] || fail "origin/main を動かした"

# もう一度実行しても、同じ commit のまま
out="$(cd "$tmp/r1" && "$tool" 2>&1)"; code=$?
[ "$code" -eq 0 ] && [ "$out" = "ALREADY_SQUASHED=$new" ] || fail "二度目で畳み直した: $code $out"
[ "$(git -C "$tmp/r1" rev-parse main)" = "$new" ] || fail "二度目で main が動いた"

# 未 commit の変更があれば止まる
setup "$tmp/r2"
old="$(git -C "$tmp/r2" rev-parse main)"
echo changed >"$tmp/r2/a.txt"; st="$(git -C "$tmp/r2" status --porcelain)"
out="$(cd "$tmp/r2" && "$tool" 2>&1)"; code=$?
[ "$code" -eq 2 ] && printf '%s\n' "$out" | grep -q '未 commit の変更' || fail "未 commit の変更で止まらない: $code $out"
unchanged "$tmp/r2" "$old" "$st" "未 commit の変更"

# 追跡していないファイルがあっても止まる
setup "$tmp/r3"
old="$(git -C "$tmp/r3" rev-parse main)"
echo new >"$tmp/r3/untracked.txt"; st="$(git -C "$tmp/r3" status --porcelain)"
out="$(cd "$tmp/r3" && "$tool" 2>&1)"; code=$?
[ "$code" -eq 2 ] || fail "追跡していないファイルで止まらない: $code $out"
unchanged "$tmp/r3" "$old" "$st" "追跡していないファイル"

# main の他にブランチがあれば止まる
setup "$tmp/r4"
old="$(git -C "$tmp/r4" rev-parse main)"
git -C "$tmp/r4" branch 2026-01-01-w
out="$(cd "$tmp/r4" && "$tool" 2>&1)"; code=$?
[ "$code" -eq 2 ] && printf '%s\n' "$out" | grep -q '2026-01-01-w' || fail "他のブランチで止まらない: $code $out"
unchanged "$tmp/r4" "$old" "" "他のブランチ"

# 無人の作業が動いていれば（run.lock の pid が生きている）止まる。pid が死んでいれば畳む
setup "$tmp/r5"
old="$(git -C "$tmp/r5" rev-parse main)"
mkdir -p "$tmp/r5/.git/gori/auto" && echo "$$" >"$tmp/r5/.git/gori/auto/run.lock"
out="$(cd "$tmp/r5" && "$tool" 2>&1)"; code=$?
[ "$code" -eq 2 ] && printf '%s\n' "$out" | grep -q '無人の作業が動いている' || fail "無人の作業が動いているのに止まらない: $code $out"
unchanged "$tmp/r5" "$old" "" "無人の作業"
(exit 0) & dead=$!; wait "$dead"
echo "$dead" >"$tmp/r5/.git/gori/auto/run.lock"
out="$(cd "$tmp/r5" && "$tool" 2>&1)"; code=$?
[ "$code" -eq 0 ] && printf '%s\n' "$out" | grep -q '^SQUASHED=' || fail "run.lock の pid が死んでいるのに畳まない: $code $out"

# main を checkout していない worktree からは止まる
setup "$tmp/r6"
old="$(git -C "$tmp/r6" rev-parse main)"
git -C "$tmp/r6" worktree add -q --detach "$tmp/r6.wt" main
out="$(cd "$tmp/r6.wt" && "$tool" 2>&1)"; code=$?
[ "$code" -eq 2 ] || fail "main の外で止まらない: $code $out"
unchanged "$tmp/r6" "$old" "" "main の外"

# 引数は受け取らない
out="$(cd "$tmp/r6" && "$tool" --push 2>&1)"; code=$?
[ "$code" -eq 2 ] || fail "不明な引数で終了コード 2 にならない: $code $out"
unchanged "$tmp/r6" "$old" "" "不明な引数"

if [ "$fails" -gt 0 ]; then
  echo "test_squash_history: $fails 件失敗"
  exit 1
fi
echo "test_squash_history: OK"
