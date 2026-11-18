import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { repoRoot } from '../helpers.mjs';
import { fenceEnv, isAuto } from '../../tools/lib/auto.mjs';

// pre-commit の中で走ると git が GIT_* を渡し、会話の中で走ると CLAUDE* や GORI_* が立っている。どれも一時リポジトリの操作に漏らさない。
const clean = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_') && !k.startsWith('CLAUDE') && !k.startsWith('GORI_')));
const fenced = () => fenceEnv(repoRoot, clean());
const ID = ['-c', 'user.name=t', '-c', 'user.email=t@t'];

// main に commit が一つあり、作業ブランチ work に commit が一つ先にあるリポジトリ。
function repo() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'gori-fence-')));
  const git = (env, ...a) => {
    const r = spawnSync('git', ['-C', dir, ...ID, ...a], { encoding: 'utf8', env });
    return { status: r.status, out: `${r.stdout}${r.stderr}`, stdout: r.stdout.trim() };
  };
  const plain = (...a) => git(clean(), ...a);
  const auto = (...a) => git(fenced(), ...a);
  plain('init', '-q', '-b', 'main');
  plain('commit', '-q', '--allow-empty', '-m', 'init');
  plain('checkout', '-q', '-b', 'work');
  plain('commit', '-q', '--allow-empty', '-m', 'work');
  const sha = (ref) => plain('rev-parse', ref).stdout;
  return { dir, plain, auto, sha };
}
const hook = (path, body) => {
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
};

test('fenceEnv は GORI_AUTO と柵のフックの置き場所を足し、既にある GIT_CONFIG_* を残す', () => {
  const e = fenceEnv('/g', {});
  assert.equal(isAuto(e), true);
  assert.deepEqual([e.GIT_CONFIG_COUNT, e.GIT_CONFIG_KEY_0, e.GIT_CONFIG_VALUE_0], ['1', 'core.hooksPath', '/g/tools/auto/githooks']);
  const kept = fenceEnv('/g', { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'a.b', GIT_CONFIG_VALUE_0: 'c' });
  assert.deepEqual([kept.GIT_CONFIG_COUNT, kept.GIT_CONFIG_KEY_0, kept.GIT_CONFIG_KEY_1], ['2', 'a.b', 'core.hooksPath']);
  assert.equal(isAuto({}), false);
  assert.equal(isAuto({ GORI_AUTO: '' }), true);
});

test('柵が効いていても、作業ブランチへの commit は通る', () => {
  const r = repo();
  const c = r.auto('commit', '-q', '--allow-empty', '-m', 'more');
  assert.equal(c.status, 0, c.out);
});

test('柵が効いていると、main へのマージ、commit、update-ref は拒まれ、main は動かない', () => {
  const r = repo();
  const main = r.sha('main');
  r.plain('checkout', '-q', 'main');
  for (const args of [['merge', '--ff-only', 'work'], ['commit', '--allow-empty', '-m', 'x'], ['update-ref', 'refs/heads/main', r.sha('work')]]) {
    const x = r.auto(...args);
    assert.notEqual(x.status, 0, `${args[0]}: ${x.out}`);
    assert.match(x.out, /auto-fence: 無人の作業は refs\/heads\/main を動かせない/, args[0]);
    assert.equal(r.sha('main'), main, args[0]);
  }
  const ok = r.plain('merge', '-q', '--ff-only', 'work');
  assert.equal(ok.status, 0, `柵が無ければマージできる: ${ok.out}`);
});

test('柵が効いていると、master も動かせない', () => {
  const r = repo();
  r.plain('branch', '-m', 'main', 'master');
  const x = r.auto('update-ref', 'refs/heads/master', r.sha('work'));
  assert.notEqual(x.status, 0, x.out);
  assert.match(x.out, /refs\/heads\/master を動かせない/);
});

test('柵が効いていると push は拒まれ、柵が無ければ通る', () => {
  const r = repo();
  const remote = realpathSync(mkdtempSync(join(tmpdir(), 'gori-fence-remote-')));
  spawnSync('git', ['init', '-q', '--bare', remote], { env: clean() });
  r.plain('remote', 'add', 'origin', remote);
  const x = r.auto('push', 'origin', 'work');
  assert.notEqual(x.status, 0, x.out);
  assert.match(x.out, /auto-fence: 無人の作業は push できない/);
  assert.notEqual(spawnSync('git', ['-C', remote, 'rev-parse', '--verify', '-q', 'refs/heads/work'], { env: clean() }).status, 0, '送られていない');
  assert.equal(r.plain('push', '-q', 'origin', 'work').status, 0);
});

