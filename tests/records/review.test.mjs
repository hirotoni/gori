import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { recordsDir, testGori } from '../helpers.mjs';
import { cleanEnv, LOG, ID, approve, attest, workRepo, reviewRaw, fakeClaude, auditRows, poolItem } from './review-helpers.mjs';

// 自己点検の行（check 行）。担当が点検せずに出す事例の形を、レビュアーを起動する前に止める。
const checkRow = (cwd, criterion, env = {}) => spawnSync(process.execPath, [LOG, 'add', '--task', ID, '--type', 'check', '--criterion', criterion, '--evidence', 'コマンドを実行した'], { cwd, encoding: 'utf8', env: cleanEnv(env) });
const lines = (out) => [...out.matchAll(/^  - (.+)$/gm)].map((m) => m[1]);
const acceptLine = (dir) => readFileSync(join(recordsDir(dir), 'audit', `${ID}.tsv`), 'utf8').split('\n').findIndex((l) => l.split('\t')[2] === 'accept') + 1;

for (const dry of [true, false]) {
  test(`点検の行が無い記録は、レビュアーを起動せず worktree も作らず 2 で止まり、欠けた指しと書き方を示す（dry-run ${dry}）`, () => {
    const r = workRepo();
    const f = fakeClaude('pass');
    const res = reviewRaw(r.dir, dry ? ['--dry-run'] : [], { GORI_CLAUDE_BIN: f.bin });
    assert.equal(res.status, 2, res.out);
    assert.deepEqual(lines(res.out), [`行 ${acceptLine(r.dir)}`, '承認']);
    assert.match(res.out, /log add --task \S+ --type check --criterion '<指し>' --evidence '<コマンドと出力の要点>'/);
    assert.ok(!existsSync(f.bin.replace(/claude$/, 'note.json')), 'レビュアーが起動した');
    assert.equal(r.g('worktree', 'list').stdout.trim().split('\n').length, 1);
  });
}

test('受け入れ基準の一つだけ点検した記録は、残りの基準を示して止まる。全部点検すれば進む', () => {
  const r = workRepo();
  spawnSync(process.execPath, [LOG, 'add', '--task', ID, '--type', 'accept', '--what', '引数が無ければ Hello, world を出す'], { cwd: r.dir, encoding: 'utf8', env: cleanEnv() });
  approve(r.dir);
  const first = acceptLine(r.dir);
  assert.equal(checkRow(r.dir, `行 ${first}`).status, 0);
  assert.equal(checkRow(r.dir, '承認').status, 0);
  const res = reviewRaw(r.dir, ['--dry-run']);
  assert.equal(res.status, 2, res.out);
  assert.equal(lines(res.out).length, 1);
  assert.match(lines(res.out)[0], /^行 \d+$/);
  assert.notEqual(lines(res.out)[0], `行 ${first}`);
  assert.equal(checkRow(r.dir, lines(res.out)[0]).status, 0);
  assert.equal(reviewRaw(r.dir, ['--dry-run']).status, 0);
});

test('pool:<ID> の accept 行は条件ごとに点検が要り、一部だけでは止まる', () => {
  const r = workRepo({ accept: false });
  const gori = testGori();
  const item = poolItem(gori, r.dir, '- 条件一\n- 条件二\n- 条件三');
  assert.equal(spawnSync(process.execPath, [LOG, 'add', '--task', ID, '--type', 'accept', '--what', `pool:${item.id}`], { cwd: r.dir, encoding: 'utf8', env: cleanEnv() }).status, 0);
  approve(r.dir);
  const n = acceptLine(r.dir);
  const env = { GORI_ROOT: gori };
  assert.equal(checkRow(r.dir, `行 ${n}#1`, env).status, 0);
  assert.equal(checkRow(r.dir, '承認', env).status, 0);
  const res = reviewRaw(r.dir, ['--dry-run'], env);
  assert.equal(res.status, 2, res.out);
  assert.deepEqual(lines(res.out), [`行 ${n}#2`, `行 ${n}#3`]);
  // 行全体の「行 N」では条件ごとの点検にならない。
  assert.equal(checkRow(r.dir, `行 ${n}`, env).status, 0);
  assert.deepEqual(lines(reviewRaw(r.dir, ['--dry-run'], env).out), [`行 ${n}#2`, `行 ${n}#3`]);
  assert.equal(checkRow(r.dir, `行 ${n}#2`, env).status, 0);
  assert.equal(checkRow(r.dir, `行 ${n}#3`, env).status, 0);
  assert.equal(reviewRaw(r.dir, ['--dry-run'], env).status, 0);
});

test('承認の行を点検していない記録は、承認を示して止まる', () => {
  const r = workRepo();
  assert.equal(checkRow(r.dir, `行 ${acceptLine(r.dir)}`).status, 0);
  const res = reviewRaw(r.dir, ['--dry-run']);
  assert.equal(res.status, 2, res.out);
  assert.deepEqual(lines(res.out), ['承認']);
});

test('差分が .md を変えるときは文書の点検が要り、変えないときは要らない', () => {
  const r = workRepo({ files: { 'greet.sh': 'echo hi\n', 'README.md': '# greet\n\n引数は 1 個。\n' } });
  assert.equal(checkRow(r.dir, `行 ${acceptLine(r.dir)}`).status, 0);
  assert.equal(checkRow(r.dir, '承認').status, 0);
  const res = reviewRaw(r.dir, ['--dry-run']);
  assert.equal(res.status, 2, res.out);
  assert.deepEqual(lines(res.out), ['文書']);
  assert.equal(checkRow(r.dir, '文書').status, 0);
  assert.equal(reviewRaw(r.dir, ['--dry-run']).status, 0);
  const plain = workRepo();
  attest(plain.dir);
  assert.ok(!auditRows(plain.dir).some((c) => c[2] === 'check' && c[4] === '文書'));
});

test('点検の後に commit したら、点検し直しを求める（check 行の result は点検した HEAD の SHA）', () => {
  const r = workRepo();
  attest(r.dir);
  const rows = auditRows(r.dir).filter((c) => c[2] === 'check');
  assert.equal(rows.length, 2);
  for (const c of rows) assert.equal(c[7], r.head());
  assert.equal(reviewRaw(r.dir, ['--dry-run']).status, 0);
  r.g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'more');
  const res = reviewRaw(r.dir, ['--dry-run']);
  assert.equal(res.status, 2, res.out);
  assert.deepEqual(lines(res.out), [`行 ${acceptLine(r.dir)}`, '承認']);
});

test('GORI_AUTO の承認（承認の行が無い）では承認の点検は要らず、受け入れ基準の点検だけが要る', () => {
  const r = workRepo({ accept: false });
  const gori = testGori();
  const item = poolItem(gori, r.dir, '- 条件一');
  const env = { GORI_ROOT: gori, GORI_AUTO: '1' };
  assert.equal(spawnSync(process.execPath, [LOG, 'add', '--task', ID, '--type', 'accept', '--what', `pool:${item.id}`], { cwd: r.dir, encoding: 'utf8', env: cleanEnv(env) }).status, 0);
  const n = acceptLine(r.dir);
  const res = reviewRaw(r.dir, ['--dry-run'], env);
  assert.equal(res.status, 2, res.out);
  assert.deepEqual(lines(res.out), [`行 ${n}#1`]);
  // 無人の作業の柵は check 行の記録を拒まない。
  assert.equal(checkRow(r.dir, `行 ${n}#1`, env).status, 0);
  assert.equal(reviewRaw(r.dir, ['--dry-run'], env).status, 0);
});
