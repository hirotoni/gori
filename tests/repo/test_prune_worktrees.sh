#!/usr/bin/env bash
# tools/repo/prune-worktrees が、片付けてよい worktree だけを REMOVABLE にし、--apply でそれだけを片付けること。
# gh は偽物に差し替える。偽物は --head のブランチ名のファイル（$FAKE_GH_DIR/<ブランチ>）の中身を、--jq の後の形で返す。
set -u
gori="$(cd "$(dirname "$0")/../.." && pwd)"
tool="$gori/tools/repo/prune-worktrees"
mk="$gori/tools/repo/worktree"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/gori-prune.XXXXXX")" || exit 1
tmp="$(cd "$tmp" && pwd -P)"
trap 'rm -rf "$tmp"' EXIT
fails=0
fail() { echo "FAIL: $*"; fails=$((fails + 1)); }
gc() { git -c user.name=t -c user.email=t@example.invalid "$@"; }

mkdir -p "$tmp/bin" "$tmp/gh"
cat >"$tmp/bin/gh" <<'EOF'
#!/bin/sh
[ -n "${FAKE_GH_FAIL:-}" ] && exit 1
b=""
while [ $# -gt 0 ]; do [ "$1" = --head ] && b="$2"; shift; done
[ -f "$FAKE_GH_DIR/$b" ] && cat "$FAKE_GH_DIR/$b"
exit 0
EOF
chmod +x "$tmp/bin/gh"
export PATH="$tmp/bin:$PATH" FAKE_GH_DIR="$tmp/gh"

repo="$tmp/repo"
git -c init.defaultBranch=main init -q "$repo" && printf '.env\n__pycache__/\n*.pyc\n' >"$repo/.gitignore" && git -C "$repo" add .gitignore && gc -C "$repo" commit -q -m init
wt() { (cd "$repo" && "$mk" "$1" >/dev/null) && echo "$repo/.worktree/repo/$1"; }
line() { printf '%s\n' "$1" | grep -F " $2 " ; }

# ff でマージ済み
a="$(wt 2026-01-01-merged)"; gc -C "$a" commit -q --allow-empty -m a; git -C "$repo" merge -q --ff-only 2026-01-01-merged
# 未マージで PR なし
b="$(wt 2026-01-01-open)"; gc -C "$b" commit -q --allow-empty -m b
# マージ済みだが汚れている
c="$(wt 2026-01-01-dirty)"; gc -C "$c" commit -q --allow-empty -m c; git -C "$repo" merge -q --no-edit 2026-01-01-dirty; echo x >"$c/x"
# squash でマージ済み（PR の head が先端と一致）
d="$(wt 2026-01-01-squash)"; gc -C "$d" commit -q --allow-empty -m d
echo "7 MERGED $(git -C "$d" rev-parse HEAD)" >"$tmp/gh/2026-01-01-squash"
# squash でマージ済みだが、マージの後に commit がある
e="$(wt 2026-01-01-after)"; gc -C "$e" commit -q --allow-empty -m e
echo "8 MERGED $(git -C "$e" rev-parse HEAD)" >"$tmp/gh/2026-01-01-after"; gc -C "$e" commit -q --allow-empty -m e2
# 未マージのまま閉じられた
f="$(wt 2026-01-01-closed)"; gc -C "$f" commit -q --allow-empty -m f
echo "9 CLOSED $(git -C "$f" rev-parse HEAD)" >"$tmp/gh/2026-01-01-closed"
# 作ったばかりで commit が無い（既定ブランチに含まれて見える）
g="$(wt 2026-01-01-fresh)"
# マージ済みだが、無視される .env が残る（commit されていないので、消すと取り戻せない）
h="$(wt 2026-01-01-env)"; gc -C "$h" commit -q --allow-empty -m h; git -C "$repo" merge -q --ff-only 2026-01-01-env; echo SECRET=1 >"$h/.env"
# マージ済みで、無視されるのは作り直せる __pycache__ と *.pyc だけ
i="$(wt 2026-01-01-pycache)"; gc -C "$i" commit -q --allow-empty -m i; git -C "$repo" merge -q --ff-only 2026-01-01-pycache
mkdir -p "$i/pkg/__pycache__" && echo x >"$i/pkg/__pycache__/m.cpython-312.pyc" && echo x >"$i/top.pyc"
# マージ済みだが、git status を実行できない（worktree の .git が壊れている）
j="$(wt 2026-01-01-broken)"; gc -C "$j" commit -q --allow-empty -m j; git -C "$repo" merge -q --ff-only 2026-01-01-broken; echo "gitdir: $tmp/nowhere" >"$j/.git"
# .worktree の外の worktree は対象にしない
git -C "$repo" worktree add -q -b outside "$tmp/outside" main

out="$(cd "$repo" && "$tool")"; code=$?
[ "$code" -eq 0 ] || fail "一覧が終了コード 0 で終わらない: $code"
for p in "$a" "$d" "$i"; do line "$out" "$p" | grep -q '^REMOVABLE ' || fail "REMOVABLE でない: $p: $(line "$out" "$p")"; done
for p in "$b" "$c" "$e" "$f" "$g" "$h" "$j"; do line "$out" "$p" | grep -q '^KEEP ' || fail "KEEP でない: $p: $(line "$out" "$p")"; done
line "$out" "$f" | grep -q '要判断' || fail "閉じられた PR が要判断にならない: $(line "$out" "$f")"
line "$out" "$h" | grep -q '要判断: 無視されたファイルが残る: .env' || fail "無視された .env を理由に示さない: $(line "$out" "$h")"
line "$out" "$j" | grep -q '要判断: git status を実行できない' || fail "git status の失敗を要判断にしない: $(line "$out" "$j")"
printf '%s\n' "$out" | grep -qF "$tmp/outside" && fail ".worktree の外の worktree を出した"
[ -d "$a" ] && [ -d "$d" ] || fail "--apply なしで消した"

# gh が使えなければ、既定ブランチに含まれないものは要判断にする
out2="$(cd "$repo" && FAKE_GH_FAIL=1 "$tool")"
line "$out2" "$d" | grep -q '^KEEP .*要判断' || fail "gh の失敗で要判断にならない: $(line "$out2" "$d")"
line "$out2" "$a" | grep -q '^REMOVABLE ' || fail "gh の失敗で ff マージ済みまで残した"

# --apply は REMOVABLE だけを片付ける
out3="$(cd "$repo" && "$tool" --apply)"; code=$?
[ "$code" -eq 0 ] || fail "--apply が失敗した: $code $out3"
[ ! -e "$a" ] && [ ! -e "$d" ] && [ ! -e "$i" ] || fail "REMOVABLE の worktree が残った"
git -C "$repo" show-ref -q --verify refs/heads/2026-01-01-merged && fail "ff マージ済みのブランチが残った"
git -C "$repo" show-ref -q --verify refs/heads/2026-01-01-squash && fail "squash マージ済みのブランチが残った"
for p in "$b" "$c" "$e" "$f" "$g" "$h" "$j" "$tmp/outside"; do [ -d "$p" ] || fail "KEEP の worktree を消した: $p"; done
[ -f "$h/.env" ] || fail "無視された .env を消した"
[ -f "$c/x" ] || fail "汚れた worktree の変更を消した"

# 中にいるシェルからは、その worktree を片付けない
git -C "$c" clean -qfd 2>/dev/null; rm -f "$c/x"
out4="$(cd "$c" && "$tool")"
line "$out4" "$c" | grep -q '^KEEP ' || fail "中にいる worktree を REMOVABLE にした: $(line "$out4" "$c")"

# 使い方の誤り
(cd "$repo" && "$tool" --bogus >/dev/null 2>&1); [ $? -eq 2 ] || fail "不正な引数で終了コード 2 にならない"

if [ "$fails" -gt 0 ]; then exit 1; fi
echo "test_prune_worktrees: OK"