test('柵は、リポジトリが .git/hooks に持つ pre-commit と commit-msg を飛ばさずに呼ぶ', () => {
  const r = repo();
  hook(join(r.dir, '.git', 'hooks', 'pre-commit'), 'echo own-pre-commit >&2; exit 1');
  const stopped = r.auto('commit', '--allow-empty', '-m', 'x');
  assert.notEqual(stopped.status, 0, stopped.out);
  assert.match(stopped.out, /own-pre-commit/);
  hook(join(r.dir, '.git', 'hooks', 'pre-commit'), 'exit 0');
  hook(join(r.dir, '.git', 'hooks', 'commit-msg'), 'echo own-commit-msg >&2; exit 1');
  const msg = r.auto('commit', '--allow-empty', '-m', 'x');
  assert.notEqual(msg.status, 0, msg.out);
  assert.match(msg.out, /own-commit-msg/);
});

test('柵は、リポジトリの設定の core.hooksPath（相対パス）の pre-commit を呼ぶ。フックが無ければ commit は通る', () => {
  const r = repo();
  mkdirSync(join(r.dir, 'hooks'));
  hook(join(r.dir, 'hooks', 'pre-commit'), 'echo configured-pre-commit >&2; exit 1');
  r.plain('config', 'core.hooksPath', 'hooks');
  const stopped = r.auto('commit', '--allow-empty', '-m', 'x');
  assert.notEqual(stopped.status, 0, stopped.out);
  assert.match(stopped.out, /configured-pre-commit/);
  r.plain('config', 'core.hooksPath', 'nowhere');
  assert.equal(r.auto('commit', '-q', '--allow-empty', '-m', 'x').status, 0);
});

test('柵が main へのマージか pull を拒んだら、持ち込んだ変更を作業ツリーとインデックスから戻し、前からの変更と追跡していないファイルは残す', () => {
  const r = repo();
  r.plain('checkout', '-q', 'main');
  writeFileSync(join(r.dir, 'kept.txt'), 'kept\n');
  r.plain('add', 'kept.txt');
  r.plain('commit', '-q', '-m', 'kept');
  r.plain('checkout', '-q', '-b', 'feature');
  writeFileSync(join(r.dir, 'brought.txt'), 'brought\n');
  r.plain('add', 'brought.txt');
  r.plain('commit', '-q', '-m', 'brought');
  r.plain('checkout', '-q', 'main');
  const main = r.sha('main');
  for (const args of [['merge', '--ff-only', 'feature'], ['merge', '--no-edit', 'feature'], ['pull', '-q', '--ff-only', '.', 'feature']]) {
    writeFileSync(join(r.dir, 'kept.txt'), 'edited\n');
    writeFileSync(join(r.dir, 'untracked.txt'), 'u\n');
    const x = r.auto(...args);
    assert.notEqual(x.status, 0, `${args.join(' ')}: ${x.out}`);
    assert.match(x.out, /auto-fence: マージが持ち込んだ変更を作業ツリーとインデックスから戻した/, args.join(' '));
    assert.equal(r.sha('main'), main, args.join(' '));
    assert.equal(r.plain('status', '--porcelain').stdout, 'M kept.txt\n?? untracked.txt', args.join(' '));
    assert.equal(existsSync(join(r.dir, 'brought.txt')), false, args.join(' '));
  }
});

test('柵が main への commit を拒んでも、作業ツリーとインデックスの中身は戻さない', () => {
  const r = repo();
  r.plain('checkout', '-q', 'main');
  writeFileSync(join(r.dir, 'mine.txt'), 'mine\n');
  r.plain('add', 'mine.txt');
  const x = r.auto('commit', '-q', '-m', 'mine');
  assert.notEqual(x.status, 0, x.out);
  assert.doesNotMatch(x.out, /戻した/);
  assert.equal(r.plain('status', '--porcelain').stdout, 'A  mine.txt');
});
