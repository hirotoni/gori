#!/usr/bin/env bash
# tools/repo/sync-main が、レビュー済みの commit の有無で merge と rebase を選び、衝突と最新と取り込めない状態を終了コードで分けること。
# origin があれば、進んだ origin の既定ブランチを取り込み、ついでにローカルの main を fast-forward で最新にすること。
set -u
tool="$(cd "$(dirname "$0")/../.." && pwd)/tools/repo/sync-main"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/gori-sync-main.XXXXXX")" || exit 1
tmp="$(cd "$tmp" && pwd -P)"
trap 'rm -rf "$tmp"' EXIT
fails=0
fail() { echo "FAIL: $*"; fails=$((fails + 1)); }
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.invalid GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.invalid
# レビュー結果は gori のチェックアウトの .git/gori/repos/<名前>/verdicts/ にある。一時の gori を作り、GORI_ROOT で道具に渡す。
. "$(cd "$(dirname "$0")/.." && pwd)/lib/fake-gori.sh"
fake_gori "$tmp/gori" || exit 1
export GORI_ROOT="$tmp/gori"

# main に a.txt を置き、作業 ID のブランチの worktree で work.txt を commit し、main を b.txt で進めたリポジトリを作る
setup() {
  local r=$1
  git -c init.defaultBranch=main init -q "$r"
  echo base >"$r/a.txt" && git -C "$r" add a.txt && git -C "$r" commit -q -m base
  git -C "$r" worktree add -q -b 2026-01-01-w "$r/wt" main
  echo work >"$r/wt/work.txt" && git -C "$r/wt" add work.txt && git -C "$r/wt" commit -q -m work
  echo b >"$r/b.txt" && git -C "$r" add b.txt && git -C "$r" commit -q -m main-moved
}
judge() { mkdir -p "$(gori_records "$GORI_ROOT" "$(basename "$1")")/verdicts/$(git -C "$1/wt" rev-parse HEAD)"; }

# 使い方の誤り
out="$(cd "$tmp" && "$tool" --bogus 2>&1)"; code=$?
[ "$code" -eq 2 ] || fail "不明な引数で終了コード 2 にならない: $code $out"

# レビュー済みの commit が無ければ rebase し、main の上に一直線に載る
setup "$tmp/r1"
old="$(git -C "$tmp/r1/wt" rev-parse HEAD)"
out="$(cd "$tmp/r1" && "$tool" --task 2026-01-01-w)"; code=$?
[ "$code" -eq 0 ] && [ "$out" = REBASED ] || fail "レビュー済みが無いのに REBASED でない: $code $out"
git -C "$tmp/r1/wt" merge-base --is-ancestor main HEAD || fail "rebase の後に main を含まない"
[ "$(git -C "$tmp/r1/wt" rev-list --merges main..HEAD | wc -l | tr -d ' ')" -eq 0 ] || fail "rebase なのに merge commit がある"
[ "$(git -C "$tmp/r1/wt" rev-parse HEAD)" != "$old" ] || fail "rebase で SHA が変わっていない"

# レビュー済みの commit があれば merge し、レビュー済みの commit は書き換えない
setup "$tmp/r2"
judge "$tmp/r2"
old="$(git -C "$tmp/r2/wt" rev-parse HEAD)"
out="$(cd "$tmp/r2/wt" && "$tool")"; code=$?
[ "$code" -eq 0 ] && [ "$out" = MERGED ] || fail "レビュー済みがあるのに MERGED でない: $code $out"
git -C "$tmp/r2/wt" merge-base --is-ancestor "$old" HEAD || fail "レビュー済みの commit が履歴から消えた"
git -C "$tmp/r2/wt" merge-base --is-ancestor main HEAD || fail "merge の後に main を含まない"

# 既に main を含めば何もしない
out="$(cd "$tmp/r2" && "$tool" --task 2026-01-01-w)"; code=$?
[ "$code" -eq 0 ] && [ "$out" = UP_TO_DATE ] || fail "最新なのに UP_TO_DATE でない: $code $out"

