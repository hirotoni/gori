import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { repoRoot } from '../helpers.mjs';

const TOOL = join(repoRoot, 'tools', 'learning', 'procedure-material');
const cleanEnv = (extra = {}) => ({
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_') && !k.startsWith('CLAUDE') && !k.startsWith('GORI_'))),
  ...extra,
});

// gori の偽チェックアウト。実際の gori の .git を読まないよう、GORI_ROOT でここを指す。
function fakeGori() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'gori-procmat-')));
  spawnSync('git', ['-C', dir, 'init', '-q'], { env: cleanEnv() });
  mkdirSync(join(dir, '.claude-plugin'));
  writeFileSync(join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'gori' }));
  return dir;
}
const HEAD = 'time\tsession\ttype\tstep\twhat\twhy\tevidence\tresult';
const row = (type, step, what, why = '-', evidence = '-') => ['2026-01-05T10:15:00+09:00', 's1', type, step, what, why, evidence, '-'].join('\t');
function audit(gori, repo, task, rows) {
  const dir = join(gori, '.git', 'gori', 'repos', repo, 'audit');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${task}.tsv`), `${[HEAD, ...rows].join('\n')}\n`);
}
const run = (gori, args = []) => {
  const r = spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8', env: cleanEnv({ GORI_ROOT: gori }) });
  return { status: r.status, lines: r.stdout.trim() ? r.stdout.trim().split('\n').map((l) => JSON.parse(l)) : [], out: `${r.stdout}${r.stderr}` };
};

test('stdin で始めた作業は手順の本文を付けて出し、step-skip のある作業は飛ばした手順の本文と理由を付けて出す', () => {
  const gori = fakeGori();
  audit(gori, 'app', '20260105-101500-merge-main', [row('start', '-', '取り込む', '-', 'stdin'), row('step', '1', 'main を取り込む。'), row('step', '2', '衝突を直す。'), row('step-done', '1', 'main を取り込む。')]);
  audit(gori, 'web', '2026-01-10-fix', [row('start', '-', '直す', '-', 'procedures/feature'), row('step', '1', 'PR を作る。'), row('step-skip', '1', 'PR を作る。', 'gh が無い')]);
  audit(gori, 'web', '2026-01-11-plain', [row('start', '-', 'ふつうの作業', '-', 'procedures/feature'), row('step', '1', '直す。'), row('step-done', '1', '直す。')]);
  const r = run(gori);
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(r.lines, [
    { repo: 'app', task: '20260105-101500-merge-main', time: '2026-01-05T10:15:00+09:00', what: '取り込む', procedure: 'stdin', steps: ['main を取り込む。', '衝突を直す。'], skips: [] },
    { repo: 'web', task: '2026-01-10-fix', time: '2026-01-05T10:15:00+09:00', what: '直す', procedure: 'procedures/feature', skips: [{ step: '1', text: 'PR を作る。', why: 'gh が無い' }] },
  ]);
});

test('記録が一つも無ければ何も出さず 0、引数があれば 2、gori のチェックアウトでなければ 2', () => {
  const gori = fakeGori();
  const r = run(gori);
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(r.lines, []);
  assert.equal(run(gori, ['--all']).status, 2);
  assert.equal(run(realpathSync(mkdtempSync(join(tmpdir(), 'gori-procmat-not-')))).status, 2);
});
