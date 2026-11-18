#!/usr/bin/env bash
# モデルを呼ぶので tests/run.sh には入れない。手動で実行する。
# 一時リポジトリで作業を始めて commit し、tools/records/review に本物のレビュアーを起動させ、
# レビュアーが受け取り口に書いたレビュー結果が review の取り込みを通って記録の場所（gori のチェックアウトの .git/gori/repos/<名前>/verdicts）に入り、作業者と別のセッションのものであり、worktree と元の作業ツリーに跡が残らないことを確かめる。
# ok は目的を満たす変更、bad はわざと満たさない変更である。ok は pass、bad は fail が記録されることを期待する。
# 使い方: tests/e2e/review.sh [ok|bad ...]
set -u
gori="$(cd "$(dirname "$0")/../.." && pwd)"
out="${E2E_OUT:-$(mktemp -d "${TMPDIR:-/tmp}/gori-e2e-review.XXXXXX")}"
mkdir -p "$out"
cases=("$@")
[ ${#cases[@]} -eq 0 ] && cases=(ok bad)

unset CLAUDE_CODE_SESSION_ID CLAUDE_SESSION_ID GORI_WORK_REPO GORI_VERDICT_OUTBOX GORI_REVIEWING
# 記録は gori のチェックアウトの .git/gori/repos/<名前>/ に置く。一時の gori を GORI_ROOT で渡し、本物の gori の記録に書かない。
# shellcheck source=../lib/fake-gori.sh
. "$gori/tests/lib/fake-gori.sh"
use_fake_gori "$out/gori" || exit 1
task=20261103-100000-greet
worker_session="e2e-worker-$$"
purpose='greet.sh は、引数があれば Hello, <引数> を、無ければ Hello, world を標準出力に出す'

run_case() {
  local name=$1 dir="$out/$1"
  mkdir -p "$dir" && cd "$dir" || exit 1
  git init -q && git config user.name e2e && git config user.email e2e@example.invalid
  printf '#!/bin/sh\necho "Hello, world"\n' > greet.sh && chmod +x greet.sh
  git add -A && git commit -q -m init
  CLAUDE_CODE_SESSION_ID=$worker_session "$gori/tools/records/log" start --task $task --what "$purpose" > /dev/null
  CLAUDE_CODE_SESSION_ID=$worker_session "$gori/tools/records/log" add --task $task --type accept --what "$purpose" > /dev/null
  # 承認の行はセッション ID の無い環境（端末の人間）から書くので、会話の記録と照合されない。
  env -u CLAUDE_CODE_SESSION_ID -u CLAUDE_SESSION_ID "$gori/tools/records/log" add --task $task --type approval --what "受け入れ条件の承認" --quote "よい" > /dev/null
  if [ "$name" = ok ]; then
    printf '#!/bin/sh\necho "Hello, ${1:-world}"\n' > greet.sh
  else
    printf '#!/bin/sh\necho "Hello, world"\n# 引数は無視する\n' > greet.sh
  fi
  git add -A && git commit -q -m "greet.sh を変更する"
  git rev-parse HEAD > "$out/$name.sha"
  git status --porcelain > "$out/$name.status.before"
  local t0=$SECONDS
  "$gori/tools/records/review" --task $task > "$out/$name.review.out" 2> "$out/$name.review.err"
  echo $? > "$out/$name.review.code"
  echo $((SECONDS - t0)) > "$out/$name.seconds"
}

echo "出力: $out"
for c in "${cases[@]}"; do run_case "$c" & done
wait

GORI="$gori" FAKE_GORI="$GORI_ROOT" OUT="$out" CASES="${cases[*]}" TASK=$task WORKER="$worker_session" node --input-type=module <<'JS'
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const { OUT, CASES, TASK, WORKER } = process.env;
const read = (f) => (existsSync(f) ? readFileSync(f, 'utf8') : '');
let allPass = true;
for (const name of CASES.split(' ')) {
  const results = [];
  const check = (label, ok, detail = '') => results.push({ label, ok, detail });
  const dir = join(OUT, name);
  const sha = read(join(OUT, `${name}.sha`)).trim();
  const code = Number(read(join(OUT, `${name}.review.code`)).trim());
  const git = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' }).stdout.trim();
  const vdir = join(process.env.FAKE_GORI, '.git', 'gori', 'repos', name, 'verdicts', sha);
  const files = existsSync(vdir) ? readdirSync(vdir) : [];
  const v = files.length ? JSON.parse(readFileSync(join(vdir, files.at(-1)), 'utf8')) : null;
  const want = name === 'ok' ? 'pass' : 'fail';

  check('review の終了コードが 3（未レビュー）でない', code === 0 || code === 1, `code=${code}`);
  check(`レビュー結果が ${want} である`, v?.result === want, `実際=${v?.result}`);
  check('レビュー結果が一つ以上記録された', files.length >= 1, `${files.length} 個`);
  const reviews = join(process.env.FAKE_GORI, '.git', 'gori', 'repos', name, 'reviews');
  const init = (existsSync(reviews) ? readdirSync(reviews).map((f) => readFileSync(join(reviews, f), 'utf8')).join('\n') : '').split('\n').map((l) => { try { return JSON.parse(l); } catch { return {}; } }).find((o) => o.type === 'system' && o.subtype === 'init')?.session_id;
  check('review がレビュー結果を取り込んだ', read(join(OUT, `${name}.review.out`)).includes('レビュー結果を取り込んだ'));
  check('judge がレビュアーの init の session_id', Boolean(init) && v?.judge === `session:${init}`, `init=${init} judge=${v?.judge}`);
  check('judge が session:<ID> で、作業者のセッションと異なる', /^session:.+/.test(v?.judge ?? '') && v.judge !== `session:${WORKER}`, `judge=${v?.judge}`);
  check('レビュー結果の model が opus', v?.model === 'opus', `model=${v?.model}`);
  check('pass なら evidence、fail なら findings がある', v && (v.result === 'pass' ? v.evidence.length > 0 : v.findings.length > 0));
  check('worktree が残っていない', git('worktree', 'list').split('\n').length === 1, git('worktree', 'list'));
  check('元の作業ツリーが変わっていない', git('status', '--porcelain') === read(join(OUT, `${name}.status.before`)).trim() && git('rev-parse', 'HEAD') === sha);
  const audit = read(join(process.env.FAKE_GORI, '.git', 'gori', 'repos', name, 'audit', `${TASK}.tsv`)).trim().split('\n').map((l) => l.split('\t'));
  check('判断の記録にレビュー結果の decision 行がある', audit.some((r) => r[2] === 'decision' && r[4] === `レビュー結果 ${want}` && r[1] === v?.judge.replace('session:', '')));

  const pass = results.every((r) => r.ok);
  allPass &&= pass;
  console.log(`\n=== ${name}（${read(join(OUT, `${name}.seconds`)).trim()} 秒）`);
  console.log(`review の出力:\n${read(join(OUT, `${name}.review.out`)).trim()}${read(join(OUT, `${name}.review.err`)).trim() ? `\n${read(join(OUT, `${name}.review.err`)).trim()}` : ''}`);
  console.log(`レビュー結果: ${v ? JSON.stringify(v) : '(なし)'}`);
  for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.label}${r.ok ? '' : `: ${r.detail}`}`);
  console.log(pass ? 'PASS' : 'FAIL');
}
console.log(allPass ? '\nALL PASS' : '\nSOME FAILED');
process.exit(allPass ? 0 : 1);
JS
status=$?
echo "出力: $out"
exit $status
