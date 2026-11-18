import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { testGori } from '../helpers.mjs';
import { cleanEnv, LOG, ID, approve, workRepo, review, fakeClaude, poolItem } from './review-helpers.mjs';

test('accept 行 pool:<ID> は、レビューのたびにプールの一件の受け入れ条件に展開される', () => {
  const r = workRepo({ accept: false });
  const gori = testGori();
  const item = poolItem(gori, r.dir, '- 引数があれば Hello, <引数> を出す\n- 引数が無ければ Hello, world を出す');
  const add = spawnSync(process.execPath, [LOG, 'add', '--task', ID, '--type', 'accept', '--what', `pool:${item.id}`], { cwd: r.dir, encoding: 'utf8', env: cleanEnv() });
  assert.equal(add.status, 0, add.stderr);
  approve(r.dir);
  const first = /## 受け入れ基準\n([\s\S]*?)\n## /.exec(review(r.dir, ['--dry-run'], { GORI_ROOT: gori }).out)[1];
  assert.match(first, new RegExp(`^- 行 \\d+（${item.id} の受け入れ条件 1）: 引数があれば Hello, <引数> を出す$`, 'm'));
  assert.match(first, new RegExp(`^- 行 \\d+（${item.id} の受け入れ条件 2）: 引数が無ければ Hello, world を出す$`, 'm'));
  // 受け入れ条件を書き直せば、記録を直さなくてもレビュアーは書き直した後の文を読む。
  item.put('- 引数があれば Hi, <引数> を出す');
  const second = /## 受け入れ基準\n([\s\S]*?)\n## /.exec(review(r.dir, ['--dry-run'], { GORI_ROOT: gori }).out)[1];
  assert.match(second, /の受け入れ条件 1）: 引数があれば Hi, <引数> を出す$/m);
  assert.ok(!second.includes('Hello'), second);
});

test('accept 行 pool:<ID> を取り下げると、プールの受け入れ条件は基準に並ばず、書き直した条件だけが基準になる', () => {
  const r = workRepo({ accept: false });
  const gori = testGori();
  const item = poolItem(gori, r.dir, '- 引数があれば Hello, <引数> を出す');
  const add = (type, what) => spawnSync(process.execPath, [LOG, 'add', '--task', ID, '--type', type, '--what', what], { cwd: r.dir, encoding: 'utf8', env: cleanEnv() });
  const ln = Number(/:(\d+)\s*$/.exec(add('accept', `pool:${item.id}`).stdout)[1]);
  assert.equal(add('fix', `行 ${ln} を取り下げ: 方針が変わった`).status, 0);
  assert.equal(add('accept', '引数があれば Hi, <引数> を出す').status, 0);
  approve(r.dir);
  const out = review(r.dir, ['--dry-run'], { GORI_ROOT: gori }).out;
  const accept = /## 受け入れ基準\n([\s\S]*?)\n## /.exec(out)[1];
  assert.ok(accept.includes('引数があれば Hi, <引数> を出す'), accept);
  assert.ok(!accept.includes(item.id), accept);
  const withdrawn = /## 取り下げた条件（基準ではない）\n([\s\S]*?)\n## /.exec(out)[1];
  assert.match(withdrawn, new RegExp(`（${item.id} の受け入れ条件 1）: 引数があれば Hello, <引数> を出す`));
});

test('課題の worktree から依頼しても、accept 行 pool:<ID> は本体のチェックアウトの名前のプールから読む', () => {
  const r = workRepo({ accept: false });
  const gori = testGori();
  const wt = join(mkdtempSync(join(tmpdir(), 'gori-review-wt-')), 'wt');
  assert.equal(r.g('worktree', 'add', '-q', '-b', ID, wt).status, 0);
  const item = poolItem(gori, r.dir, '- 引数があれば Hello, <引数> を出す');
  const add = spawnSync(process.execPath, [LOG, 'add', '--task', ID, '--type', 'accept', '--what', `pool:${item.id}`], { cwd: wt, encoding: 'utf8', env: cleanEnv() });
  assert.equal(add.status, 0, add.stderr);
  approve(wt);
  const res = review(wt, ['--dry-run'], { GORI_ROOT: gori });
  assert.equal(res.status, 0, res.out);
  const accept = /## 受け入れ基準\n([\s\S]*?)\n## /.exec(res.out)[1];
  assert.match(accept, new RegExp(`^- 行 \\d+（${item.id} の受け入れ条件 1）: 引数があれば Hello, <引数> を出す$`, 'm'));
});

