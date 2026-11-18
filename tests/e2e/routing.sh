#!/usr/bin/env bash
# モデルを呼ぶので tests/run.sh には入れない。手動で実行する。
# 新しいセッションに依頼を一つ出し、振り分けが手順書を選んで読み、記録を始めて手順を写すことを確かめる。
# 依頼文には手順書の名前を書かない。振り分けが自分で選ぶことを確かめるためである。
# 使い方: tests/e2e/routing.sh [feature|bug-fix|investigation|harness-change ...]
set -u
gori="$(cd "$(dirname "$0")/../.." && pwd)"
out="${E2E_OUT:-$(mktemp -d "${TMPDIR:-/tmp}/gori-e2e-routing.XXXXXX")}"
mkdir -p "$out"
cases=("$@")
[ ${#cases[@]} -eq 0 ] && cases=(feature bug-fix investigation harness-change)

suffix="試験のため、記録を始めて手順を写したら、作業に入らず pause で中断すること。"
# shellcheck source=lib/no-wrapper-hooks.sh
. "$gori/tests/e2e/lib/no-wrapper-hooks.sh"
# 記録は gori のチェックアウトの .git/gori/repos/<名前>/ に置く。一時の gori を GORI_ROOT で渡し、本物の gori の記録に書かない。
# shellcheck source=../lib/fake-gori.sh
. "$gori/tests/lib/fake-gori.sh"
use_fake_gori "$out/gori" || exit 1
allowed="Read,Glob,Grep,Skill,Bash(git:*),Bash($gori/tools/records/log:*),Bash(cat:*),Bash(ls:*)"

init_repo() {
  git init -q
  git config user.name e2e
  git config user.email e2e@example.invalid
}

setup() {
  local name=$1 dir=$2
  case $name in
    feature)
      mkdir -p "$dir" && cd "$dir" && init_repo
      printf '#!/bin/sh\necho "Hello, world"\n' > greet.sh && chmod +x greet.sh
      cat > TICKET.md <<'EOF'
# GREET-3 名前を渡して挨拶できるようにする

受け入れ条件:
- `./greet.sh Alice` が `Hello, Alice` を出す。
- 引数が無ければ、今までどおり `Hello, world` を出す。
EOF
      git add -A && git commit -q -m init
      request="TICKET.md のチケット GREET-3 を実装して、PR を出せる状態にしてほしい。"
      ;;
    bug-fix)
      mkdir -p "$dir" && cd "$dir" && init_repo
      cat > calc.sh <<'EOF'
#!/bin/sh
case "$1" in
  add) echo $(( $2 * $3 )) ;;
  sub) echo $(( $2 - $3 )) ;;
esac
EOF
      chmod +x calc.sh
      git add -A && git commit -q -m init
      request="\`./calc.sh add 2 3\` を実行すると 6 が出る。5 が出るはずなので直してほしい。"
      ;;
    investigation)
      mkdir -p "$dir" && cd "$dir" && init_repo
      mkdir -p lib conf
      printf 'LOG_DIR=/var/log/app\nRETENTION_DAYS=14\n' > conf/app.env
      printf '#!/bin/sh\n. "$(dirname "$0")/../conf/app.env"\nfind "$LOG_DIR" -mtime +"${RETENTION_DAYS:-7}" -delete\n' > lib/rotate.sh
      printf '#!/bin/sh\n. ./conf/app.env\nexec ./server >> "$LOG_DIR/server.log" 2>&1\n' > run.sh
      git add -A && git commit -q -m init
      request="このリポジトリのサーバーのログはどこに書き出され、何日で消えるのか。根拠のファイルと行を付けて調べてほしい。"
      ;;
    harness-change)
      git clone -q "$gori" "$dir" && cd "$dir" && git config user.name e2e && git config user.email e2e@example.invalid
      request="gori の、確認なしに進めてよいかの判断基準に、秘密情報を含むファイルを commit しないという規則を足してほしい。"
      ;;
  esac
}

run_case() {
  local name=$1 dir="$out/$1"
  local stream="$out/$name.jsonl"
  ( setup "$name" "$dir" > "$out/$name.setup.log" 2>&1
    cd "$dir" || exit 1
    printf '%s\n' "$request" > "$out/$name.request"
    local t0=$SECONDS
    claude --plugin-dir "$gori" -p --model sonnet --output-format stream-json --verbose \
      --permission-mode acceptEdits --allowedTools "$allowed" \
      -- "$request
$suffix" > "$stream" 2> "$stream.err"
    echo $((SECONDS - t0)) > "$out/$name.seconds" )
}

