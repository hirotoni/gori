import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { repoRoot } from '../helpers.mjs';
import { LIMITS, TASK, cleanEnv, fakeClaude, fakeGori, git, item, put, records, run, selfRepo, workRepo } from './helpers.mjs';

const STATUS = join(repoRoot, 'tools', 'auto', 'status');
const head = (dir, ref = 'refs/heads/main') => git(dir, 'rev-parse', ref).stdout.trim();
const poolItem = (gori, name, id) => readFileSync(join(gori, '.git', 'gori', 'repos', name, 'pool', `${id}.md`), 'utf8');
const audit = (gori, name) => readFileSync(join(gori, '.git', 'gori', 'repos', name, 'audit', `${TASK}.tsv`), 'utf8').trimEnd().split('\n').slice(1).map((l) => l.split('\t'));
// gori 自身を作業リポジトリにした一時の gori と、そのプールの一件。
function self(kind = 'learning', mode = 'pass-steps') {
  const gori = selfRepo(fakeGori());
  const id = item(gori, 'gori', '20261108-090000-lesson', 'todo', kind);
  return { gori, id, before: head(gori), fake: fakeClaude(mode, { name: 'gori' }) };
}
const status = (gori) => spawnSync(process.execPath, [STATUS], { encoding: 'utf8', env: cleanEnv({ GORI_ROOT: gori }) }).stdout;

test('gori のプールの学びの一件は、合格したら main に fast-forward で取り込み、done を書き、プールの一件を done にし、worktree を片付ける', () => {
  const s = self();
  const r = run(s.gori, s.fake);
  assert.equal(r.status, 0, r.out);
  assert.equal(r.result, 'merged');
  const sha = head(s.gori);
  assert.notEqual(sha, s.before);
  assert.equal(git(s.gori, 'show', `${sha}:work.txt`).stdout, 'work\n');
  assert.equal(git(s.gori, 'rev-list', '--count', '--merges', `${s.before}..${sha}`).stdout.trim(), '0', 'マージの commit を作らない');
  const item = poolItem(s.gori, 'gori', s.id);
  assert.match(item, /\nstatus: done\n/);
  assert.ok(item.includes(sha), 'プールの一件に commit を残す');
  const rows = audit(s.gori, 'gori');
  assert.equal(rows.at(-1)[2], 'done');
  assert.deepEqual(rows.filter((x) => x[2] === 'step-done').map((x) => x[3]), ['1', '2', '3', '4', '5', '6', '7', '8'], '残した手順を済みにする');
  assert.ok(!rows.some((x) => x[2] === 'approval'), '承認の行は書かない');
  assert.equal(existsSync(join(s.gori, '.worktree', 'gori', TASK)), false, 'worktree を片付ける');
  assert.equal(git(s.gori, 'rev-parse', '--verify', '-q', `refs/heads/${TASK}`).status, 1, '作業のブランチも消す');
  const [rec] = records(s.gori);
  assert.deepEqual([rec.outcome, rec.merged, rec.task, rec.left], ['merged', sha, TASK, []]);
  assert.match(rec.reason, /無人で main に取り込んだ/);
  assert.equal(git(s.gori, 'remote').stdout, '', 'push 先は無く、push もしない');
});

