#!/usr/bin/env bash
# モデルを呼ぶので tests/run.sh には入れない。手動で実行する。
# 中断したセッションと別のセッションが、判断の記録だけから再開して、済んだ手順をやり直さないことを確かめる。
set -u
gori="$(cd "$(dirname "$0")/../.." && pwd)"
out="${E2E_OUT:-$(mktemp -d "${TMPDIR:-/tmp}/gori-e2e.XXXXXX")}"
work="$out/work"
mkdir -p "$work"
cd "$work" || exit 1

git init -q
git config user.name e2e
git config user.email e2e@example.invalid
cat > PLAN.md <<'PLAN'
# 作業

四つの手順を順に行う。各手順は、ファイルを一つ作り、一つのコミットにする。

1. a.txt を作り、中身を `a` にする。コミットメッセージは `step1`。
2. b.txt を作り、中身を `b` にする。コミットメッセージは `step2`。
3. c.txt を作り、中身を `c` にする。コミットメッセージは `step3`。
4. d.txt を作り、中身を `d` にする。コミットメッセージは `step4`。
PLAN
git add PLAN.md
git commit -q -m "計画を置く"

# shellcheck source=lib/no-wrapper-hooks.sh
. "$gori/tests/e2e/lib/no-wrapper-hooks.sh"
# 記録は gori のチェックアウトの .git/gori/repos/<名前>/ に置く。一時の gori を GORI_ROOT で渡し、本物の gori の記録に書かない。
# shellcheck source=../lib/fake-gori.sh
. "$gori/tests/lib/fake-gori.sh"
use_fake_gori "$out/gori" || exit 1
allowed="Skill,Bash(git:*),Bash($gori/tools/records/log:*),Bash(cat:*),Bash(ls:*)"
claude_run() {
  local prompt=$1 dest=$2
  claude --plugin-dir "$gori" -p --model sonnet --output-format stream-json --verbose \
    --permission-mode acceptEdits --allowedTools "$allowed" -- "$prompt" > "$dest" 2> "$dest.err"
}

a="$out/session-a.jsonl"
b="$out/session-b.jsonl"

claude_run "PLAN.md の作業を行う。作業 ID を自分で決め、gori の decision-log の能力で判断を記録しながら、手順 1 と手順 2 だけを行え。その後、gori の pause の能力で中断せよ。手順 3 以降には手を付けない。" "$a"

audit=$(ls "$(gori_records "$GORI_ROOT" "$(basename "$work")")"/audit/*.tsv 2>/dev/null | head -1)
if [ -z "$audit" ]; then
  echo "FAIL: セッション A が判断の記録を作らなかった"
  echo "stream-json: $a"
  exit 1
fi
task=$(basename "$audit" .tsv)

claude_run "作業 $task を、gori の resume の能力で再開して終わらせよ。" "$b"

GORI="$gori" FAKE_GORI="$GORI_ROOT" WORK="$work" TASK="$task" A="$a" B="$b" node --input-type=module <<'JS'
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const { GORI, WORK, TASK, A, B } = process.env;
const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok, detail });
const sh = (cmd, args) => spawnSync(cmd, args, { cwd: WORK, encoding: 'utf8' });

const events = (file) =>
  readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const toolUses = (evs) => evs.filter((e) => e.type === 'assistant').flatMap((e) => e.message?.content ?? []).filter((b) => b.type === 'tool_use');
const sessionOf = (evs) => evs.find((e) => e.type === 'system' && e.subtype === 'init')?.session_id;

const evA = events(A);
const evB = events(B);
const sidA = sessionOf(evA);
const sidB = sessionOf(evB);

for (const f of ['a.txt', 'b.txt', 'c.txt', 'd.txt']) {
  const added = sh('git', ['log', '--diff-filter=A', '--format=%H', '--', f]).stdout.trim().split('\n').filter(Boolean);
  check(`${f} を足したコミットが一つ`, added.length === 1, `${added.length} 個`);
}

const file = join(process.env.FAKE_GORI, '.git', 'gori', 'repos', basename(WORK), 'audit', `${TASK}.tsv`);
const chk = sh(join(GORI, 'tools/records/log'), ['check', file]);
check('log check が通る', chk.status === 0, chk.stdout + chk.stderr);

const rows = readFileSync(file, 'utf8').trimEnd().split('\n').slice(1).map((l) => l.split('\t'));
const typeOf = (r) => r[2];
for (const t of ['start', 'pause', 'resume', 'done']) check(`${t} 行がある`, rows.some((r) => typeOf(r) === t));
const pause = rows.findLast((r) => typeOf(r) === 'pause');
const resume = rows.findLast((r) => typeOf(r) === 'resume');
check('pause と resume の session が異なる', !!pause && !!resume && pause[1] !== resume[1], `pause=${pause?.[1]} resume=${resume?.[1]}`);
check('pause の session が A の session_id と一致する', pause?.[1] === sidA, `記録=${pause?.[1]} A=${sidA}`);
check('resume の session が B の session_id と一致する', resume?.[1] === sidB, `記録=${resume?.[1]} B=${sidB}`);

const writesAB = toolUses(evB).filter((u) => {
  if (u.name === 'Write' || u.name === 'Edit') return /(^|\/)[ab]\.txt$/.test(u.input.file_path ?? '');
  if (u.name === 'Bash') {
    // 文に分けて見る。--what の文字列に a.txt と書いてあるだけの記録の呼び出しを、書き込みと数えない。
    return (u.input.command ?? '').split(/;|&&|\|\||\n/).some((st) => /\b[ab]\.txt\b/.test(st) && /(>|\btee\b|\btouch\b|\bgit (add|rm|mv)\b|\bsed -i\b|\bcp\b|\bmv\b|\brm\b)/.test(st));
  }
  return false;
});
check('B が a.txt と b.txt を書いていない', writesAB.length === 0, JSON.stringify(writesAB.map((u) => u.input)));

const skills = (evs) => toolUses(evs).filter((u) => u.name === 'Skill').map((u) => u.input.skill);
console.log(`セッション A: ${sidA}  Skill: ${skills(evA).join(', ') || '(なし)'}`);
console.log(`セッション B: ${sidB}  Skill: ${skills(evB).join(', ') || '(なし)'}`);
const logCmds = toolUses(evA).filter((u) => u.name === 'Bash' && /tools\/records\/log/.test(u.input.command ?? ''));
console.log(`A の log 呼び出し（先頭）: ${logCmds[0]?.input.command ?? '(なし)'}`);
console.log('--- 判断の記録');
console.log(readFileSync(file, 'utf8'));
console.log('--- git log');
console.log(sh('git', ['log', '--oneline']).stdout);
for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.ok ? '' : `: ${r.detail}`}`);
const pass = results.every((r) => r.ok);
console.log(pass ? 'PASS' : 'FAIL');
process.exit(pass ? 0 : 1);
JS
status=$?
echo "stream-json A: $a"
echo "stream-json B: $b"
echo "作業ディレクトリ: $work"
exit $status
