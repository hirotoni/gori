import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { repoRoot } from '../helpers.mjs';

const HOOK = join(repoRoot, 'tools', 'hooks', 'session-end');
const cleanEnv = (extra = {}) => ({
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_') && !k.startsWith('CLAUDE') && !k.startsWith('GORI_'))),
  ...extra,
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 起動された道具の代わり。環境変数と引数を記録する。
function stub() {
  const dir = mkdtempSync(join(tmpdir(), 'gori-end-'));
  const bin = join(dir, 'extract-run');
  const out = join(dir, 'ran.json');
  writeFileSync(bin, `#!${process.execPath}\nimport { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(out)}, JSON.stringify({ args: process.argv.slice(2), extracting: process.env.GORI_EXTRACTING ?? null, stdinTTY: process.stdin.isTTY ?? false }));\n`);
  chmodSync(bin, 0o755);
  return { dir, bin, out };
}
const home = () => mkdtempSync(join(tmpdir(), 'gori-end-home-'));
const hook = (env, input = '{"session_id":"s","hook_event_name":"SessionEnd"}') => {
  const r = spawnSync(process.execPath, [HOOK], { input, encoding: 'utf8', env: cleanEnv(env) });
  return { status: r.status, err: r.stderr, out: r.stdout };
};
async function launched(s) {
  for (let i = 0; i < 50; i++) {
    if (existsSync(s.out)) return true;
    await sleep(100);
  }
  return false;
}
async function notLaunched(s) {
  await sleep(500);
  return !existsSync(s.out);
}

test('D1: 条件が無ければ切り離して起動し、すぐ 0 で終わる。最後の起動の時刻を残す', async () => {
  const s = stub();
  const h = home();
  const t0 = Date.now();
  const r = hook({ GORI_HOME: h, GORI_EXTRACT_RUN: s.bin });
  assert.equal(r.status, 0, r.err);
  assert.ok(await launched(s), '起動されなかった');
  const ran = JSON.parse(readFileSync(s.out, 'utf8'));
  assert.equal(ran.extracting, null);
  assert.ok(Math.abs(Number(readFileSync(join(h, 'state', 'last-extract'), 'utf8')) - t0) < 10_000);
});

test('D1: GORI_EXTRACTING があれば何も起動しない', async () => {
  const s = stub();
  const h = home();
  const r = hook({ GORI_HOME: h, GORI_EXTRACT_RUN: s.bin, GORI_EXTRACTING: '1' });
  assert.equal(r.status, 0);
  assert.ok(await notLaunched(s));
  assert.equal(existsSync(join(h, 'state', 'last-extract')), false);
});

test('D1: GORI_REVIEWING があれば何も起動しない', async () => {
  const s = stub();
  const r = hook({ GORI_HOME: home(), GORI_EXTRACT_RUN: s.bin, GORI_REVIEWING: '1' });
  assert.equal(r.status, 0);
  assert.ok(await notLaunched(s));
});

test('D1: 間引きの期間内なら起動しない。期間を過ぎるか 0 にすれば起動する', async () => {
  const s = stub();
  const h = home();
  mkdirSync(join(h, 'state'), { recursive: true });
  writeFileSync(join(h, 'state', 'last-extract'), `${Date.now() - 3600 * 1000}\n`);
  assert.equal(hook({ GORI_HOME: h, GORI_EXTRACT_RUN: s.bin }).status, 0);
  assert.ok(await notLaunched(s), '20 時間以内なのに起動した');
  assert.equal(hook({ GORI_HOME: h, GORI_EXTRACT_RUN: s.bin, GORI_EXTRACT_INTERVAL_HOURS: '0.5' }).status, 0);
  assert.ok(await launched(s), '期間を 0.5 時間にしても起動しない');
});

test('D1: 既定の間引きは 20 時間で、19 時間前の起動なら起動せず、21 時間前なら起動する', async () => {
  const s = stub();
  const h = home();
  mkdirSync(join(h, 'state'), { recursive: true });
  writeFileSync(join(h, 'state', 'last-extract'), `${Date.now() - 19 * 3600 * 1000}\n`);
  assert.equal(hook({ GORI_HOME: h, GORI_EXTRACT_RUN: s.bin }).status, 0);
  assert.ok(await notLaunched(s), '19 時間前の起動なのに起動した');
  writeFileSync(join(h, 'state', 'last-extract'), `${Date.now() - 21 * 3600 * 1000}\n`);
  assert.equal(hook({ GORI_HOME: h, GORI_EXTRACT_RUN: s.bin }).status, 0);
  assert.ok(await launched(s), '21 時間前の起動なのに起動しない');
});

test('D1: ロックの持ち主が生きていれば起動しない', async () => {
  const s = stub();
  const h = home();
  mkdirSync(join(h, 'state'), { recursive: true });
  writeFileSync(join(h, 'state', 'extract.lock'), `${process.pid}\n`);
  const r = hook({ GORI_HOME: h, GORI_EXTRACT_RUN: s.bin });
  assert.equal(r.status, 0);
  assert.ok(await notLaunched(s));
  assert.equal(readFileSync(join(h, 'state', 'extract.lock'), 'utf8'), `${process.pid}\n`);
});

test('D1: 古いロック（持ち主が死んでいる）は取り除いて起動する', async () => {
  const s = stub();
  const h = home();
  mkdirSync(join(h, 'state'), { recursive: true });
  const dead = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' }).stdout;
  writeFileSync(join(h, 'state', 'extract.lock'), `${dead}\n`);
  const r = hook({ GORI_HOME: h, GORI_EXTRACT_RUN: s.bin });
  assert.equal(r.status, 0, r.err);
  assert.ok(await launched(s));
  assert.equal(existsSync(join(h, 'state', 'extract.lock')), false);
});

test('D1: 壊れた標準入力でも、標準入力が空でも 0', async () => {
  const s = stub();
  assert.equal(hook({ GORI_HOME: home(), GORI_EXTRACT_RUN: s.bin }, '{{{ not json \u0000').status, 0);
  assert.ok(await launched(s));
  assert.equal(hook({ GORI_HOME: home(), GORI_EXTRACT_RUN: stub().bin }, '').status, 0);
});

test('D1: 起動する道具が無くても 0 で、失敗は stderr に書く', () => {
  const r = hook({ GORI_HOME: home(), GORI_EXTRACT_RUN: join(tmpdir(), 'gori-no-such-run') });
  assert.equal(r.status, 0);
  assert.match(r.err, /session-end/);
});

test('D1: 壊れたロックと壊れた last-extract でも 0 で起動する', async () => {
  const s = stub();
  const h = home();
  mkdirSync(join(h, 'state'), { recursive: true });
  writeFileSync(join(h, 'state', 'extract.lock'), 'xyz\n');
  writeFileSync(join(h, 'state', 'last-extract'), 'xyz\n');
  assert.equal(hook({ GORI_HOME: h, GORI_EXTRACT_RUN: s.bin }).status, 0);
  assert.ok(await launched(s));
});

test('hooks.json は SessionEnd に session-end を登録する', () => {
  const h = JSON.parse(readFileSync(join(repoRoot, 'tools', 'hooks', 'hooks.json'), 'utf8'));
  assert.match(h.hooks.SessionEnd[0].hooks[0].command, /tools\/hooks\/session-end/);
});

test('D1: ルートが gori のチェックアウトでなければ、起動せず理由を一行ログに書いて 0', async () => {
  const s = stub();
  const h = home();
  const cache = mkdtempSync(join(tmpdir(), 'gori-cache-'));
  const r = hook({ GORI_HOME: h, GORI_EXTRACT_RUN: s.bin, CLAUDE_PLUGIN_ROOT: cache });
  assert.equal(r.status, 0);
  assert.ok(await notLaunched(s));
  const logs = readdirSync(join(h, 'logs'));
  assert.equal(logs.length, 1);
  const text = readFileSync(join(h, 'logs', logs[0]), 'utf8');
  assert.match(text, /^skipped=.* は git のチェックアウトでない/);
  assert.equal(text.trim().split('\n').length, 1);
  assert.equal(existsSync(join(h, 'state', 'last-extract')), false);
});

test('D1: git のチェックアウトでも gori でなければ起動しない', async () => {
  const s = stub();
  const h = home();
  const other = mkdtempSync(join(tmpdir(), 'gori-other-'));
  spawnSync('git', ['-C', other, 'init', '-q'], { env: cleanEnv() });
  assert.equal(hook({ GORI_HOME: h, GORI_EXTRACT_RUN: s.bin, GORI_ROOT: other }).status, 0);
  assert.ok(await notLaunched(s));
  assert.match(readFileSync(join(h, 'logs', readdirSync(join(h, 'logs'))[0]), 'utf8'), /gori のチェックアウトでない/);
});

test('D1: CLAUDE_PLUGIN_ROOT が gori のチェックアウトなら起動し、GORI_ROOT が優先される', async () => {
  const s = stub();
  assert.equal(hook({ GORI_HOME: home(), GORI_EXTRACT_RUN: s.bin, CLAUDE_PLUGIN_ROOT: repoRoot }).status, 0);
  assert.ok(await launched(s));
  const s2 = stub();
  const cache = mkdtempSync(join(tmpdir(), 'gori-cache-'));
  assert.equal(hook({ GORI_HOME: home(), GORI_EXTRACT_RUN: s2.bin, CLAUDE_PLUGIN_ROOT: repoRoot, GORI_ROOT: cache }).status, 0);
  assert.ok(await notLaunched(s2));
});

// 積む先の gori のチェックアウト。利用者のチェックアウトの抽出待ちに書かないよう、一時ディレクトリに作る。
function goriTree() {
  const dir = mkdtempSync(join(tmpdir(), 'gori-end-root-'));
  mkdirSync(join(dir, '.claude-plugin'));
  writeFileSync(join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'gori' }));
  spawnSync('git', ['-C', dir, 'init', '-q'], { env: cleanEnv() });
  return { dir, pending: join(dir, '.git', 'gori', 'learning', 'pending') };
}
const ended = (path) => JSON.stringify({ session_id: 'sid-1', transcript_path: path, hook_event_name: 'SessionEnd', reason: 'other' });

