# shellcheck shell=bash
# 一時の gori のチェックアウトを作る（tests/helpers.mjs の fakeGori と同じ形）。source して使う。
# 記録（判断の記録、レビュー結果、レビューの出力）は gori のチェックアウトの .git/gori/repos/<名前>/ に置く（docs/design.md）。
# テストは GORI_ROOT でここを指し、本物の gori の記録を汚さない。
# 使い方: fake_gori <作るディレクトリ>（git init し、.claude-plugin/plugin.json に {"name":"gori"} を置く）
fake_gori() {
  local d=$1
  mkdir -p "$d/.claude-plugin" || return 1
  env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE git init -q "$d" || return 1
  printf '{"name":"gori"}\n' >"$d/.claude-plugin/plugin.json"
}

# 名前 <name> のリポジトリの記録の場所。使い方: gori_records <gori> <name>
gori_records() { printf '%s/.git/gori/repos/%s\n' "$1" "$2"; }

# E2E が source して呼ぶ。一時の gori を作り、記録の道具と claude -p の Bash に GORI_ROOT で渡す。
# GORI_ROOT はセッションの終わりのフック（tools/hooks/session-end）の抽出の書き込み先も差し替えるので、
# 一時の gori で抽出が起動しないよう、抽出の道具を true に差し替え、状態の置き場所（GORI_HOME）も一時にする（利用者の間引きの時刻を動かさない）。
# 使い方: use_fake_gori <作るディレクトリ>（作った後、GORI_ROOT がそこを指す）
use_fake_gori() {
  fake_gori "$1" || return 1
  GORI_ROOT="$(cd "$1" && pwd -P)" || return 1
  export GORI_ROOT
  mkdir -p "$1.home" || return 1
  export GORI_HOME="$(cd "$1.home" && pwd -P)"
  GORI_EXTRACT_RUN="$(type -P true)" || return 1
  export GORI_EXTRACT_RUN
}