# 衝突したら途中のまま止め、衝突したファイルを出して終了コード 1
setup "$tmp/r3"
echo theirs >"$tmp/r3/a.txt" && git -C "$tmp/r3" commit -q -am main-edits-a
echo ours >"$tmp/r3/wt/a.txt" && git -C "$tmp/r3/wt" commit -q -am work-edits-a
judge "$tmp/r3"
out="$(cd "$tmp/r3" && "$tool" --task 2026-01-01-w)"; code=$?
[ "$code" -eq 1 ] || fail "衝突で終了コード 1 にならない: $code $out"
[ "$out" = "$(printf 'CONFLICT\na.txt')" ] || fail "衝突の出力が違う: $out"
[ -f "$(git -C "$tmp/r3/wt" rev-parse --git-path MERGE_HEAD)" ] || fail "merge の途中で止まっていない"
git -C "$tmp/r3/wt" merge --abort

# レビュー済みが無く rebase で衝突しても、途中のまま止めて終了コード 1
setup "$tmp/r4"
echo theirs >"$tmp/r4/a.txt" && git -C "$tmp/r4" commit -q -am main-edits-a
echo ours >"$tmp/r4/wt/a.txt" && git -C "$tmp/r4/wt" commit -q -am work-edits-a
out="$(cd "$tmp/r4" && "$tool" --task 2026-01-01-w)"; code=$?
[ "$code" -eq 1 ] && [ "$out" = "$(printf 'CONFLICT\na.txt')" ] || fail "rebase の衝突で CONFLICT と終了コード 1 にならない: $code $out"
[ -d "$(git -C "$tmp/r4/wt" rev-parse --git-path rebase-merge)" ] || fail "rebase の途中で止まっていない"
git -C "$tmp/r4/wt" rebase --abort

# 未 commit の変更があれば何もせず終了コード 2
echo dirty >>"$tmp/r3/wt/work.txt"
before="$(git -C "$tmp/r3/wt" rev-parse HEAD)"
out="$(cd "$tmp/r3" && "$tool" --task 2026-01-01-w 2>&1)"; code=$?
[ "$code" -eq 2 ] || fail "未 commit の変更があるのに終了コード 2 にならない: $code $out"
[ "$(git -C "$tmp/r3/wt" rev-parse HEAD)" = "$before" ] || fail "未 commit の変更があるのに取り込んだ"

# 古い置き場所（作業リポジトリの .git/gori/verdicts/）のレビュー結果は見ない。見ればレビュー済みと誤って merge を選ぶ
setup "$tmp/r5"
mkdir -p "$tmp/r5/.git/gori/verdicts/$(git -C "$tmp/r5/wt" rev-parse HEAD)"
out="$(cd "$tmp/r5" && "$tool" --task 2026-01-01-w)"; code=$?
[ "$code" -eq 0 ] && [ "$out" = REBASED ] || fail "古い置き場所のレビュー結果を見て REBASED にならない: $code $out"

# 記録の場所を決められなければ（repo.yml が食い違う、gori が見つからない）、何もせず終了コード 2
setup "$tmp/r6"
mkdir -p "$(gori_records "$GORI_ROOT" r6)" && echo "path: $tmp/elsewhere" >"$(gori_records "$GORI_ROOT" r6)/repo.yml"
before="$(git -C "$tmp/r6/wt" rev-parse HEAD)"
out="$(cd "$tmp/r6" && "$tool" --task 2026-01-01-w 2>&1)"; code=$?
[ "$code" -eq 2 ] || fail "repo.yml が食い違うのに終了コード 2 にならない: $code $out"
case "$out" in *repo.yml*) ;; *) fail "repo.yml の直し方を示さない: $out" ;; esac
[ "$(git -C "$tmp/r6/wt" rev-parse HEAD)" = "$before" ] || fail "repo.yml が食い違うのに取り込んだ"
out="$(cd "$tmp/r6" && GORI_ROOT="$tmp/r6" "$tool" --task 2026-01-01-w 2>&1)"; code=$?
[ "$code" -eq 2 ] || fail "gori のチェックアウトが無いのに終了コード 2 にならない: $code $out"
[ "$(git -C "$tmp/r6/wt" rev-parse HEAD)" = "$before" ] || fail "gori のチェックアウトが無いのに取り込んだ"