test('終わった会話を、会話の記録のファイル名で gori のチェックアウトの抽出待ちに積み、抽出を起動する', async () => {
  const g = goriTree();
  const s = stub();
  const r = hook({ GORI_HOME: home(), GORI_EXTRACT_RUN: s.bin, GORI_ROOT: g.dir }, ended('/p/-a/file-1.jsonl'));
  assert.equal(r.status, 0, r.err);
  assert.ok(await launched(s));
  assert.deepEqual(readdirSync(g.pending), ['file-1']);
  assert.equal(readFileSync(join(g.pending, 'file-1'), 'utf8'), '/p/-a/file-1.jsonl\n');
  // 間引きの期間内でも積む。同じ会話を二度積んでも一件のまま。
  assert.equal(hook({ GORI_HOME: home(), GORI_EXTRACT_RUN: stub().bin, GORI_ROOT: g.dir }, ended('/p/-a/file-1.jsonl')).status, 0);
  assert.deepEqual(readdirSync(g.pending), ['file-1']);
});

test('会話の記録のパスの形でない入力では積まず、積めなくても 0 で抽出を起動する', async () => {
  const g = goriTree();
  for (const input of ['{}', ended('rel/x.jsonl'), ended('/p/x.txt'), ended('/p/-a/.jsonl'), JSON.stringify({ session_id: 'sid-2' })]) {
    assert.equal(hook({ GORI_HOME: home(), GORI_EXTRACT_RUN: stub().bin, GORI_ROOT: g.dir }, input).status, 0);
  }
  assert.equal(existsSync(g.pending), false);
  // 抽出待ちの場所がファイルで、積めない。
  const g2 = goriTree();
  mkdirSync(join(g2.dir, '.git', 'gori', 'learning'), { recursive: true });
  writeFileSync(g2.pending, 'x');
  const s = stub();
  const r = hook({ GORI_HOME: home(), GORI_EXTRACT_RUN: s.bin, GORI_ROOT: g2.dir }, ended('/p/-a/file-2.jsonl'));
  assert.equal(r.status, 0);
  assert.match(r.err, /抽出待ちに積めない/);
  assert.ok(await launched(s));
});

