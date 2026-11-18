#!/usr/bin/env bash
# tests/run.sh が、テストの作った一時ディレクトリを、テストが失敗して終わったときも、Ctrl-C で止めたときも残さないこと。
# 本物のテストの全体は重いので、tests/run.sh を写した小さなツリーで、一時ディレクトリを作って失敗するテストを走らせる。
set -u
unset GIT_DIR GIT_INDEX_FILE GIT_WORK_TREE
root="$(cd "$(dirname "$0")/../.." && pwd)"
failures=0
fail() { echo "FAIL: $1"; failures=$((failures + 1)); }

tmp="${TMPDIR:-/tmp}"
base="$(mktemp -d "${tmp%/}/gori-cleanup.XXXXXX")" || { echo "FAIL: 一時ディレクトリを作れない"; exit 1; }
trap 'chmod -R u+w "$base" 2>/dev/null; rm -rf "$base"' EXIT

tree="$base/tree"
mkdir -p "$tree/tests/lib" "$tree/tests/x" "$tree/tests/repo"
cp "$root/tests/run.sh" "$tree/tests/run.sh"
cp "$root/tests/lib/clean-env.sh" "$tree/tests/lib/clean-env.sh"
# node のテストと sh のテストが、それぞれ一時ディレクトリを作り、消さずに失敗する。node のテストは書き込みも外す。
cat >"$tree/tests/x/leak.test.mjs" <<'EOF'
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
test('一時ディレクトリを残して失敗する', () => {
  const d = mkdtempSync(join(tmpdir(), 'gori-leak-'));
  writeFileSync(join(d, 'f'), 'x');
  chmodSync(d, 0o500);
  if (process.env.HANG_MARK) {
    writeFileSync(process.env.HANG_MARK, d);
    for (;;) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
  throw new Error('失敗');
});
EOF
cat >"$tree/tests/repo/test_leak.sh" <<'EOF'
d="$(mktemp -d "${TMPDIR:-/tmp}/gori-leak.XXXXXX")" && touch "$d/f"
exit 1
EOF

# 1. テストが失敗して終わっても、残らない。
box="$base/box1"
mkdir "$box"
out="$(TMPDIR="$box" bash "$tree/tests/run.sh" 2>&1)"; code=$?
[ "$code" -ne 0 ] || fail "失敗するテストで tests/run.sh が成功した: $out"
grep -q 'FAILED: .*node --test' <<<"$out" || fail "node のテストが走って失敗していない: $out"
grep -q 'FAILED: .*test_leak.sh' <<<"$out" || fail "sh のテストが走って失敗していない: $out"
left="$(ls -A "$box")"
[ -z "$left" ] || fail "失敗で終わった後に一時ディレクトリが残った: $left"

# 2. テストの途中で Ctrl-C（プロセスグループへの SIGINT）で止めても、残らない。
box="$base/box2"
mkdir "$box"
mark="$base/hang-mark"
set -m
HANG_MARK="$mark" TMPDIR="$box" bash "$tree/tests/run.sh" >/dev/null 2>&1 &
pid=$!
set +m
for _ in $(seq 1 100); do [ -s "$mark" ] && break; sleep 0.1; done
if [ -s "$mark" ]; then
  made="$(cd "$(cat "$mark")" && pwd -P)"
  case "$made" in "$(cd "$box" && pwd -P)"/*) ;; *) fail "テストの一時ディレクトリが実行の一時ディレクトリの下に無い: $made" ;; esac
  kill -INT -- "-$pid"
  wait "$pid" 2>/dev/null
  left="$(ls -A "$box")"
  [ -z "$left" ] || fail "Ctrl-C で止めた後に一時ディレクトリが残った: $left"
else
  kill -KILL -- "-$pid" 2>/dev/null
  fail "止める前のテストが一時ディレクトリを作らなかった"
fi

if [ "$failures" -gt 0 ]; then exit 1; fi
echo "test_tmpdir_cleanup: OK"
