import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { recordsDir } from '../helpers.mjs';
import { cleanEnv, LOG, ID, approve, workRepo, review, fakeClaude, verdictsIn } from './review-helpers.mjs';

test('作業者が GORI_VERDICT_OUTBOX を立てていても、review は自分の受け取り口だけをレビュアーに渡して読む', () => {
  const r = workRepo();
  const mine = mkdtempSync(join(tmpdir(), 'gori-worker-outbox-'));
  writeFileSync(join(mine, 'x.json'), JSON.stringify({ task: ID, sha: r.head(), judge: 'session:judge-fake', result: 'pass', evidence: ['e'], findings: [] }));
  const f = fakeClaude('silent');
  const res = review(r.dir, [], { GORI_CLAUDE_BIN: f.bin, GORI_VERDICT_OUTBOX: mine });
  assert.equal(res.status, 3, res.out);
  assert.notEqual(f.note().outbox, mine);
  assert.equal(verdictsIn(r.dir, r.head()).length, 0);
});

test('偽のレビュアーが fail を記録すれば 1', () => {
  const r = workRepo();
  const res = review(r.dir, [], { GORI_CLAUDE_BIN: fakeClaude('fail').bin });
  assert.equal(res.status, 1, res.out);
  assert.match(res.out, /不合格/);
});

test('偽のレビュアーがレビュー結果を書かなければ未レビューで 3。worktree は消える', () => {
  const r = workRepo();
  const f = fakeClaude('silent');
  const res = review(r.dir, [], { GORI_CLAUDE_BIN: f.bin });
  assert.equal(res.status, 3, res.out);
  assert.match(res.out, /未レビュー/);
  // 調べるための手がかりは端末に出し、レビュアーの出力はファイルに写さない。
  assert.match(res.out, /レビュアーのセッション: judge-fake/);
  assert.match(res.out, /レビュアーの最後の文: レビュアーの 最後の文/);
  assert.ok(!existsSync(join(recordsDir(r.dir), 'reviews')), 'レビュアーの出力が記録の場所に残っている');
  assert.ok(!existsSync(f.note().cwd));
  assert.equal(r.g('worktree', 'list').stdout.trim().split('\n').length, 1);
});

test('合格でも、レビュアーの出力を記録の場所に残さず、最後の文も出さない', () => {
  const r = workRepo();
  const res = review(r.dir, [], { GORI_CLAUDE_BIN: fakeClaude('pass').bin });
  assert.equal(res.status, 0, res.out);
  assert.match(res.out, /レビュアーのセッション: judge-fake/);
  assert.doesNotMatch(res.out, /レビュアーの最後の文/);
  assert.ok(!existsSync(join(recordsDir(r.dir), 'reviews')));
  assert.equal(verdictsIn(r.dir, r.head()).length, 1);
});

test('以前の pass が同じ sha にあっても、今回のレビュアーが記録しなければ 3', () => {
  const r = workRepo();
  assert.equal(review(r.dir, [], { GORI_CLAUDE_BIN: fakeClaude('pass').bin }).status, 0);
  assert.equal(review(r.dir, [], { GORI_CLAUDE_BIN: fakeClaude('silent').bin }).status, 3);
});

test('レビュアーの起動に失敗しても worktree は残らず、3 で終わる', () => {
  const r = workRepo();
  const res = review(r.dir, [], { GORI_CLAUDE_BIN: '/nonexistent/claude' });
  assert.equal(res.status, 3, res.out);
  assert.equal(r.g('worktree', 'list').stdout.trim().split('\n').length, 1);
});

test('依頼文の受け入れ基準に accept 行が行番号つきで並び、目的と手順は別の見出しに移る', () => {
  const r = workRepo();
  const res = review(r.dir, ['--dry-run']);
  assert.equal(res.status, 0, res.out);
  const accept = /## 受け入れ基準\n([\s\S]*?)\n## /.exec(res.out)[1];
  assert.match(accept, /^- 行 \d+: 引数があれば Hello, <引数> を出す$/m);
  assert.ok(!accept.includes('greet.sh が名前を挨拶する'), '目的が受け入れ基準に残っている');
  const purpose = /## 作業の目的と手順\n([\s\S]*?)\n## /.exec(res.out)[1];
  assert.ok(purpose.includes('greet.sh が名前を挨拶する'));
  assert.match(purpose, /\d+\. /);
});

