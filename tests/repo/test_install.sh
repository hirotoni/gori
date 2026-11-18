#!/usr/bin/env bash
set -u
root="$(cd "$(dirname "$0")/../.." && pwd)"
if ! tmp="$(mktemp -d "${TMPDIR:-/tmp}/gori-test.XXXXXX")" || [ -z "$tmp" ] || [ ! -d "$tmp" ]; then
  echo "FAIL: 一時ディレクトリを作れない"
  exit 1
fi
trap 'rm -rf "$tmp"' EXIT
failures=0
fail() { echo "FAIL: $1"; failures=$((failures + 1)); }

mkdir -p "$tmp/bin" "$tmp/gori/tools/repo"
cp "$root/tools/repo/install" "$tmp/gori/tools/repo/install"
git -C "$tmp/gori" init -q
for cmd in git node; do ln -s "$(command -v "$cmd")" "$tmp/bin/$cmd"; done
for cmd in claude; do
  printf '#!/bin/sh\necho "%s $*" >>"%s/calls"\n' "$cmd" "$tmp" >"$tmp/bin/$cmd"
  chmod +x "$tmp/bin/$cmd"
done

run_install() {
  env PATH="$tmp/bin:/usr/bin:/bin" GORI_HOME="$tmp/home" bash "$tmp/gori/tools/repo/install" >/dev/null 2>"$tmp/err"
}

mkdir -p "$tmp/home"
run_install || fail "導入が失敗した: $(cat "$tmp/err")"
run_install || fail "二度目の導入が失敗した: $(cat "$tmp/err")"

[ ! -e "$tmp/home/config" ] || fail "config を書いてはならない: $(cat "$tmp/home/config")"
grep -qx "claude plugin install gori@gori" "$tmp/calls" || fail "プラグインを導入していない"
[ "$(git -C "$tmp/gori" config core.hooksPath)" = tools/repo/githooks ] || fail "hooksPath が設定されていない"
# 学びは作業ツリーの外（git の共通ディレクトリの下の gori/learning/）に置くので、exclude には足さない。
if grep -q 'learning' "$tmp/gori/.git/info/exclude" 2>/dev/null; then fail "exclude に learning を足した"; fi

# 引数と worktree の検査は、導入をまだしていないチェックアウトで行い、何も変えていないことを確かめる。
run_install_at() {
  local script=$1; shift
  env PATH="$tmp/bin:/usr/bin:/bin" GORI_HOME="$tmp/home" bash "$script" "$@" >"$tmp/out" 2>"$tmp/err"
}
assert_untouched() {
  local label=$1 repo=$2
  [ ! -e "$tmp/calls" ] || fail "$label: 導入を進めた: $(cat "$tmp/calls")"
  [ -z "$(git -C "$repo" config core.hooksPath)" ] || fail "$label: hooksPath を変えた"
  if grep -qx '/learning/' "$repo/.git/info/exclude" 2>/dev/null; then fail "$label: exclude を変えた"; fi
  rm -f "$tmp/calls"
}
mkdir -p "$tmp/fresh/tools/repo"
cp "$root/tools/repo/install" "$tmp/fresh/tools/repo/install"
git -C "$tmp/fresh" init -q
rm -f "$tmp/calls"

for opt in --help -h; do
  if run_install_at "$tmp/fresh/tools/repo/install" "$opt"; then
    grep -q '使い方' "$tmp/out" || fail "$opt で使い方を標準出力に出していない: $(cat "$tmp/out")"
  else
    fail "$opt が失敗した: $(cat "$tmp/err")"
  fi
  assert_untouched "$opt" "$tmp/fresh"
done

for args in --bogus extra "--help extra" "-- --help"; do
  # shellcheck disable=SC2086 # 引数の並びを語に分けて渡す
  if run_install_at "$tmp/fresh/tools/repo/install" $args; then
    fail "知らない引数 '$args' で成功した"
  else
    grep -q '使い方' "$tmp/err" || fail "知らない引数 '$args' で使い方を示していない: $(cat "$tmp/err")"
  fi
  assert_untouched "知らない引数 '$args'" "$tmp/fresh"
done

mkdir -p "$tmp/main/tools/repo"
cp "$root/tools/repo/install" "$tmp/main/tools/repo/install"
git -C "$tmp/main" init -q
git -C "$tmp/main" add tools/repo/install
git -C "$tmp/main" -c user.name=t -c user.email=t@t -c commit.gpgsign=false commit -q -m init
git -C "$tmp/main" worktree add -q "$tmp/wt" 2>/dev/null || fail "worktree を作れない"
main_dir="$(cd "$tmp/main" && pwd)"
if run_install_at "$tmp/wt/tools/repo/install"; then
  fail "worktree の中で成功した"
else
  grep -qF "$main_dir" "$tmp/err" || fail "worktree の中で本体のチェックアウトを示していない: $(cat "$tmp/err")"
fi
assert_untouched "worktree" "$tmp/main"

mkdir -p "$tmp/nogit/tools/repo"
cp "$root/tools/repo/install" "$tmp/nogit/tools/repo/install"
if env GIT_CEILING_DIRECTORIES="$tmp" PATH="$tmp/bin:/usr/bin:/bin" bash "$tmp/nogit/tools/repo/install" >/dev/null 2>"$tmp/err"; then
  fail "git のチェックアウトでないのに成功した"
else
  grep -q 'git のチェックアウトでない' "$tmp/err" || fail "git のチェックアウトでないことを示していない: $(cat "$tmp/err")"
fi
[ ! -e "$tmp/calls" ] || fail "git のチェックアウトでないのに導入を進めた: $(cat "$tmp/calls")"

rm -f "$tmp/bin/claude" "$tmp/calls"
if run_install; then
  fail "claude が無いのに成功した"
else
  grep -q '次のコマンドが無い: claude' "$tmp/err" || fail "欠けたコマンドを示していない: $(cat "$tmp/err")"
  [ ! -e "$tmp/calls" ] || fail "前提が欠けているのに導入を進めた: $(cat "$tmp/calls")"
fi

if [ "$failures" -gt 0 ]; then exit 1; fi
echo "test_install: OK"
