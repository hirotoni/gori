#!/usr/bin/env bash
set -u
root="$(cd "$(dirname "$0")/.." && pwd)"
# テストの前に、GIT_ と GORI_ で始まる環境変数を消す（理由は tests/lib/clean-env.sh）。
# shellcheck source=lib/clean-env.sh
. "$root/tests/lib/clean-env.sh"
cd "$root" || exit 1

# テストは一時ディレクトリに一時リポジトリを作る。作れないまま進むと、空の変数を使うスクリプトが作業ツリーを壊すので、
# 作って消せることを確かめ、できなければ個々のテストを走らせずに失敗する。mktemp -d は TMPDIR を見ない環境があるので、置き場所を明示する。
if ! probe="$(mktemp -d "${TMPDIR:-/tmp}/gori-tmpcheck.XXXXXX" 2>&1)" || [ ! -d "$probe" ] || ! rmdir "$probe" 2>/dev/null; then
  echo "FAILED: 一時ディレクトリを作って消せない（TMPDIR=${TMPDIR:-<未設定>}）。テストは走らせない: $probe" >&2
  exit 1
fi

# テストとテストが起動する道具が作る一時ディレクトリは、この実行だけの一時ディレクトリの下に作らせ、終わりにまとめて消す。
# 個々のテストに後始末を書かせると書き忘れが残り、失敗で途中で止まったテストの分も残る。
# node の tmpdir() は TMPDIR を見る。mktemp は TMPDIR を見ない環境があるので、テストは "${TMPDIR:-/tmp}/<名前>.XXXXXX" のようにテンプレートで置き場所を渡す。
# 書き込みを外したディレクトリを作るテストがあるので、消す前に書き込みを戻す。
tmp="${TMPDIR:-/tmp}"
if ! work="$(mktemp -d "${tmp%/}/gori-tests.XXXXXX")"; then
  echo "FAILED: テストの一時ディレクトリを作れない" >&2
  exit 1
fi
cleanup() { chmod -R u+w "$work" 2>/dev/null; rm -rf "$work"; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
export TMPDIR="$work"

# 引数なしは全体を走らせる。--changed は、main との分岐点から作業ツリーまでに変えたファイルに関わるテストだけを走らせる（選び方は tests/lib/select.mjs）。
# lint と索引の検査は、どちらでも走らせる。
case "${1-}" in
  "") selected=ALL ;;
  --changed) selected="$(node tests/lib/select.mjs)" || { echo "FAILED: テストを選べなかった" >&2; exit 1; } ;;
  *) echo "使い方: tests/run.sh [--changed]" >&2; exit 2 ;;
esac

failed=()
run() {
  local label=$1; shift
  echo "== $label"
  "$@" || failed+=("$label")
}

if [ "$selected" = ALL ]; then
  for t in tests/repo/test_*.sh; do
    run "$t" bash "$t"
  done
  run "node --test" node --test tests/*/*.test.mjs
else
  mjs=()
  while IFS= read -r t; do
    case "$t" in
      *.sh) run "$t" bash "$t" ;;
      *.test.mjs) mjs+=("$t") ;;
    esac
  done <<EOF_SELECTED
$selected
EOF_SELECTED
  [ "${#mjs[@]}" -gt 0 ] && run "node --test" node --test "${mjs[@]}"
fi
run "tools/knowledge/lint" tools/knowledge/lint
run "tools/knowledge/build-index --check" tools/knowledge/build-index --check

if [ "${#failed[@]}" -gt 0 ]; then
  printf 'FAILED: %s\n' "${failed[@]}"
  exit 1
fi
echo "all passed"
