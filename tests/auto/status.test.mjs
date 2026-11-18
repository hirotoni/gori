import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { repoRoot } from '../helpers.mjs';
import { LOG, TASK, cleanEnv, fakeClaude, item, put, run, setup, tmp } from './helpers.mjs';

const STATUS = join(repoRoot, 'tools', 'auto', 'status');
const NONE = '無人の作業で、人間の対応が要るものは無い\n';
// PATH の先頭に置く claude。呼ばれたら印のファイルを残す。status が claude を起動しないことを確かめる。
function trap() {
  const dir = tmp('gori-status-trap-');
  const mark = join(dir, 'called');
  writeFileSync(join(dir, 'claude'), `#!/bin/sh\ntouch ${JSON.stringify(mark)}\n`);
  chmodSync(join(dir, 'claude'), 0o755);
  return { dir, called: () => existsSync(mark) };
}
function status(gori, env = {}) {
  const r = spawnSync(process.execPath, [STATUS], { encoding: 'utf8', env: cleanEnv({ GORI_ROOT: gori, ...env }) });
  return { status: r.status, out: r.stdout, err: r.stderr };
}
const log = (s, ...a) => {
  const r = spawnSync(process.execPath, [LOG, ...a], { cwd: s.repo, encoding: 'utf8', env: cleanEnv({ GORI_ROOT: s.gori, CLAUDE_CODE_SESSION_ID: 'worker-1' }) });
  assert.equal(r.status, 0, r.stderr);
};
const runFile = (gori, name) => join(gori, '.git', 'gori', 'auto', 'runs', name);

test('実行の記録が無ければ、無いことを一行で出す。claude は起動しない', () => {
  const s = setup('idle');
  const t = trap();
  const r = status(s.gori, { PATH: `${t.dir}:${process.env.PATH}` });
  assert.equal(r.status, 0, r.err);
  assert.equal(r.out, NONE);
  assert.equal(t.called(), false);
});

test('レビューに合格した作業を取り込み待ちとして出し、done になったら出さない。claude は起動しない', () => {
  const s = setup('pass');
  assert.equal(run(s.gori, s.fake).result, 'pass');
  const t = trap();
  const r = status(s.gori, { PATH: `${t.dir}:${process.env.PATH}` });
  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /^取り込み待ち: 1 件/);
  assert.ok(r.out.includes(`  app/${s.id} 作業 ${TASK}（${s.repo}）`), r.out);
  assert.doesNotMatch(r.out, /止まった作業|直近の失敗/);
  assert.equal(t.called(), false);
  log(s, 'add', '--task', TASK, '--type', 'done', '--what', '取り込んだ');
  assert.equal(status(s.gori).out, NONE);
});

test('合格せずに終わった作業を、人間を待って止まった作業として出す。pause の行があれば、その理由を出す', () => {
  const s = setup('stop');
  assert.equal(run(s.gori, s.fake).result, 'stopped');
  const before = status(s.gori);
  assert.match(before.out, /^人間を待って止まった作業: 1 件/);
  assert.match(before.out, new RegExp(`app/${s.id} 作業 ${TASK}（.+）: レビューに合格せずに終わった`));
  assert.doesNotMatch(before.out, /取り込み待ち|直近の失敗/);
  log(s, 'add', '--task', TASK, '--type', 'pause', '--what', '受け入れ条件を直す必要が出た', '--why', '条件が曖昧', '--evidence', '次の一手: 人間に確かめる');
  assert.match(status(s.gori).out, /: 受け入れ条件を直す必要が出た\n/);
  log(s, 'add', '--task', TASK, '--type', 'done', '--what', '終えた');
  assert.equal(status(s.gori).out, NONE);
});

test('最新の実行が失敗なら直近の失敗として出し、その後の実行が失敗でなければ出さない', () => {
  const s = setup('exit3');
  assert.equal(run(s.gori, s.fake).result, 'failed');
  const r = status(s.gori);
  assert.match(r.out, new RegExp(`^直近の失敗: \\d{4}-\\d\\d-\\d\\d \\d\\d:\\d\\d app/${s.id}: claude が終了コード 3 で終わった（記録: .+\\.json）\n$`));
  // 作業が始まっていないので、同じ一件がもう一度選ばれる。
  assert.equal(run(s.gori, fakeClaude('pass')).result, 'pass');
  const after = status(s.gori).out;
  assert.match(after, /^取り込み待ち: 1 件/);
  assert.doesNotMatch(after, /直近の失敗/);
});

test('アカウントの確認で起動しなかった失敗も、直近の失敗として出す', () => {
  const s = setup('idle');
  assert.equal(run(s.gori, fakeClaude('idle', { auth: { loggedIn: false } })).result, 'failed');
  assert.match(status(s.gori).out, /^直近の失敗: .+: 起動しなかった: ログインが claude\.ai のサブスクリプションでない/);
});

