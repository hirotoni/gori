import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { test } from 'node:test';
import { recordsDir } from '../helpers.mjs';
import { cleanEnv, REVIEW, VERDICT, ID, attest, workRepo, review, fakeClaude, verdictsIn, auditRows } from './review-helpers.mjs';

const SIX = ['## 目的', '## 範囲', '## 受け入れ基準', '## 検証方法', '## 禁止事項', '## 報告の形式'];

test('--dry-run の依頼文に六項目と、目的、範囲、受け入れ基準の中身が入る', () => {
  const r = workRepo();
  const res = review(r.dir, ['--dry-run']);
  assert.equal(res.status, 0, res.out);
  for (const h of SIX) assert.ok(res.out.includes(h), h);
  assert.ok(res.out.includes(r.head()));
  assert.ok(res.out.includes(`git diff ${r.g('rev-parse', 'HEAD~1').stdout.trim()}..${r.head()}`), res.out);
  assert.ok(res.out.includes('greet.sh が名前を挨拶する'));
  assert.match(res.out, /\d+\. /);
  assert.ok(res.out.includes('verdict record'));
  assert.ok(res.out.includes('--agent'));
  assert.ok(res.out.includes('"opus"'));
  assert.equal(r.g('worktree', 'list').stdout.trim().split('\n').length, 1);
});

test('範囲の起点は start 行より前の最後の commit。--base で上書きできる', () => {
  const r = workRepo();
  const init = r.g('rev-list', '--max-parents=0', 'HEAD').stdout.trim();
  const res = review(r.dir, ['--dry-run', '--base', init]);
  assert.ok(res.out.includes(`git diff ${init}..${r.head()}`), res.out);
  assert.ok(res.out.includes('--base の指定'));
});

test('--model が無ければ models.md の reviewer の行から読む。--model で上書きできる', () => {
  const r = workRepo();
  assert.ok(review(r.dir, ['--dry-run']).out.includes('"--model" "opus"'));
  assert.ok(review(r.dir, ['--dry-run', '--model', 'haiku']).out.includes('"--model" "haiku"'));
});

test('cwd が本体のチェックアウトでも、作業 ID のブランチの worktree があれば、その HEAD をレビューの対象にする', () => {
  const r = workRepo();
  const wt = join(mkdtempSync(join(tmpdir(), 'gori-review-wt-')), 'wt');
  r.g('worktree', 'add', '-q', '-b', ID, wt);
  spawnSync('git', ['-C', wt, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'work'], { env: cleanEnv() });
  const wtHead = spawnSync('git', ['-C', wt, 'rev-parse', 'HEAD'], { encoding: 'utf8', env: cleanEnv() }).stdout.trim();
  const res = review(r.dir, ['--dry-run']);
  assert.equal(res.status, 0, res.out);
  assert.ok(res.out.includes(`..${wtHead}`), res.out);
});

test('作業 ID の形でなければ 2 で、新しい形を主に、古い形も受け付けると案内する', () => {
  const r = workRepo();
  const res = spawnSync(process.execPath, [REVIEW, '--task', 'Bad_ID', '--dry-run'], { cwd: r.dir, encoding: 'utf8', env: cleanEnv() });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /<YYYYMMDD>-<hhmmss>-<slug>.*古い形 <YYYY-MM-DD>-<slug>/);
});

test('判断の記録が無い作業はレビューを依頼できない', () => {
  const r = workRepo();
  const res = spawnSync(process.execPath, [REVIEW, '--task', '2026-11-03-none', '--dry-run'], { cwd: r.dir, encoding: 'utf8', env: cleanEnv() });
  assert.equal(res.status, 2);
});

test('偽のレビュアーが pass を記録すれば 0。worktree と受け取り口は消え、レビュー結果は review の取り込みで元のリポジトリの記録（gori のチェックアウトの .git/gori/repos/<名前>/）に入る', () => {
  const r = workRepo();
  const f = fakeClaude('pass');
  const res = review(r.dir, [], { GORI_CLAUDE_BIN: f.bin, CLAUDE_CODE_SESSION_ID: 'worker-1' });
  assert.equal(res.status, 0, res.out);
  assert.match(res.out, /レビュー結果を取り込んだ/);
  const n = f.note();
  assert.notEqual(n.cwd, r.dir);
  assert.ok(!existsSync(n.cwd), 'worktree が残っている');
  assert.ok(n.outboxExists);
  assert.ok(!existsSync(n.outbox), '受け取り口が残っている');
  assert.ok(!`${realpathSync(dirname(n.outbox))}/`.startsWith(`${realpathSync(r.dir)}/`), '受け取り口が作業リポジトリの中にある');
  assert.equal(r.g('worktree', 'list').stdout.trim().split('\n').length, 1);
  assert.equal(realpathSync(n.workRepo), realpathSync(r.dir));
  assert.equal(n.parentSession, null);
  assert.ok(n.args.includes('gori:reviewer'));
  assert.equal(r.g('status', '--porcelain').stdout.trim(), '');
  const files = verdictsIn(r.dir, r.head());
  assert.equal(files.length, 1);
  assert.equal(JSON.parse(readFileSync(join(recordsDir(r.dir), 'verdicts', r.head(), files[0]), 'utf8')).judge, 'session:judge-fake');
  const last = auditRows(r.dir).at(-1);
  assert.deepEqual([last[1], last[2], last[4], last[5]], ['judge-fake', 'decision', 'レビュー結果 pass', 'レビュアー session:judge-fake 重さ normal']);
  assert.ok(last[6].includes(`/.git/gori/repos/${basename(r.dir)}/verdicts/`));
});

const rejected = [
  ['judge がレビュアーの init の session_id と違う', { record: 'someone-else' }, /init の session_id/],
  ['init 行が無く judge を照合できない', { init: null, record: 'judge-fake' }, /init の session_id が出力に無く/],
  ['task が依頼と違う', { raw: { task: '2026-11-03-other' } }, /task が/],
  ['sha が依頼と違う', { raw: { sha: '0'.repeat(40) } }, /sha が/],
  ['judge が作業者のセッション', { init: 'worker-1', raw: {} }, /self-judgment/],
  ['judge が session:<ID> でない', { raw: { judge: 'human:tester' } }, /session:<ID> でない/],
  ['fail に suggestions が付く', { raw: { result: 'fail', findings: ['f'], suggestions: ['s'] } }, /suggestions は pass/],
];
for (const [name, opts, why] of rejected) {
  test(`受け取り口のレビュー結果を取り込まず 3 で終わる: ${name}`, () => {
    const r = workRepo();
    attest(r.dir);
    const before = readFileSync(join(recordsDir(r.dir), 'audit', `${ID}.tsv`), 'utf8');
    const res = review(r.dir, [], { GORI_CLAUDE_BIN: fakeClaude('pass', opts).bin });
    assert.equal(res.status, 3, res.out);
    assert.match(res.out, /取り込まないレビュー結果/);
    assert.match(res.out, why);
    assert.match(res.out, /未レビュー/);
    assert.equal(verdictsIn(r.dir, r.head()).length, 0);
    assert.equal(readFileSync(join(recordsDir(r.dir), 'audit', `${ID}.tsv`), 'utf8'), before);
    const c = spawnSync(process.execPath, [VERDICT, 'check', '--task', ID], { cwd: r.dir, encoding: 'utf8', env: cleanEnv() });
    assert.equal(c.status, 3, c.stdout);
  });
}