# 作業 ID の worktree が無ければ終了コード 2
out="$(cd "$tmp/r3" && "$tool" --task 2026-01-01-none 2>&1)"; code=$?
[ "$code" -eq 2 ] || fail "worktree の無い作業 ID で終了コード 2 にならない: $code $out"

# origin が進んでいれば、本体のチェックアウトの main を ff で最新にし、その main を取り込む
# 上流（bare）と、作業する clone と、上流を進める別の clone を作る。作業の clone には作業 ID の worktree を置く
setup_origin() {
  local d=$1
  git -c init.defaultBranch=main init -q "$d/src"
  echo base >"$d/src/a.txt" && git -C "$d/src" add a.txt && git -C "$d/src" commit -q -m base
  git clone -q --bare "$d/src" "$d/up.git"
  git clone -q "$d/up.git" "$d/c"
  git clone -q "$d/up.git" "$d/o"
  git -C "$d/c" worktree add -q -b 2026-01-01-w "$d/c/wt" main
  echo work >"$d/c/wt/work.txt" && git -C "$d/c/wt" add work.txt && git -C "$d/c/wt" commit -q -m work
  echo up >"$d/o/up.txt" && git -C "$d/o" add up.txt && git -C "$d/o" commit -q -m upstream && git -C "$d/o" push -q origin main
}
setup_origin "$tmp/o1"
old="$(git -C "$tmp/o1/c" rev-parse main)" up="$(git -C "$tmp/o1/o" rev-parse HEAD)"
out="$(cd "$tmp/o1/c" && "$tool" --task 2026-01-01-w)"; code=$?
[ "$code" -eq 0 ] && [ "$out" = "$(printf 'MAIN_UPDATED=%s..%s\nREBASED' "$old" "$up")" ] || fail "origin が進んだのに main を進めて rebase しない: $code $out"
[ "$(git -C "$tmp/o1/c" rev-parse main)" = "$up" ] || fail "ローカルの main が origin の先端になっていない"
[ -f "$tmp/o1/c/up.txt" ] || fail "本体のチェックアウトの作業ツリーが main に追従していない"
git -C "$tmp/o1/c/wt" merge-base --is-ancestor "$up" HEAD || fail "作業のブランチが origin の先端を含まない"

# 本体のチェックアウトの未 commit の変更と重なって main を進められなければ、警告して origin の先端を取り込み、変更は残す
setup_origin "$tmp/o2"
old="$(git -C "$tmp/o2/c" rev-parse main)" up="$(git -C "$tmp/o2/o" rev-parse HEAD)"
echo mine >"$tmp/o2/c/up.txt"
out="$(cd "$tmp/o2/c" && "$tool" --task 2026-01-01-w 2>"$tmp/o2/err")"; code=$?
[ "$code" -eq 0 ] && [ "$out" = REBASED ] || fail "main を進められないときに origin を取り込まない: $code $out"
[ "$(git -C "$tmp/o2/c" rev-parse main)" = "$old" ] || fail "進められないはずの main が動いた"
[ "$(cat "$tmp/o2/c/up.txt")" = mine ] || fail "本体のチェックアウトの未 commit の変更が消えた"
grep -q "進められなかった" "$tmp/o2/err" || fail "main を進められなかった警告が無い: $(cat "$tmp/o2/err")"
git -C "$tmp/o2/c/wt" merge-base --is-ancestor "$up" HEAD || fail "作業のブランチが origin の先端を含まない"

# main をどこでも checkout していなければ、ref だけを進める
setup_origin "$tmp/o3"
git -C "$tmp/o3/c" checkout -q --detach
up="$(git -C "$tmp/o3/o" rev-parse HEAD)"
out="$(cd "$tmp/o3/c" && "$tool" --task 2026-01-01-w)"; code=$?
[ "$code" -eq 0 ] && [ "$(git -C "$tmp/o3/c" rev-parse main)" = "$up" ] || fail "checkout されていない main の ref を進めない: $code $out"

