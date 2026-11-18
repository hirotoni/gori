#!/usr/bin/env bash
# モデルを呼ぶので tests/run.sh には入れない。手動で実行する。
# tools/auto/run が、一時のリポジトリの todo の一件を無人で進め、レビューに合格したところで止まり、main を動かさないことを確かめる。
# 作業者とレビュアーを本物の claude で一回ずつ起動する。上限は knowledge/config/auto.md の値をそのまま使う。
set -u
gori="$(cd "$(dirname "$0")/../.." && pwd)"
out="${E2E_OUT:-$(mktemp -d "${TMPDIR:-/tmp}/gori-e2e.XXXXXX")}"
work="$out/app"
mkdir -p "$work"
cd "$work" || exit 1

git init -q -b main
git config user.name e2e
git config user.email e2e@example.invalid
printf '# app\n' > README.md
git add README.md
git commit -q -m "初期の状態"

# shellcheck source=lib/no-wrapper-hooks.sh
. "$gori/tests/e2e/lib/no-wrapper-hooks.sh"
# shellcheck source=../lib/fake-gori.sh
. "$gori/tests/lib/fake-gori.sh"
use_fake_gori "$out/gori" || exit 1
# run は、上限とモデルの表を記録の gori から読む。レビューする commit の表を写す。
mkdir -p "$GORI_ROOT/knowledge/config"
cp "$gori/knowledge/config/auto.md" "$gori/knowledge/config/models.md" "$GORI_ROOT/knowledge/config/"

id=20261114-090000-hello-file
pool="$(gori_records "$GORI_ROOT" app)/pool"
mkdir -p "$pool"
printf 'path: %s\n' "$(pwd -P)" > "$(gori_records "$GORI_ROOT" app)/repo.yml"
cat > "$pool/$id.md" <<ITEM
---
id: $id
title: hello.txt を足す
kind: learning
status: todo
created: 2026-11-14T09:00:00+09:00
updated: 2026-11-14T09:00:00+09:00
---
## 現状
リポジトリの最上位に hello.txt が無い。
## 問題
挨拶のファイルが無い。
## 期待する結果
リポジトリの最上位に hello.txt がある。
## 確認したこと
ls で hello.txt が無いことを確かめた。
## 受け入れ条件
- リポジトリの最上位に hello.txt があり、中身が hello の一行だけである
ITEM

main_before=$(git rev-parse refs/heads/main)
"$gori/tools/auto/run" > "$out/run.out" 2> "$out/run.err"
code=$?

GORI="$gori" FAKE_GORI="$GORI_ROOT" WORK="$(pwd -P)" ID="$id" OUT="$out" CODE="$code" MAIN_BEFORE="$main_before" node --input-type=module <<'JS'
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const { GORI, FAKE_GORI, WORK, ID, OUT, CODE, MAIN_BEFORE } = process.env;
const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok, detail });
const git = (...a) => spawnSync('git', ['-C', WORK, ...a], { encoding: 'utf8' }).stdout.trim();
const runOut = readFileSync(join(OUT, 'run.out'), 'utf8');

check('run が 0 で終わる', CODE === '0', `終了コード ${CODE}`);
check('最後の行が RESULT=pass', /^RESULT=pass$/m.test(runOut), runOut.trim().split('\n').at(-1));

const runs = join(FAKE_GORI, '.git', 'gori', 'auto', 'runs');
const recs = existsSync(runs) ? readdirSync(runs).map((f) => JSON.parse(readFileSync(join(runs, f), 'utf8'))) : [];
const rec = recs[0] ?? {};
check('実行の記録が一件あり、合格で、金額と時間を持つ', recs.length === 1 && rec.outcome === 'pass' && typeof rec.cost_usd === 'number' && typeof rec.seconds === 'number', JSON.stringify(rec));
check('実行の記録が選んだ一件を指す', rec.pool === `app/${ID}`, rec.pool);

check('main が動いていない', git('rev-parse', 'refs/heads/main') === MAIN_BEFORE, `${MAIN_BEFORE} -> ${git('rev-parse', 'refs/heads/main')}`);
check('本体のチェックアウトに未 commit の変更が無い', git('status', '--porcelain') === '', git('status', '--porcelain'));
check('プールの一件は todo のまま', /\nstatus: todo\n/.test(readFileSync(join(FAKE_GORI, '.git', 'gori', 'repos', 'app', 'pool', `${ID}.md`), 'utf8')));

const task = rec.task;
const audit = task ? join(FAKE_GORI, '.git', 'gori', 'repos', 'app', 'audit', `${task}.tsv`) : null;
const rows = audit && existsSync(audit) ? readFileSync(audit, 'utf8').trimEnd().split('\n').slice(1).map((l) => l.split('\t')) : [];
check('作業の判断の記録があり、受け入れ条件の行は pool:<ID> の一行だけ', rows.filter((r) => r[2] === 'accept').length === 1 && rows.some((r) => r[2] === 'accept' && r[4] === `pool:${ID}`), rows.filter((r) => r[2] === 'accept').map((r) => r[4]).join(' / '));
check('承認の行と done の行が無い', !rows.some((r) => r[2] === 'approval' || r[2] === 'done'), rows.map((r) => r[2]).join(','));

const head = task ? git('rev-parse', '--verify', '-q', `refs/heads/${task}`) : '';
check('作業のブランチがあり、main より先にある', !!head && head !== MAIN_BEFORE && git('merge-base', MAIN_BEFORE, head) === MAIN_BEFORE, head);
check('作業のブランチの hello.txt の中身が hello の一行', spawnSync('git', ['-C', WORK, 'show', `${head}:hello.txt`], { encoding: 'utf8' }).stdout === 'hello\n');
const vc = task ? spawnSync(join(GORI, 'tools', 'records', 'verdict'), ['check', '--task', task], { cwd: WORK, encoding: 'utf8' }) : { status: null, stdout: '' };
check('verdict check が 0（別のセッションのレビュアーが合格とした）', vc.status === 0, `${vc.status}: ${vc.stdout}${vc.stderr ?? ''}`);

console.log('--- run の出力');
console.log(runOut);
console.log(readFileSync(join(OUT, 'run.err'), 'utf8'));
console.log('--- 実行の記録');
console.log(JSON.stringify(rec, null, 2));
if (rows.length) {
  console.log('--- 判断の記録');
  console.log(readFileSync(audit, 'utf8'));
}
for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.ok || !r.detail ? '' : `: ${r.detail}`}`);
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `FAILED: ${failed.length} 件` : 'all passed');
process.exit(failed.length ? 1 : 0);
JS
