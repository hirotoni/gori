#!/usr/bin/env bash
# tools/repo/worktree が、作業 ID ごとの worktree を本体の .worktree/<リポジトリ名>/<作業ID> に正しい起点で作ること。
set -u
tool="$(cd "$(dirname "$0")/../.." && pwd)/tools/repo/worktree"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/gori-worktree.XXXXXX")" || exit 1
tmp="$(cd "$tmp" && pwd -P)"
trap 'rm -rf "$tmp"' EXIT
fails=0
fail() { echo "FAIL: $*"; fails=$((fails + 1)); }
gc() { git -c user.name=t -c user.email=t@example.invalid "$@"; }
last() { printf '%s\n' "$1" | tail -1; }

new_repo() {
  git -c init.defaultBranch=main init -q "$1" && gc -C "$1" commit -q --allow-empty -m init
}

# 使い方の誤り
out="$(cd "$tmp" && "$tool" bad-id 2>&1)"; code=$?
[ "$code" -eq 2 ] || fail "不正な作業 ID で終了コード 2 にならない: $code $out"
printf '%s\n' "$out" | grep -qF '<YYYYMMDD>-<hhmmss>-<slug>' || fail "案内文が新しい形を示さない: $out"
for bad in 20261108-1030-x 20261108-103015- 20261108-103015-X 2026-11-08-X ""; do
  out="$(cd "$tmp" && "$tool" "$bad" 2>&1)"; code=$?
  [ "$code" -eq 2 ] || fail "形でない作業 ID「$bad」で終了コード 2 にならない: $code $out"
done
# 形の正規表現は tools/lib/audit.mjs の一か所に置き、このスクリプトに書かない
! grep -qE '\[0-9\]\{' "$tool" || fail "worktree に作業 ID の正規表現が書かれている"

# リモートが無ければローカルの main を起点にし、exclude に .worktree を足す
new_repo "$tmp/local"
out="$(cd "$tmp/local" && "$tool" 2026-01-01-a)"; code=$?
want="$tmp/local/.worktree/local/2026-01-01-a"
[ "$code" -eq 0 ] || fail "リモート無しで失敗した: $code $out"
[ "$(last "$out")" = "WORKTREE_DIR=$want" ] || fail "最終行が違う: $out"
printf '%s\n' "$out" | grep -qx 'BASE=main' || fail "リモート無しで起点が main でない: $out"
[ "$(git -C "$want" branch --show-current)" = 2026-01-01-a ] || fail "ブランチが作業 ID でない"
grep -qx '.worktree' "$tmp/local/.git/info/exclude" || fail "exclude に .worktree が無い"
[ -z "$(git -C "$tmp/local" status --porcelain)" ] || fail "本体に .worktree が未追跡として出る"
[ "$(git -C "$tmp/local" branch --show-current)" = main ] || fail "本体のブランチが変わった"

# 再実行は同じ worktree を返し、exclude の行を増やさない
out="$(cd "$tmp/local" && "$tool" 2026-01-01-a)"; code=$?
[ "$code" -eq 0 ] && [ "$(last "$out")" = "WORKTREE_DIR=$want" ] || fail "再実行で同じ worktree を返さない: $code $out"
[ "$(grep -cx '.worktree' "$tmp/local/.git/info/exclude")" -eq 1 ] || fail "再実行で exclude の行が増えた"

# 新しい形の作業 ID でも作る
out="$(cd "$tmp/local" && "$tool" 20260101-103015-new)"; code=$?
[ "$code" -eq 0 ] && [ "$(last "$out")" = "WORKTREE_DIR=$tmp/local/.worktree/local/20260101-103015-new" ] || fail "新しい形の作業 ID で作らない: $code $out"
[ "$(git -C "$tmp/local/.worktree/local/20260101-103015-new" branch --show-current)" = 20260101-103015-new ] || fail "新しい形のブランチが作業 ID でない"

# 別の worktree の中から実行しても、本体の下に作る
out="$(cd "$want" && "$tool" 2026-01-01-b)"; code=$?
[ "$(last "$out")" = "WORKTREE_DIR=$tmp/local/.worktree/local/2026-01-01-b" ] || fail "worktree の中から実行すると本体の下に作らない: $code $out"

# ブランチだけ残っていれば、そのブランチで作り直す
gc -C "$want" commit -q --allow-empty -m work
sha="$(git -C "$want" rev-parse HEAD)"
git -C "$tmp/local" worktree remove "$want"
out="$(cd "$tmp/local" && "$tool" 2026-01-01-a)"; code=$?
[ "$code" -eq 0 ] && [ "$(git -C "$want" rev-parse HEAD)" = "$sha" ] || fail "残ったブランチで作り直さない: $code $out"

