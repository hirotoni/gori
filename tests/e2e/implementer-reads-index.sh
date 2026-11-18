#!/usr/bin/env bash
# モデルを呼ぶので tests/run.sh には入れない。手動か review --e2e で実行する。
# 実装の委任先（agents/implementer）が、始めに gori の索引を読むことを確かめる。
# 委任先には SessionStart の注入が届かないので、判断基準の規則は、役割の定義が索引を読ませることでしか届かない。
# 使い方: tests/e2e/implementer-reads-index.sh
set -u
gori="$(cd "$(dirname "$0")/../.." && pwd)"
out="${E2E_OUT:-$(mktemp -d "${TMPDIR:-/tmp}/gori-e2e-implementer.XXXXXX")}"
dir="$out/repo"
mkdir -p "$dir" && cd "$dir" || exit 1
git -c init.defaultBranch=main init -q
git config user.name e2e
git config user.email e2e@example.invalid
printf '#!/bin/sh\necho "Hello, world"\n' > greet.sh && chmod +x greet.sh
git add -A && git commit -q -m init

# shellcheck source=lib/no-wrapper-hooks.sh
. "$gori/tests/e2e/lib/no-wrapper-hooks.sh"
# 記録は gori のチェックアウトの .git/gori/repos/<名前>/ に置く。一時の gori を GORI_ROOT で渡し、本物の gori の記録に書かない。
# shellcheck source=../lib/fake-gori.sh
. "$gori/tests/lib/fake-gori.sh"
use_fake_gori "$out/gori" || exit 1
allowed="Read,Glob,Grep,Agent,Task,Edit,Write,Bash(cat:*),Bash(ls:*),Bash(grep:*),Bash(sh:*)"
echo "出力: $out"
# 振り分けを通さず、委任だけをさせる。確かめたいのは委任先の振る舞いで、委任元の進め方ではない。
claude --plugin-dir "$gori" -p --model sonnet --strict-mcp-config --output-format stream-json --verbose \
  --permission-mode acceptEdits --allowedTools "$allowed" \
  -- "これは委任の試験である。手順書を選ばず、記録も始めない。Agent ツールで subagent_type を gori:implementer にして、次の依頼文をそのまま渡し、返ってきた報告をそのまま出力して終える。依頼文：「目的：greet.sh の挨拶を変える。範囲：greet.sh だけ。受け入れ基準：sh greet.sh が Hello, gori と出力する。検証方法：sh greet.sh を実行する。禁止事項：commit しない。報告の形式：変えた行と、実行した出力。」" \
  > "$out/stream.jsonl" 2> "$out/stream.err"

OUT="$out" DIR="$dir" GORI="$gori" node --input-type=module <<'JS'
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const { OUT, DIR, GORI } = process.env;
const evs = readFileSync(join(OUT, 'stream.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const usesOf = (pick) => evs.filter((e) => e.type === 'assistant' && pick(e)).flatMap((e) => e.message?.content ?? []).filter((b) => b.type === 'tool_use');
const mainUses = usesOf((e) => !e.parent_tool_use_id);
const subUses = usesOf((e) => e.parent_tool_use_id);
const result = evs.filter((e) => e.type === 'result').pop();
const delegated = mainUses.filter((u) => (u.name === 'Agent' || u.name === 'Task') && u.input?.subagent_type === 'gori:implementer');
const index = join(GORI, 'knowledge', 'index.md');
// 索引を読んだとみなすのは、委任先が索引のパスそのものを Read に渡したときだけにする。Grep や cat での部分的な読み方は数えない。
const readIndex = subUses.filter((u) => u.name === 'Read' && u.input?.file_path === index);
const firstEdit = subUses.findIndex((u) => u.name === 'Edit' || u.name === 'Write');
const firstRead = subUses.findIndex((u) => u.name === 'Read' && u.input?.file_path === index);
const checks = [
  ['セッションが結果を返した', result && !result.is_error, JSON.stringify(result?.result ?? '').slice(0, 300)],
  ['gori:implementer に委任した', delegated.length >= 1, mainUses.map((u) => `${u.name}:${u.input?.subagent_type ?? ''}`).join(',')],
  ['委任先の道具の呼び出しが記録に出ている', subUses.length >= 1, `委任先の呼び出し ${subUses.length} 件`],
  ['委任先が索引を Read で読んだ', readIndex.length >= 1, subUses.map((u) => `${u.name}:${u.input?.file_path ?? u.input?.command ?? ''}`).join(' / ')],
  ['索引を読むのは、ファイルを変えるより前', firstRead >= 0 && (firstEdit < 0 || firstRead < firstEdit), `Read ${firstRead} 番目、Edit ${firstEdit} 番目`],
  ['委任先が greet.sh を変えた', readFileSync(join(DIR, 'greet.sh'), 'utf8').includes('Hello, gori'), readFileSync(join(DIR, 'greet.sh'), 'utf8')],
];
console.log(`委任元の呼び出し: ${mainUses.map((u) => u.name).join(' / ')}`);
console.log(`委任先の呼び出し: ${subUses.map((u) => `${u.name}:${u.input?.file_path ?? u.input?.command ?? ''}`).join(' / ')}`);
let ok = true;
for (const [label, pass, detail] of checks) {
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${label}${pass ? '' : `: ${detail}`}`);
  ok &&= pass;
}
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
JS