test('accept 行 pool:<ID> の一件か受け入れ条件が無いか、プールの repo.yml が食い違えば、レビュアーを起動せず終了コード 2 で止まる', () => {
  const r = workRepo({ accept: false });
  const gori = testGori();
  const id = '20261108-090000-greet';
  spawnSync(process.execPath, [LOG, 'add', '--task', ID, '--type', 'accept', '--what', `pool:${id}`], { cwd: r.dir, encoding: 'utf8', env: cleanEnv() });
  approve(r.dir);
  const f = fakeClaude('pass');
  const env = { GORI_CLAUDE_BIN: f.bin, GORI_ROOT: gori };
  const missing = review(r.dir, [], env);
  assert.equal(missing.status, 2, missing.out);
  assert.match(missing.out, /一件が無い/);
  const item = poolItem(gori, r.dir, '本文だけで - の行が無い', { id });
  const empty = review(r.dir, [], env);
  assert.equal(empty.status, 2, empty.out);
  assert.match(empty.out, /受け入れ条件.*が無い/);
  item.put('- 引数があれば Hello, <引数> を出す');
  writeFileSync(join(dirname(item.dir), 'repo.yml'), 'path: /somewhere/else\n');
  const mismatch = review(r.dir, [], env);
  assert.equal(mismatch.status, 2, mismatch.out);
  assert.match(mismatch.out, /repo\.yml/);
  assert.ok(!existsSync(join(dirname(f.bin), 'note.json')), 'レビュアーが起動された');
  assert.equal(r.g('worktree', 'list').stdout.trim().split('\n').length, 1);
});

// 受け入れ条件は人間の承認を得てからレビューに出す。承認の行が、最後の受け入れ条件か、その訂正より後に無ければ止まる。
// プールの一件だけを受け入れ条件にした、承認の行の無い作業。
function poolOnly(status = 'todo') {
  const r = workRepo({ accept: false });
  const gori = testGori();
  const item = poolItem(gori, r.dir, '- 引数があれば Hello, <引数> を出す');
  if (status !== 'todo') writeFileSync(join(item.dir, `${item.id}.md`), readFileSync(join(item.dir, `${item.id}.md`), 'utf8').replace('status: todo', `status: ${status}`));
  const add = (type, what) => {
    const x = spawnSync(process.execPath, [LOG, 'add', '--task', ID, '--type', type, '--what', what], { cwd: r.dir, encoding: 'utf8', env: cleanEnv() });
    assert.equal(x.status, 0, x.stderr);
    return Number(/:(\d+)\s*$/.exec(x.stdout)[1]);
  };
  const line = add('accept', `pool:${item.id}`);
  return { ...r, gori, item, add, line };
}

test('GORI_AUTO があり、受け入れ条件が todo の一件を指す行だけなら、承認の行が無くてもレビュアーを起動し、金額の上限を付ける', () => {
  const r = poolOnly();
  const res = review(r.dir, ['--dry-run'], { GORI_ROOT: r.gori, GORI_AUTO: '1' });
  assert.equal(res.status, 0, res.out);
  assert.match(res.out, new RegExp(`無人の作業である。承認の行は無い。人間がプールの一件（${r.item.id}）を todo に上げたことを`));
  assert.doesNotMatch(res.out, /案や受け入れ基準を左右する問いに答えがあるか/);
  assert.match(res.out, /"--max-budget-usd" "5"/);
  const fake = fakeClaude('pass');
  const real = review(r.dir, [], { GORI_ROOT: r.gori, GORI_AUTO: '1', GORI_CLAUDE_BIN: fake.bin });
  assert.equal(real.status, 0, real.out);
  const args = fake.note().args;
  assert.equal(args[args.indexOf('--max-budget-usd') + 1], '5');
});