test('gori 以外のリポジトリの学びの一件は、取り込まない', () => {
  const gori = fakeGori();
  const repo = workRepo(gori);
  put(join(repo, '.gitignore'), '.worktree/\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'ignore');
  const before = head(repo);
  item(gori, 'app', '20261108-090000-lesson', 'todo', 'learning');
  const r = run(gori, fakeClaude('pass-steps'));
  assert.equal(r.result, 'pass', r.out);
  assert.equal(head(repo), before);
  assert.equal(records(gori)[0].reason, 'レビューに合格した。取り込みを待つ');
});

test('作業者の実行の間に main が進んでいれば取り込まず、失敗として残す', () => {
  const s = self('learning', 'pass-steps-move-main');
  const r = run(s.gori, s.fake);
  assert.equal(r.result, 'failed', r.out);
  const moved = head(s.gori);
  assert.notEqual(moved, s.before);
  assert.equal(git(s.gori, 'merge-base', '--is-ancestor', TASK, 'main').status, 1, '作業のブランチは main に入っていない');
  assert.match(records(s.gori)[0].reason, /main が動いた/);
  assert.equal(records(s.gori)[0].merged, undefined);
  assert.match(poolItem(s.gori, 'gori', s.id), /\nstatus: todo\n/);
  assert.ok(!audit(s.gori, 'gori').some((x) => x[2] === 'done'));
});

test('手順書の手順が最後の二つより前に残っていれば取り込まない', () => {
  const s = self('learning', 'pass-gap');
  const r = run(s.gori, s.fake);
  assert.equal(r.result, 'pass', r.out);
  assert.equal(head(s.gori), s.before);
  assert.match(records(s.gori)[0].reason, /無人では取り込まなかった（手順書の手順が、最後の二つより前に残っている（6、7、8））/);
  assert.match(poolItem(s.gori, 'gori', s.id), /\nstatus: todo\n/);
});

test('watch は学びを無人で取り込んでも終わらず、知らせずに次の一件を見る。status は取り込んだ作業を出さない', async () => {
  const gori = selfRepo(fakeGori({ ...LIMITS, 'watch-minutes': 0.01 }));
  const id = item(gori, 'gori', '20261108-090000-lesson', 'todo', 'learning');
  const before = head(gori);
  const fake = fakeClaude('pass-steps', { name: 'gori' });
  const WATCH = join(repoRoot, 'tools', 'auto', 'watch');
  const w = await new Promise((done) => {
    const child = spawn(process.execPath, [WATCH], { env: cleanEnv({ GORI_ROOT: gori, GORI_CLAUDE_BIN: fake.bin, CLAUDE_CONFIG_DIR: join(gori, '..', 'config') }) });
    let out = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 60_000);
    child.stdout.on('data', (d) => {
      out += d;
      // 取り込みの後に、待たずに次の一回を呼び、進める一件が無いので待つ。そこで止める。
      if (/見回り: 進める一件が無い/.test(out)) child.kill('SIGTERM');
    });
    child.on('close', (status, signal) => {
      clearTimeout(timer);
      done({ status, signal, out });
    });
  });
  assert.equal(w.signal, 'SIGTERM', w.out);
  assert.match(w.out, /見回り: 学びを無人で取り込んだ。続けて次の一件を見る\n[^]*見回り: 進める一件が無い/);
  assert.doesNotMatch(w.out, /^RESULT=/m, '取り込みでは終わらない');
  assert.notEqual(head(gori), before);
  assert.match(poolItem(gori, 'gori', id), /\nstatus: done\n/);
  const now = status(gori);
  assert.doesNotMatch(now, /取り込んだ/);
  assert.match(now, /^無人の作業で、人間の対応が要るものは無い$/m);
});

test('watch は、取り込んだ後の記録に残ったことがあれば、続けずに終わり、残ったことを出す', () => {
  const gori = selfRepo(fakeGori({ ...LIMITS, 'watch-minutes': 0.01 }));
  item(gori, 'gori', '20261108-090000-lesson', 'todo', 'learning');
  const pool = join(gori, '.git', 'gori', 'repos', 'gori', 'pool');
  const fake = fakeClaude('pass-steps-lock-pool', { name: 'gori' });
  const w = spawnSync(process.execPath, [join(repoRoot, 'tools', 'auto', 'watch')], { encoding: 'utf8', timeout: 60_000, env: cleanEnv({ GORI_ROOT: gori, GORI_CLAUDE_BIN: fake.bin, CLAUDE_CONFIG_DIR: join(gori, '..', 'config') }) });
  // 後片付けのために、読み取り専用を戻す。
  chmodSync(pool, 0o755);
  assert.equal(w.status, 0, w.stdout + w.stderr);
  assert.equal(w.stdout.trimEnd().split('\n').at(-1), 'RESULT=merged-left');
  assert.match(w.stdout, /残ったこと: プールの一件を done にできなかった/);
  assert.doesNotMatch(w.stdout, /続けて次の一件を見る/);
  assert.deepEqual(records(gori).at(-1).left, ['プールの一件を done にできなかった']);
});

test('受け入れ条件の行を訂正した作業は取り込まない。手順の行の訂正は取り込みを妨げない', () => {
  const a = self('learning', 'pass-fix-accept');
  const ra = run(a.gori, a.fake);
  assert.equal(ra.result, 'pass', ra.out);
  assert.equal(head(a.gori), a.before);
  assert.match(records(a.gori)[0].reason, /無人では取り込まなかった（受け入れ条件の行に、訂正か取り下げがある）/);
  const st = self('learning', 'pass-fix-step');
  const rs = run(st.gori, st.fake);
  assert.equal(rs.result, 'merged', rs.out);
  assert.notEqual(head(st.gori), st.before);
});
