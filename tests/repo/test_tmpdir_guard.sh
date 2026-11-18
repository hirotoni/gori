#!/usr/bin/env bash
# 一時ディレクトリを作れない環境（TMPDIR が書けない場所）で、tests/run.sh が個々のテストを走らせずに失敗し、
# 作業ツリーのファイルを消さないこと。
set -u
unset GIT_DIR GIT_INDEX_FILE GIT_WORK_TREE
root="$(cd "$(dirname "$0")/../.." && pwd)"
failures=0
fail() { echo "FAIL: $1"; failures=$((failures + 1)); }

# 作業ツリーの状態の指紋。何かが消えれば変わる。
fingerprint() { (cd "$root" && find . -path ./.git -prune -o -type f -print | LC_ALL=C sort | cksum); }

bad="$(mktemp -d "${TMPDIR:-/tmp}/gori-guard.XXXXXX")" || { echo "FAIL: 一時ディレクトリを作れない"; exit 1; }
trap 'rm -rf "$bad"' EXIT
chmod 500 "$bad"
unwritable="$bad/no-such-dir"

before="$(fingerprint)"
out="$(TMPDIR="$unwritable" bash "$root/tests/run.sh" 2>&1)"; code=$?
[ "$code" -ne 0 ] || fail "TMPDIR を書けない場所に向けても tests/run.sh が成功した"
grep -q '一時ディレクトリを作って消せない' <<<"$out" || fail "理由が出ていない: $out"
if grep -q '^== ' <<<"$out"; then fail "個々のテストが走った: $out"; fi

[ "$(fingerprint)" = "$before" ] || fail "作業ツリーのファイルが変わった"

if [ "$failures" -gt 0 ]; then exit 1; fi
echo "test_tmpdir_guard: OK"
