#!/usr/bin/env bash
# モデルを呼ぶので tests/run.sh には入れない。手動で実行する。
# tools/auto/run が、gori のプールの学びの一件を無人で進め、レビューに合格した成果を手元の main に取り込むことを確かめる。
# 作業リポジトリは、この gori の今の commit を写した一時の gori である。作業者とレビュアーを本物の claude で起動する。上限は knowledge/config/auto.md の値をそのまま使う。
set -u
gori="$(cd "$(dirname "$0")/../.." && pwd)"
out="${E2E_OUT:-$(mktemp -d "${TMPDIR:-/tmp}/gori-e2e.XXXXXX")}"
mkdir -p "$out"

# shellcheck source=lib/no-wrapper-hooks.sh
. "$gori/tests/e2e/lib/no-wrapper-hooks.sh"
# shellcheck source=../lib/fake-gori.sh
. "$gori/tests/lib/fake-gori.sh"

# 記録の置き場所の名前はディレクトリの名前から決まるので、gori にする。
env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE git clone -q --no-hardlinks "$gori" "$out/gori" || exit 1
cd "$out/gori" || exit 1
git checkout -q -B main
git remote remove origin
git config user.name e2e
git config user.email e2e@example.invalid
GORI_ROOT="$(pwd -P)"
export GORI_ROOT
mkdir -p "$out/gori.home"
export GORI_HOME="$(cd "$out/gori.home" && pwd -P)"
GORI_EXTRACT_RUN="$(type -P true)"
export GORI_EXTRACT_RUN

id=20261114-090000-background-left
pattern=e2e-background-left
case_id=2026-11-13-e2e-background-left
records="$(gori_records "$GORI_ROOT" gori)"
mkdir -p "$records/pool" "$GORI_ROOT/.git/gori/learning/cases"
printf 'path: %s\n' "$GORI_ROOT" > "$records/repo.yml"
cat > "$GORI_ROOT/.git/gori/learning/cases/${case_id}.md" <<CASE
---
id: ${case_id}
type: correction
pattern: ${pattern}
session: 00000000-0000-4000-8000-000000000001
message: 00000000-0000-4000-8000-000000000002
quote: "サーバーが動いたままだった"
---

作業を中断したとき、バックグラウンドで起動した開発サーバーを止めずに終え、次のセッションがポートの衝突で止まった。rule: 中断の前に、自分が起動したバックグラウンドの命令を止める。
CASE
cat > "$records/pool/$id.md" <<ITEM
---
id: ${id}
title: "中断の前に、自分が起動したバックグラウンドの命令を止める"
kind: learning
status: todo
created: 2026-11-14T09:00:00+09:00
updated: 2026-11-14T09:00:00+09:00
pattern: ${pattern}
cases: [${case_id}]
---
## 現状
作業を中断するとき、バックグラウンドで起動した命令を止めずに終えた事例が 1 件ある。
事例: ${case_id}。
中断の能力（knowledge/skills/pause/SKILL.md）は、変更の commit か退避だけを求め、バックグラウンドの命令に触れていない。

## 問題
次のセッションが、残った命令とポートやファイルを取り合って止まる。

## 期待する結果
中断の前に、自分が起動したバックグラウンドの命令が止められる。

## 確認したこと
knowledge/skills/pause/SKILL.md を読み、バックグラウンドの命令についての文が無いことを確かめた。
止めるかどうかは場面ごとの判断が要るので、文章で定着させる。

## 受け入れ条件
- knowledge/skills/pause/SKILL.md の本文に、中断の前に自分が起動したバックグラウンドの命令を止めることを指示する文がある。
- 同じファイルの provenance に、この学びの来歴（pattern の ${pattern} か、事例の ${case_id}）が書かれている。
ITEM

main_before=$(git rev-parse refs/heads/main)
"$gori/tools/auto/run" > "$out/run.out" 2> "$out/run.err"
code=$?
"$gori/tools/auto/status" > "$out/status.out" 2>&1

GORI="$gori" WORK="$GORI_ROOT" ID="$id" OUT="$out" CODE="$code" MAIN_BEFORE="$main_before" PATTERN="${pattern}" CASE_ID="${case_id}" node --input-type=module <<'JS'
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const { WORK, ID, OUT, CODE, MAIN_BEFORE, PATTERN, CASE_ID } = process.env;
const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok, detail });
const gitR = (...a) => spawnSync('git', ['-C', WORK, ...a], { encoding: 'utf8' });
const git = (...a) => gitR(...a).stdout.trim();
const runOut = readFileSync(join(OUT, 'run.out'), 'utf8');
const statusOut = readFileSync(join(OUT, 'status.out'), 'utf8');

check('run が 0 で終わる', CODE === '0', `終了コード ${CODE}`);
check('最後の行が RESULT=merged', /^RESULT=merged$/m.test(runOut), runOut.trim().split('\n').at(-1));