echo "出力: $out"
for c in "${cases[@]}"; do run_case "$c" & done
wait

GORI="$gori" FAKE_GORI="$GORI_ROOT" OUT="$out" CASES="${cases[*]}" node --input-type=module <<'JS'
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const { GORI, FAKE_GORI, OUT, CASES } = process.env;
const { procedureSteps } = await import(join(GORI, 'tools/lib/steps.mjs'));
const { readFrontmatter } = await import(join(GORI, 'tools/lib/frontmatter.mjs'));

const events = (file) =>
  existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];
const toolUses = (evs) => evs.filter((e) => e.type === 'assistant').flatMap((e) => e.message?.content ?? []).filter((b) => b.type === 'tool_use');

let allPass = true;
for (const name of CASES.split(' ')) {
  const results = [];
  const check = (label, ok, detail = '') => results.push({ label, ok, detail });
  const dir = join(OUT, name);
  const evs = events(join(OUT, `${name}.jsonl`));
  const uses = toolUses(evs);
  const procPath = join(GORI, 'knowledge/procedures', `${name}.md`);
  const fm = readFrontmatter(readFileSync(procPath, 'utf8'));
  const expectedSteps = procedureSteps(fm.bodyLines, fm.bodyLine).steps.length;

  // 記録の場所は一時の gori の .git/gori/repos/<本体の名前>/audit。作業リポジトリの .git/gori/ には書かない。
  const auditDir = join(FAKE_GORI, '.git', 'gori', 'repos', name, 'audit');
  const audits = existsSync(auditDir) ? readdirSync(auditDir).filter((f) => f.endsWith('.tsv')) : [];
  check('作業リポジトリの .git/gori/ に書かない', !existsSync(join(dir, '.git', 'gori')));
  check('gori/repos/<名前>/audit/*.tsv が一つ', audits.length === 1, `${audits.length} 個`);
  let rows = [];
  if (audits.length === 1) {
    const file = join(auditDir, audits[0]);
    const chk = spawnSync(join(GORI, 'tools/records/log'), ['check', file], { cwd: dir, encoding: 'utf8' });
    check('log check が通る', chk.status === 0, (chk.stdout + chk.stderr).trim());
    rows = readFileSync(file, 'utf8').trimEnd().split('\n').slice(1).map((l) => l.split('\t'));
  }
  const start = rows.find((r) => r[2] === 'start');
  check(`start の procedure が procedures/${name}`, start?.[6] === `procedures/${name}`, `実際=${start?.[6]}`);
  const steps = rows.filter((r) => r[2] === 'step').length;
  check(`step 行が ${expectedSteps} 個`, steps === expectedSteps, `実際=${steps}`);
  check('pause 行がある', rows.some((r) => r[2] === 'pause'));
  const reads = uses.filter((u) => u.name === 'Read' && (u.input.file_path ?? '').endsWith(`knowledge/procedures/${name}.md`));
  check('手順書を Read した', reads.length > 0, uses.filter((u) => u.name === 'Read').map((u) => u.input.file_path).join(', '));

  const pass = results.every((r) => r.ok);
  allPass &&= pass;
  const sec = existsSync(join(OUT, `${name}.seconds`)) ? readFileSync(join(OUT, `${name}.seconds`), 'utf8').trim() : '?';
  console.log(`\n=== ${name}（${sec} 秒）`);
  console.log(`依頼: ${existsSync(join(OUT, `${name}.request`)) ? readFileSync(join(OUT, `${name}.request`), "utf8").trim() : "(準備に失敗)"}`);
  console.log(`道具の呼び出し: ${uses.map((u) => (u.name === 'Bash' ? `Bash(${(u.input.command ?? '').slice(0, 60).replace(/\n/g, ' ')})` : u.name === 'Read' ? `Read(${(u.input.file_path ?? '').replace(GORI, '<gori>')})` : u.name === 'Skill' ? `Skill(${u.input.skill})` : u.name)).join(' / ')}`);
  for (const r of rows) console.log(`  ${r[2]}\t${r[3]}\t${r[4]}\t${r[6]}`);
  for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.label}${r.ok ? '' : `: ${r.detail}`}`);
  console.log(pass ? 'PASS' : 'FAIL');
}
console.log(allPass ? '\nALL PASS' : '\nSOME FAILED');
process.exit(allPass ? 0 : 1);
JS
status=$?
echo "出力: $out"
exit $status
