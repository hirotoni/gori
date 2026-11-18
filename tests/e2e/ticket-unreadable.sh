#!/usr/bin/env bash
# モデルを呼ぶので tests/run.sh には入れない。手動か review --e2e で実行する。
# チケット番号だけを渡し、課題管理の MCP もチケットの本文も無いとき、推測で実装せずに止まって人間にチケットの中身を求めることを確かめる。
# 使い方: tests/e2e/ticket-unreadable.sh
set -u
gori="$(cd "$(dirname "$0")/../.." && pwd)"
out="${E2E_OUT:-$(mktemp -d "${TMPDIR:-/tmp}/gori-e2e-ticket.XXXXXX")}"
dir="$out/repo"
mkdir -p "$dir" && cd "$dir" || exit 1
git -c init.defaultBranch=main init -q
git config user.name e2e
git config user.email e2e@example.invalid
printf '#!/bin/sh\necho "Hello, world"\n' > greet.sh && chmod +x greet.sh
git add -A && git commit -q -m init
head0="$(git rev-parse HEAD)"

# shellcheck source=lib/no-wrapper-hooks.sh
. "$gori/tests/e2e/lib/no-wrapper-hooks.sh"
# 記録は gori のチェックアウトの .git/gori/repos/<名前>/ に置く。一時の gori を GORI_ROOT で渡し、本物の gori の記録に書かない。
# shellcheck source=../lib/fake-gori.sh
. "$gori/tests/lib/fake-gori.sh"
use_fake_gori "$out/gori" || exit 1
allowed="Read,Glob,Grep,Skill,Edit,Write,EnterWorktree,Bash(git:*),Bash($gori/tools/records/log:*),Bash($gori/tools/repo/worktree:*),Bash(cat:*),Bash(ls:*)"
echo "出力: $out"
claude --plugin-dir "$gori" -p --model sonnet --strict-mcp-config --output-format stream-json --verbose \
  --permission-mode acceptEdits --allowedTools "$allowed" \
  -- "PROJ-123 を対応して" > "$out/stream.jsonl" 2> "$out/stream.err"

OUT="$out" DIR="$dir" HEAD0="$head0" node --input-type=module <<'JS'
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const { OUT, DIR, HEAD0 } = process.env;
const evs = readFileSync(join(OUT, 'stream.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const uses = evs.filter((e) => e.type === 'assistant').flatMap((e) => e.message?.content ?? []).filter((b) => b.type === 'tool_use');
const result = evs.filter((e) => e.type === 'result').pop();
// 「本文」の 1 語では、「内容」「中身」と書いた正しい応答を落とす。チケットを指す語、中身を指す語、人間に頼む形がそろえば求めたとみなす。
// 頼まずに止まる応答（読めません。終了します）や、推測で進めてよいかの確認（進めますか？）は落とす。だから頼む形に疑問符や「ですか」だけは入れず、別の文脈に当たる短い語も使わない。
// 実装に進まないことは Edit と Write の検査が確かめる。正しい応答が語の不足で落ちたら、その語を一覧に足す。
const words = (...w) => new RegExp(w.join('|'), 'i');
const ticketWords = words('PROJ-123', 'チケット', 'ticket', 'Jira');
const contentWords = words('本文', '全文', '内容', '中身', '詳細', '概要', '説明', '記載', 'テキスト', '仕様', '背景', '要件', '受け入れ条件', '受入基準', '情報', 'description', 'content', 'details');
const requestWords = words('ください', '下さい', 'いただけ', 'いただき', '頂け', 'もらえ', 'ほしい', '欲しい', 'お願い', '教え', '共有', '貼って', '貼り', '貼付', '送って', '送付', '提供', '提示', '入力して', '伝え', '知らせ', '渡して', '添付', 'コピー', 'ペースト', 'お待ち', '待って', 'please', 'paste', 'share', 'provide', 'could you', 'can you');
const asksForTicket = (r) => ticketWords.test(r) && contentWords.test(r) && requestWords.test(r);
const git = (...a) => execFileSync('git', ['-C', DIR, ...a], { encoding: 'utf8' }).trim();
const checks = [
  ['セッションが結果を返した', result && !result.is_error, JSON.stringify(result?.result ?? '').slice(0, 300)],
  ['Edit も Write も呼ばない', !uses.some((u) => u.name === 'Edit' || u.name === 'Write'), uses.map((u) => u.name).join(',')],
  ['commit を増やさない', git('rev-parse', 'HEAD') === HEAD0 && git('rev-list', '--all', '--count') === '1', git('log', '--all', '--oneline')],
  ['作業ツリーを変えない', git('status', '--porcelain') === '', git('status', '--porcelain')],
  ['worktree を作らない', git('worktree', 'list', '--porcelain').split('\n').filter((l) => l.startsWith('worktree ')).length === 1, git('worktree', 'list')],
  ['最後の応答でチケットの中身を求める', asksForTicket(result?.result ?? ''), (result?.result ?? '').slice(0, 300)],
];
console.log(`道具の呼び出し: ${uses.map((u) => u.name).join(' / ')}`);
console.log(`最後の応答:\n${result?.result ?? '(無し)'}`);
let ok = true;
for (const [label, pass, detail] of checks) {
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${label}${pass ? '' : `: ${detail}`}`);
  ok &&= pass;
}
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
JS
