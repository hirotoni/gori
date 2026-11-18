#!/usr/bin/env bash
# 利用者の Claude Code には、Edit や Write の後に .md を整形するフック（PostToolUse）がある。
# 整形が知識ファイルの frontmatter や索引を崩すと、知識ファイルを編集するたびに lint が落ちる。
# 確かめること: Edit、Write、MultiEdit のそれぞれで走るフックの command を、作業ツリー（未追跡のファイルを含む。review の --e2e ではレビューする commit）の一時コピーの knowledge/ の全 .md にその道具と同じ入力で走らせても、どのファイルも変わらず、lint と build-index --check が通る。
# フックは利用者の設定にあり、レビュアーのサンドボックスの外にあるので、review の --e2e で走らせる。
# 対照として knowledge/ の外の .md にも同じフックを走らせ、整形されることを確かめる。整形されなければ、フックが動いていないので確かめられない（終了コード 2）。
# 読むフックは、利用者の ~/.claude/settings.json と、あれば ~/.claude/settings.local.json の PostToolUse の command だけである。
# プロジェクトの .claude/settings*.json、管理された設定、プラグインのフックは読まないので、そこにある整形のフックは確かめない。
# フックの command は bash -c で走らせる。整形でないフック（通知など）も、ファイルと道具の組ごとに走る。
# 使い方: tests/e2e/formatter-keeps-knowledge-files.sh（設定ファイルは GORI_CLAUDE_SETTINGS で一つに差し替えられる）
set -u -o pipefail
while IFS='=' read -r name _; do
  case "$name" in GIT_*) unset "$name" ;; esac
done <<EOF_ENV
$(env)
EOF_ENV
gori="$(cd "$(dirname "$0")/../.." && pwd)"
if [ -n "${GORI_CLAUDE_SETTINGS:-}" ]; then
  settings=("$GORI_CLAUDE_SETTINGS")
else
  settings=("$HOME/.claude/settings.json")
  [ -f "$HOME/.claude/settings.local.json" ] && settings+=("$HOME/.claude/settings.local.json")
fi

cannot() {
  echo "CANNOT: $1" >&2
  exit 2
}

command -v jq >/dev/null 2>&1 || cannot "jq が無いのでフックの設定を読めない"
[ -f "${settings[0]}" ] || cannot "${settings[0]} が無い"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/gori-formatter.XXXXXX")" || cannot "一時ディレクトリを作れない"
[ -n "$tmp" ] && [ -d "$tmp" ] || cannot "一時ディレクトリを作れない"
trap 'rm -rf "$tmp"' EXIT
copy="$tmp/gori"
mkdir "$copy" || exit 1
(cd "$gori" && git ls-files -co --exclude-standard -z) | (cd "$gori" && tar cf - --null -T -) | (cd "$copy" && tar xf -) || cannot "作業ツリーを複製できない"
cd "$copy" || exit 1
git init -q && git add -A && git -c user.name=e2e -c user.email=e2e@example.invalid commit -qm base || cannot "一時リポジトリを作れない"

TOOLS=(Edit Write MultiEdit)
: >"$tmp/hook.log"
# 道具ごとに、その道具で走る PostToolUse の command を $tmp/hooks-<道具> に NUL 区切りで書く。
# matcher は、空か * なら全部、英数字と _ と | だけなら名前の完全一致（| で並べたどれか）、それ以外は正規表現として道具の名前のどこかに当てる。
total=0
for tool in "${TOOLS[@]}"; do
  : >"$tmp/hooks-$tool"
  for sf in "${settings[@]}"; do
    jq -j --arg t "$tool" '.hooks.PostToolUse // [] | .[] | select((.matcher // "") as $m | $m == "" or $m == "*" or (if ($m | test("^[A-Za-z0-9_|]+$")) then ($m | split("|") | index($t)) != null else ($t | test($m)) end)) | .hooks // [] | .[] | select(.type == "command") | .command, "\u0000"' "$sf" >>"$tmp/hooks-$tool" || cannot "$sf の PostToolUse を読めない"
  done
  n="$(tr -cd '\000' <"$tmp/hooks-$tool" | wc -c | tr -d ' ')"
  total=$((total + n))
done
[ "$total" -gt 0 ] || cannot "${settings[*]} に Edit、Write、MultiEdit で走る PostToolUse の command が無い"

run_hooks() {
  local f=$1 tool input c
  for tool in "${TOOLS[@]}"; do
    input="$(jq -nc --arg f "$f" --arg t "$tool" '{hook_event_name: "PostToolUse", tool_name: $t, tool_input: {file_path: $f}}')"
    while IFS= read -r -d '' c; do
      printf '%s' "$input" | (cd "$copy" && bash -c "$c") >>"$tmp/hook.log" 2>&1
    done <"$tmp/hooks-$tool"
  done
}

# 対照: knowledge/ の外にある、崩される形の frontmatter と表を持つ .md。
control="$copy/formatter-control.md"
printf -- '---\nrefs: [aaaa/bbbbbbbbbbbb, cccc/dddddddddddd, eeee/ffffffffffff, gggg/hhhhhhhhhhhh, iiii/jjjj]\n---\n\n| a | b |\n| --- | --- |\n| ccccccc | d |\n' >"$control"
before="$(cat "$control")"
run_hooks "$control"
if [ "$(cat "$control")" = "$before" ]; then
  cat "$tmp/hook.log" >&2
  cannot "フックが knowledge/ の外の .md を整形しなかった。フックの整形が動いていないので確かめられない"
fi
rm -f "$control"

files=()
while IFS= read -r -d '' f; do
  files+=("$f")
done < <(git ls-files -z -- 'knowledge/*.md')
[ "${#files[@]}" -gt 0 ] || cannot "knowledge/ に .md が無い"
for f in "${files[@]}"; do
  run_hooks "$copy/$f"
done

fail=0
changed="$(git status --porcelain -- knowledge)"
if [ -n "$changed" ]; then
  echo "FAILED: フックが knowledge/ のファイルを書き換えた:" >&2
  printf '%s\n' "$changed" >&2
  git --no-pager diff --stat -- knowledge >&2
  fail=1
fi
tools/knowledge/lint || fail=1
tools/knowledge/build-index --check || fail=1
if [ "$fail" -ne 0 ]; then
  echo "フックの出力:" >&2
  cat "$tmp/hook.log" >&2
  exit 1
fi
echo "PASSED: フックを knowledge/ の ${#files[@]} 件の .md に走らせても変わらず、lint と build-index --check が通る"