const runs = join(WORK, '.git', 'gori', 'auto', 'runs');
const recs = existsSync(runs) ? readdirSync(runs).map((f) => JSON.parse(readFileSync(join(runs, f), 'utf8'))) : [];
const rec = recs[0] ?? {};
const mainNow = git('rev-parse', 'refs/heads/main');
check('実行の記録が一件あり、取り込みで、金額と時間と commit を持つ', recs.length === 1 && rec.outcome === 'merged' && typeof rec.cost_usd === 'number' && typeof rec.seconds === 'number' && rec.merged === mainNow, JSON.stringify(rec));
check('main が fast-forward で進み、マージの commit が無い', mainNow !== MAIN_BEFORE && gitR('merge-base', '--is-ancestor', MAIN_BEFORE, mainNow).status === 0 && git('rev-list', '--count', '--merges', `${MAIN_BEFORE}..${mainNow}`) === '0', `${MAIN_BEFORE} -> ${mainNow}`);
check('本体のチェックアウトが main にいて、未 commit の変更が無い', git('symbolic-ref', '--short', 'HEAD') === 'main' && git('status', '--porcelain') === '', git('status', '--porcelain'));

const skill = git('show', `${mainNow}:knowledge/skills/pause/SKILL.md`);
check('main の中断の能力に、バックグラウンドの命令を止める文がある', /バックグラウンド/.test(skill.split('\n---\n').slice(1).join('\n---\n')), '');
check('同じファイルの来歴に、この学びが書かれている', skill.includes(PATTERN) || skill.includes(CASE_ID), skill.split('\n').slice(0, 14).join('\n'));
check('変えたファイルは中断の能力だけ（索引などの作り直しを除く）', git('diff', '--name-only', MAIN_BEFORE, mainNow).split('\n').includes('knowledge/skills/pause/SKILL.md'), git('diff', '--name-only', MAIN_BEFORE, mainNow));

const item = readFileSync(join(WORK, '.git', 'gori', 'repos', 'gori', 'pool', `${ID}.md`), 'utf8');
check('プールの一件が done で、main の commit を持つ', /\nstatus: done\n/.test(item) && item.includes(mainNow), item.split('\n').slice(0, 12).join('\n'));

const task = rec.task;
const audit = task ? join(WORK, '.git', 'gori', 'repos', 'gori', 'audit', `${task}.tsv`) : null;
const rows = audit && existsSync(audit) ? readFileSync(audit, 'utf8').trimEnd().split('\n').slice(1).map((l) => l.split('\t')) : [];
check('受け入れ条件の行は pool:<ID> の一行だけ', rows.filter((r) => r[2] === 'accept').length === 1 && rows.some((r) => r[2] === 'accept' && r[4] === `pool:${ID}`), rows.filter((r) => r[2] === 'accept').map((r) => r[4]).join(' / '));
check('承認の行が無く、最後の行が done', !rows.some((r) => r[2] === 'approval') && rows.at(-1)?.[2] === 'done', rows.map((r) => r[2]).join(','));
const vdir = join(WORK, '.git', 'gori', 'repos', 'gori', 'verdicts', mainNow);
const verdicts = existsSync(vdir) ? readdirSync(vdir).map((f) => JSON.parse(readFileSync(join(vdir, f), 'utf8'))) : [];
check('取り込んだ commit に、別のセッションのレビュアーの合格がある', verdicts.some((v) => v.result === 'pass' && v.task === task && v.judge !== `session:${rec.session}`), JSON.stringify(verdicts.map((v) => [v.result, v.judge])));
check('作業の worktree とブランチが片付いている', !!task && !existsSync(join(WORK, '.worktree', 'gori', task)) && gitR('rev-parse', '--verify', '-q', `refs/heads/${task}`).status !== 0, git('worktree', 'list'));
check('リモートが無い（push していない）', git('remote') === '', git('remote'));
check('status が、無人で取り込んだ作業を出さない', !/取り込んだ/.test(statusOut), statusOut);

console.log('--- run の出力');
console.log(runOut);
console.log(readFileSync(join(OUT, 'run.err'), 'utf8'));
console.log('--- status の出力');
console.log(statusOut);
console.log('--- 実行の記録');
console.log(JSON.stringify(rec, null, 2));
console.log('--- 取り込んだ差分');
console.log(git('diff', '--stat', MAIN_BEFORE, mainNow));
if (rows.length) {
  console.log('--- 判断の記録');
  console.log(readFileSync(audit, 'utf8'));
}
for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.ok || !r.detail ? '' : `: ${r.detail}`}`);
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `FAILED: ${failed.length} 件` : 'all passed');
process.exit(failed.length ? 1 : 0);
JS