test('GORI_AUTO が無ければ、todo の一件だけの受け入れ条件でも承認の行を求め、金額の上限を付けない', () => {
  const r = poolOnly();
  const res = review(r.dir, ['--dry-run'], { GORI_ROOT: r.gori });
  assert.equal(res.status, 2, res.out);
  assert.match(res.out, /より後に承認の行が無い/);
  approve(r.dir);
  const ok = review(r.dir, ['--dry-run'], { GORI_ROOT: r.gori });
  assert.equal(ok.status, 0, ok.out);
  assert.doesNotMatch(ok.out, /--max-budget-usd/);
  assert.match(ok.out, /案や受け入れ基準を左右する問いに答えがあるか/);
});

test('GORI_AUTO があっても、受け入れ条件を足すか、訂正するか、取り下げた作業と、一件が todo でない作業は、承認の行が無ければ止まる', () => {
  const added = poolOnly();
  added.add('accept', '担当が足した条件');
  const corrected = poolOnly();
  corrected.add('fix', `行 ${corrected.line} を訂正: 別の条件`);
  const withdrawn = poolOnly();
  withdrawn.add('fix', `行 ${withdrawn.line} を取り下げ: 方針が変わった`);
  withdrawn.add('accept', '書き直した条件');
  const proposed = poolOnly('proposed');
  for (const [name, r] of Object.entries({ added, corrected, withdrawn, proposed })) {
    const res = review(r.dir, ['--dry-run'], { GORI_ROOT: r.gori, GORI_AUTO: '1' });
    assert.equal(res.status, 2, `${name}: ${res.out}`);
    assert.match(res.out, /より後に承認の行が無い/, name);
  }
});

test('承認の行が無いか、受け入れ条件より前にしか無いか、受け入れ条件を訂正した後に無ければ、レビュアーを起動せず worktree も作らず 2 で止まる', () => {
  const add = (cwd, type, what) => spawnSync(process.execPath, [LOG, 'add', '--task', ID, '--type', type, '--what', what], { cwd, encoding: 'utf8', env: cleanEnv() });
  const stops = (r, label) => {
    for (const dry of [true, false]) {
      const f = fakeClaude('pass');
      const res = review(r.dir, dry ? ['--dry-run'] : [], { GORI_CLAUDE_BIN: f.bin });
      assert.equal(res.status, 2, `${label}: ${res.out}`);
      assert.match(res.out, /承認の行が無い/, label);
      assert.match(res.out, /--type approval/, label);
      assert.ok(!existsSync(join(dirname(f.bin), 'note.json')), `${label}: レビュアーが起動された`);
      assert.equal(r.g('worktree', 'list').stdout.trim().split('\n').length, 1, label);
    }
  };
  const none = workRepo({ accept: false });
  assert.equal(add(none.dir, 'accept', '引数があれば Hello, <引数> を出す').status, 0);
  stops(none, '承認が無い');

  const before = workRepo({ accept: false });
  approve(before.dir);
  assert.equal(add(before.dir, 'accept', '引数があれば Hello, <引数> を出す').status, 0);
  stops(before, '受け入れ条件より前の承認だけ');

  const fixed = workRepo();
  const line = Number(/行 (\d+): 引数/.exec(review(fixed.dir, ['--dry-run']).out)[1]);
  assert.equal(add(fixed.dir, 'fix', `行 ${line} を訂正: 引数が空なら world を出す`).status, 0);
  stops(fixed, '訂正の後に承認が無い');
  approve(fixed.dir);
  assert.equal(review(fixed.dir, ['--dry-run']).status, 0);
});