# origin があれば fetch して origin の既定ブランチを起点にし、追跡は付けない
new_repo "$tmp/upstream-src"
git clone -q --bare "$tmp/upstream-src" "$tmp/upstream.git"
git clone -q "$tmp/upstream.git" "$tmp/clone"
git clone -q "$tmp/upstream.git" "$tmp/other"
gc -C "$tmp/other" commit -q --allow-empty -m ahead && git -C "$tmp/other" push -q origin main
ahead="$(git -C "$tmp/other" rev-parse HEAD)"
out="$(cd "$tmp/clone" && "$tool" 2026-01-01-c)"; code=$?
wt="$tmp/clone/.worktree/clone/2026-01-01-c"
[ "$code" -eq 0 ] || fail "origin ありで失敗した: $code $out"
printf '%s\n' "$out" | grep -qx 'BASE=origin/main' || fail "起点が origin/main でない: $out"
[ "$(git -C "$wt" rev-parse HEAD)" = "$ahead" ] || fail "fetch した origin の先端を起点にしていない"
[ -z "$(git -C "$wt" config --get branch.2026-01-01-c.merge)" ] || fail "作業ブランチに追跡が付いた"

# origin に届かなければ、最後に取得した状態を起点にして続ける
git -C "$tmp/clone" remote set-url origin "$tmp/missing.git"
out="$(cd "$tmp/clone" && "$tool" 2026-01-01-d 2>&1)"; code=$?
[ "$code" -eq 0 ] && printf '%s\n' "$out" | grep -qx 'BASE=origin/main' || fail "fetch の失敗で止まるか起点が違う: $code $out"
printf '%s\n' "$out" | grep -q 'fetch に失敗した' || fail "fetch の失敗を知らせない: $out"

# ローカルの main が origin/main を含んで先行していれば、ローカルの main を起点にする（review がローカルの main の先端を求めるため）
git -C "$tmp/clone" remote set-url origin "$tmp/upstream.git"
gc -C "$tmp/clone" pull -q --ff-only origin main
gc -C "$tmp/clone" commit -q --allow-empty -m local-ahead
local_ahead="$(git -C "$tmp/clone" rev-parse HEAD)"
out="$(cd "$tmp/clone" && "$tool" 2026-01-01-f)"; code=$?
[ "$code" -eq 0 ] || fail "ローカルが先行していると失敗した: $code $out"
printf '%s\n' "$out" | grep -qx 'BASE=main' || fail "ローカルが先行しているのに起点が main でない: $out"
[ "$(git -C "$tmp/clone/.worktree/clone/2026-01-01-f" rev-parse HEAD)" = "$local_ahead" ] || fail "ローカルの main の先端を起点にしていない"

# ローカルの main と origin/main が分岐していれば、止まらずにローカルの main を起点にし、分かれていることを一行で知らせる
printf '%s\n' "$out" | grep -q UPSTREAM_DIVERGED && fail "ローカルが先行しているだけなのに分岐を知らせた: $out"
gc -C "$tmp/other" commit -q --allow-empty -m remote-diverge && git -C "$tmp/other" push -q origin main
remote_tip="$(git -C "$tmp/other" rev-parse HEAD)"
out="$(cd "$tmp/clone" && "$tool" 2026-01-01-g 2>&1)"; code=$?
[ "$code" -eq 0 ] || fail "分岐していると止まった: $code $out"
printf '%s\n' "$out" | grep -qx "UPSTREAM_DIVERGED=$local_ahead...$remote_tip" || fail "分かれていることを一行で知らせない: $out"
printf '%s\n' "$out" | grep -qx 'BASE=main' || fail "分岐のときに起点がローカルの main でない: $out"
[ "$(git -C "$tmp/clone/.worktree/clone/2026-01-01-g" rev-parse HEAD)" = "$local_ahead" ] || fail "分岐のときにローカルの main の先端を起点にしていない"

# GORI_IGNORE_UPSTREAM=1 なら、origin を見ずにローカルの main を起点にし、知らせも出さない
gc -C "$tmp/other" commit -q --allow-empty -m remote-more && git -C "$tmp/other" push -q origin main
out="$(cd "$tmp/clone" && GORI_IGNORE_UPSTREAM=1 "$tool" 2026-01-01-h 2>&1)"; code=$?
[ "$code" -eq 0 ] && printf '%s\n' "$out" | grep -qx 'BASE=main' || fail "GORI_IGNORE_UPSTREAM=1 で起点がローカルの main でない: $code $out"
printf '%s\n' "$out" | grep -q 'UPSTREAM_DIVERGED\|fetch' && fail "GORI_IGNORE_UPSTREAM=1 なのに origin を扱った: $out"
[ "$(git -C "$tmp/clone" rev-parse origin/main)" = "$remote_tip" ] || fail "GORI_IGNORE_UPSTREAM=1 なのに fetch した"

# GORI_IGNORE_UPSTREAM が 0 と 1 のほかなら、作らずに 2 で止まる
out="$(cd "$tmp/clone" && GORI_IGNORE_UPSTREAM=yes "$tool" 2026-01-01-i 2>&1)"; code=$?
[ "$code" -eq 2 ] || fail "値の誤りで 2 にならない: $code $out"
git -C "$tmp/clone" show-ref --verify -q refs/heads/2026-01-01-i && fail "値の誤りなのにブランチを作った"

# worktree でない同名のディレクトリがあれば止まる
mkdir -p "$tmp/local/.worktree/local/2026-01-01-e"
out="$(cd "$tmp/local" && "$tool" 2026-01-01-e 2>&1)"; code=$?
[ "$code" -eq 1 ] || fail "worktree でないディレクトリの上に作ろうとした: $code $out"

if [ "$fails" -gt 0 ]; then exit 1; fi
echo "test_worktree: OK"