test('accept 行への fix は訂正として受け入れ基準に並び、ほかの行への fix は並ばない', () => {
  const r = workRepo();
  const ln = Number(/:(\d+)\s*$/.exec(spawnSync(process.execPath, [LOG, 'add', '--task', ID, '--type', 'decision', '--what', '別の判断'], { cwd: r.dir, encoding: 'utf8', env: cleanEnv() }).stdout)[1]);
  const acceptLine = Number(/行 (\d+): 引数/.exec(review(r.dir, ['--dry-run']).out)[1]);
  const fix = (n, t) => spawnSync(process.execPath, [LOG, 'add', '--task', ID, '--type', 'fix', '--what', `行 ${n} を訂正: ${t}`], { cwd: r.dir, encoding: 'utf8', env: cleanEnv() });
  assert.equal(fix(acceptLine, '引数が空なら world').status, 0);
  assert.equal(fix(ln, '別の判断の訂正').status, 0);
  approve(r.dir);
  const accept = /## 受け入れ基準\n([\s\S]*?)\n## /.exec(review(r.dir, ['--dry-run']).out)[1];
  assert.ok(accept.includes(`行 ${acceptLine} を訂正: 引数が空なら world`), accept);
  assert.ok(!accept.includes('別の判断の訂正'), accept);
});

test('取り下げた accept 行は受け入れ基準に並ばず、取り下げた条件の節に理由とともに出る', () => {
  const r = workRepo();
  const plain = review(r.dir, ['--dry-run']).out;
  assert.ok(!plain.includes('取り下げた条件'), '取り下げの無い作業に節が出ている');
  const oldLine = Number(/行 (\d+): 引数/.exec(plain)[1]);
  const add = (type, what) => spawnSync(process.execPath, [LOG, 'add', '--task', ID, '--type', type, '--what', what], { cwd: r.dir, encoding: 'utf8', env: cleanEnv() });
  assert.equal(add('fix', `行 ${oldLine} を訂正: 引数があれば Hey を出す`).status, 0);
  assert.equal(add('fix', `行 ${oldLine} を取り下げ: 挨拶の文言を設定から読む方針に変えた`).status, 0);
  assert.equal(add('accept', '設定の greeting の文言で挨拶する').status, 0);
  approve(r.dir);
  const out = review(r.dir, ['--dry-run']).out;
  const accept = /## 受け入れ基準\n([\s\S]*?)\n## /.exec(out)[1];
  assert.ok(accept.includes('設定の greeting の文言で挨拶する'), accept);
  assert.ok(!accept.includes('引数があれば'), accept);
  assert.ok(!accept.includes('訂正'), accept);
  const withdrawn = /## 取り下げた条件（基準ではない）\n([\s\S]*?)\n## /.exec(out)[1];
  assert.match(withdrawn, new RegExp(`^- 行 ${oldLine}: 引数があれば Hello, <引数> を出す$`, 'm'));
  assert.match(withdrawn, /取り下げ（行 \d+）: 行 \d+ を取り下げ: 挨拶の文言を設定から読む方針に変えた/);
  assert.match(withdrawn, /受け入れ基準を優先する/);
});

test('取り下げより後に承認が無いか、受け入れ条件がすべて取り下げられていれば、レビュアーを起動せず止まる', () => {
  const r = workRepo();
  const line = Number(/行 (\d+): 引数/.exec(review(r.dir, ['--dry-run']).out)[1]);
  const add = (type, what) => spawnSync(process.execPath, [LOG, 'add', '--task', ID, '--type', type, '--what', what], { cwd: r.dir, encoding: 'utf8', env: cleanEnv() });
  assert.equal(add('accept', '引数が無ければ Hello, world を出す').status, 0);
  approve(r.dir);
  assert.equal(add('fix', `行 ${line} を取り下げ: 要らなくなった`).status, 0);
  const before = review(r.dir, ['--dry-run']);
  assert.notEqual(before.status, 0);
  assert.match(before.out, /訂正か取り下げ）より後に承認の行が無い/);
  approve(r.dir);
  assert.equal(review(r.dir, ['--dry-run']).status, 0);

  const all = workRepo();
  const only = Number(/行 (\d+): 引数/.exec(review(all.dir, ['--dry-run']).out)[1]);
  assert.equal(spawnSync(process.execPath, [LOG, 'add', '--task', ID, '--type', 'fix', '--what', `行 ${only} を取り下げ: 要らなくなった`], { cwd: all.dir, encoding: 'utf8', env: cleanEnv() }).status, 0);
  approve(all.dir);
  const none = review(all.dir, ['--dry-run']);
  assert.notEqual(none.status, 0);
  assert.match(none.out, /すべて取り下げられている/);
});