test('結果を書く前に切れた実行は、run が動いていなければ失敗として出し、動いていれば出さない', () => {
  const s = setup('idle');
  put(runFile(s.gori, '20261113-100000-1.json'), JSON.stringify({ started: '2026-11-13T10:00:00+09:00', pool: `app/${s.id}`, repo: s.repo, outcome: 'running' }));
  assert.match(status(s.gori).out, /^直近の失敗: .+: 結果を書く前に実行が切れた/);
  put(join(s.gori, '.git', 'gori', 'auto', 'run.lock'), `${process.pid}\n`);
  assert.equal(status(s.gori).out, NONE);
});

test('結果を書く前に切れた実行が作業を始めていれば、その作業を止まった作業として出す', () => {
  const s = setup('idle');
  log(s, 'start', '--task', TASK, '--what', '目的');
  log(s, 'add', '--task', TASK, '--type', 'accept', '--what', `pool:${s.id}`);
  put(runFile(s.gori, '20261113-100000-1.json'), JSON.stringify({ started: '2026-11-13T10:00:00+09:00', pool: `app/${s.id}`, repo: s.repo, outcome: 'running' }));
  const out = status(s.gori).out;
  assert.match(out, new RegExp(`^人間を待って止まった作業: 1 件\n  app/${s.id} 作業 ${TASK}（.+）: 結果を書く前に実行が切れた`));
});

test('読めない実行の記録があっても、読めた記録から出す', () => {
  const s = setup('pass');
  assert.equal(run(s.gori, s.fake).result, 'pass');
  put(runFile(s.gori, '20991231-000000-1.json'), '{broken');
  item(s.gori, 'app', '20261109-090000-other');
  const r = status(s.gori);
  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /^取り込み待ち: 1 件/);
});

test('レビュアーのセッションの環境（GORI_WORK_REPO）で呼ばれても、記録にある作業の場所でレビュー結果を確かめる', () => {
  const s = setup('pass');
  assert.equal(run(s.gori, s.fake).result, 'pass');
  // cleanEnv は GORI_ で始まる変数を消すので、後から足す。
  const r = spawnSync(process.execPath, [STATUS], { encoding: 'utf8', env: { ...cleanEnv({ GORI_ROOT: s.gori }), GORI_WORK_REPO: repoRoot, GORI_VERDICT_OUTBOX: tmp('gori-status-outbox-') } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^取り込み待ち: 1 件/);
});

test('受け入れ条件の行を書く前に pause で止まった作業を、pause の理由とともに止まった作業として出す', () => {
  const s = setup('pause-early');
  assert.equal(run(s.gori, s.fake).result, 'stopped');
  const r = status(s.gori);
  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /^人間を待って止まった作業: 1 件/);
  const [rec] = JSON.parse(`[${readdirSync(join(s.gori, '.git', 'gori', 'auto', 'runs')).map((f) => readFileSync(join(s.gori, '.git', 'gori', 'auto', 'runs', f), 'utf8')).join(',')}]`);
  assert.ok(r.out.includes(`  app/${s.id} 作業 ${rec.task}（${s.repo}）: 適用せずに返すと決めた\n`), r.out);
});

test('heldIds は渡した実行の記録だけを見て、ディスクを読み直さない。sessionTask は since より前の作業 ID の記録を読まない', async () => {
  const { heldIds, sessionTask } = await import(join(repoRoot, 'tools', 'lib', 'auto-status.mjs'));
  const s = setup('pause-early');
  assert.equal(run(s.gori, s.fake).result, 'stopped');
  const runs = join(s.gori, '.git', 'gori', 'auto', 'runs');
  const rec = JSON.parse(readFileSync(join(runs, readdirSync(runs)[0]), 'utf8'));
  assert.deepEqual([...heldIds(s.gori, 'app')], [s.id]);
  assert.deepEqual([...heldIds(s.gori, 'app', [])], [], '渡した実行の記録が空なら、ディスクにある記録を読まない');
  const audit = join(s.gori, '.git', 'gori', 'repos', 'app', 'audit');
  // 同じセッションが、実行より前の作業 ID で始めた記録を置く。
  put(join(audit, '20200101-000000-older.tsv'), readFileSync(join(audit, `${rec.task}.tsv`), 'utf8'));
  assert.equal(sessionTask(audit, 'worker-1'), rec.task);
  assert.equal(sessionTask(audit, 'worker-1', rec.task.slice(0, 15)), rec.task);
  assert.equal(sessionTask(audit, 'worker-1', '29991231-235959'), null, 'since より後に始めた作業が無ければ null');
  // since より前の記録だけに当たるセッションは見つからない（古い記録を読まない）。
  rmSync(join(audit, `${rec.task}.tsv`));
  assert.equal(sessionTask(audit, 'worker-1'), '20200101-000000-older');
  assert.equal(sessionTask(audit, 'worker-1', '20201231-000000'), null);
});