test('抽出やレビューのセッションと、ルートが gori のチェックアウトでないときは積まない', () => {
  const g = goriTree();
  for (const env of [{ GORI_EXTRACTING: '1' }, { GORI_REVIEWING: '1' }]) {
    assert.equal(hook({ GORI_HOME: home(), GORI_EXTRACT_RUN: stub().bin, GORI_ROOT: g.dir, ...env }, ended('/p/-a/file-3.jsonl')).status, 0);
  }
  assert.equal(existsSync(g.pending), false);
  const other = mkdtempSync(join(tmpdir(), 'gori-other-'));
  assert.equal(hook({ GORI_HOME: home(), GORI_EXTRACT_RUN: stub().bin, GORI_ROOT: other }, ended('/p/-a/file-3.jsonl')).status, 0);
  assert.equal(existsSync(join(other, '.git')), false);
});

test('標準入力が閉じられないままでも、待ち続けずに 0 で終わる', async () => {
  const g = goriTree();
  const s = stub();
  const child = spawn(process.execPath, [HOOK], { env: cleanEnv({ GORI_HOME: home(), GORI_EXTRACT_RUN: s.bin, GORI_ROOT: g.dir }), stdio: ['pipe', 'ignore', 'pipe'] });
  child.stdin.write(ended('/p/-a/open.jsonl'));
  const t0 = Date.now();
  const code = await new Promise((done) => {
    const t = setTimeout(() => {
      child.kill('SIGKILL');
      done('timeout');
    }, 5000);
    child.on('exit', (c) => {
      clearTimeout(t);
      done(c);
    });
  });
  child.stdin.destroy();
  assert.equal(code, 0);
  assert.ok(Date.now() - t0 < 3000, `${Date.now() - t0} ms かかった`);
  assert.ok(await launched(s));
  // 閉じられなくても、期限までに届いた入力で積む。
  assert.deepEqual(readdirSync(g.pending), ['open']);
});