# ローカルの main と origin が分岐していれば、止まらずにローカルの main を取り込み、分かれていることを一行で知らせる。ローカルの main は進めない
setup_origin "$tmp/o4"
echo local >"$tmp/o4/c/local.txt" && git -C "$tmp/o4/c" add local.txt && git -C "$tmp/o4/c" commit -q -m local
lm="$(git -C "$tmp/o4/c" rev-parse main)" om="$(git -C "$tmp/o4/o" rev-parse HEAD)"
out="$(cd "$tmp/o4/c" && "$tool" --task 2026-01-01-w 2>"$tmp/o4/err")"; code=$?
[ "$code" -eq 0 ] || fail "分岐していると止まった: $code $out $(cat "$tmp/o4/err")"
printf '%s\n' "$out" | grep -qx "UPSTREAM_DIVERGED=$lm...$om" || fail "分かれていることを一行で知らせない: $out"
printf '%s\n' "$out" | tail -1 | grep -qx 'REBASED' || fail "分岐のときにローカルの main を取り込んだ結果を出さない: $out"
grep -q 'GORI_IGNORE_UPSTREAM=1' "$tmp/o4/err" || fail "取り込まない宣言の仕方を案内しない: $(cat "$tmp/o4/err")"
[ "$(git -C "$tmp/o4/c" rev-parse main)" = "$lm" ] || fail "分岐しているのにローカルの main を動かした"
git -C "$tmp/o4/c/wt" merge-base --is-ancestor "$lm" HEAD || fail "作業のブランチがローカルの main を含まない"
git -C "$tmp/o4/c/wt" merge-base --is-ancestor "$om" HEAD && fail "分岐しているのに origin の先端を取り込んだ"

# GORI_IGNORE_UPSTREAM=1 なら、origin が先にあってもローカルの main を進めず、知らせも出さない
setup_origin "$tmp/o6"
old="$(git -C "$tmp/o6/c" rev-parse main)"
out="$(cd "$tmp/o6/c" && GORI_IGNORE_UPSTREAM=1 "$tool" --task 2026-01-01-w 2>&1)"; code=$?
[ "$code" -eq 0 ] || fail "GORI_IGNORE_UPSTREAM=1 で失敗した: $code $out"
printf '%s\n' "$out" | grep -q 'MAIN_UPDATED\|UPSTREAM_DIVERGED' && fail "GORI_IGNORE_UPSTREAM=1 なのに origin を扱った: $out"
[ "$(git -C "$tmp/o6/c" rev-parse main)" = "$old" ] || fail "GORI_IGNORE_UPSTREAM=1 なのにローカルの main を進めた"
git -C "$tmp/o6/c" rev-parse -q --verify refs/remotes/origin/main >/dev/null && [ "$(git -C "$tmp/o6/c" rev-parse origin/main)" = "$(git -C "$tmp/o6/o" rev-parse HEAD)" ] && fail "GORI_IGNORE_UPSTREAM=1 なのに fetch した"

# GORI_IGNORE_UPSTREAM が 0 と 1 のほかなら、何もせず終了コード 2
setup_origin "$tmp/o7"
before="$(git -C "$tmp/o7/c/wt" rev-parse HEAD)"
out="$(cd "$tmp/o7/c" && GORI_IGNORE_UPSTREAM=yes "$tool" --task 2026-01-01-w 2>&1)"; code=$?
[ "$code" -eq 2 ] && printf '%s\n' "$out" | grep -q 'GORI_IGNORE_UPSTREAM は 0 か 1' || fail "値の誤りで 2 にならない: $code $out"
[ "$(git -C "$tmp/o7/c/wt" rev-parse HEAD)" = "$before" ] || fail "値の誤りなのに取り込んだ"

# ローカルの main が origin より先にあれば、ローカルの main を取り込む
setup_origin "$tmp/o5"
git -C "$tmp/o5/c" pull -q --ff-only
echo ahead >"$tmp/o5/c/ahead.txt" && git -C "$tmp/o5/c" add ahead.txt && git -C "$tmp/o5/c" commit -q -m ahead
out="$(cd "$tmp/o5/c" && "$tool" --task 2026-01-01-w)"; code=$?
[ "$code" -eq 0 ] && [ "$out" = REBASED ] || fail "ローカルが先のときに取り込まないか、分岐でないのに知らせた: $code $out"
git -C "$tmp/o5/c/wt" merge-base --is-ancestor main HEAD || fail "ローカルが先のときにローカルの main を含まない"

if [ "$fails" -gt 0 ]; then
  echo "test_sync_main: $fails 件失敗"
  exit 1
fi
echo "test_sync_main: OK"
