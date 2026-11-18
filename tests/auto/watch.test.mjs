import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { repoRoot } from '../helpers.mjs';
import { LIMITS, TASK, cleanEnv, fakeClaude, fakeGori, item, put, records, setup, tmp, workRepo } from './helpers.mjs';

const WATCH = join(repoRoot, 'tools', 'auto', 'watch');
// 間隔を 0.01 分（0.6 秒）にして、待って続ける動きを短い時間で確かめる。
const FAST = { ...LIMITS, 'watch-minutes': 0.01 };

// watch を起動する。onLine は標準出力の一行ごとに呼ばれ、待っている間に状態を変えるのに使う。
function watch(gori, fake, { onLine = () => {}, timeoutMs = 30_000 } = {}) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [WATCH], { env: cleanEnv({ GORI_ROOT: gori, GORI_CLAUDE_BIN: fake.bin, CLAUDE_CONFIG_DIR: tmp('gori-watch-config-') }) });
    let out = '';
    let err = '';
    let seen = 0;
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (d) => {
      out += d;
      const lines = out.split('\n').slice(0, -1);
      for (; seen < lines.length; seen++) onLine(lines[seen], child);
    });
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (status, signal) => {
      clearTimeout(timer);
      done({ status, signal, out, err, result: out.trimEnd().split('\n').at(-1) });
    });
  });
}

test('最初の見回りで run が合格で終われば、状態を出して 0 で終わる', async () => {
  const s = setup('pass', FAST);
  const r = await watch(s.gori, s.fake);
  assert.equal(r.status, 0, r.out + r.err);
  assert.equal(r.result, 'RESULT=pass');
  assert.match(r.out, /レビューに合格した。取り込みを待つ/);
  assert.match(r.out, new RegExp(`取り込み待ち: 1 件[^\n]*\n  app/${s.id} 作業 ${TASK}`));
  assert.equal(r.out.match(/^RESULT=/gm).length, 1, 'run の RESULT の行は写さない');
});

test('進める一件が無い間は claude を呼ばずに待って続け、todo の一件ができたら run が進めて終わる', async () => {
  const gori = fakeGori(FAST);
  workRepo(gori);
  const fake = fakeClaude('stop');
  let waits = 0;
  let id = null;
  const r = await watch(gori, fake, {
    onLine: (line) => {
      if (!/見回り: 進める一件が無い。0\.01 分後にまた見る/.test(line)) return;
      waits++;
      if (waits === 2) {
        assert.equal(fake.launched(), false, '待っている間は claude を起動しない');
        assert.equal(existsSync(join(gori, '.git', 'gori', 'auto', 'runs')), false);
        id = item(gori, 'app', '20261108-090000-late');
      }
    },
  });
  assert.equal(r.status, 0, r.out + r.err);
  assert.ok(waits >= 2, r.out);
  assert.equal(r.result, 'RESULT=stopped');
  assert.equal(fake.note().id, id);
  assert.match(r.out, /人間を待って止まった作業: 1 件/);
});

test('別の run が動いている間は、待って続ける', async () => {
  const s = setup('idle', FAST);
  put(join(s.gori, '.git', 'gori', 'auto', 'run.lock'), `${process.pid}\n`);
  let waits = 0;
  const r = await watch(s.gori, s.fake, {
    onLine: (line, child) => {
      if (/見回り: 別の run が動いている/.test(line) && ++waits === 2) child.kill('SIGTERM');
    },
  });
  assert.equal(waits, 2, r.out + r.err);
  assert.equal(r.signal, 'SIGTERM');
  assert.equal(s.fake.launched(), false);
});

test('run が失敗で終われば、直近の失敗を出して 1 で終わる。起動しなかった失敗も同じ', async () => {
  const s = setup('exit3', FAST);
  const r = await watch(s.gori, s.fake);
  assert.equal(r.status, 1, r.out + r.err);
  assert.equal(r.result, 'RESULT=failed');
  assert.match(r.out, /直近の失敗: .+claude が終了コード 3 で終わった/);
  const a = setup('idle', FAST);
  const ra = await watch(a.gori, fakeClaude('idle', { auth: { loggedIn: false } }));
  assert.equal(ra.status, 1, ra.out + ra.err);
  assert.match(ra.out, /直近の失敗: .+起動しなかった: ログインが claude\.ai のサブスクリプションでない/);
});

test('一日の上限に達していれば、状態を出して 0 で終わる', async () => {
  const s = setup('idle', { ...FAST, 'runs-per-day': 1 });
  const first = await watch(s.gori, fakeClaude());
  assert.equal(first.result, 'RESULT=stopped', first.out + first.err);
  const fake = fakeClaude();
  const r = await watch(s.gori, fake);
  assert.equal(r.status, 0, r.out + r.err);
  assert.equal(r.result, 'RESULT=daily-limit');
  assert.match(r.out, /一日の上限（1 回）に達した/);
  assert.equal(fake.launched(), false);
});

test('run が結果を出さずに落ちたら、失敗として 1 で終わる', async () => {
  const s = setup('idle', FAST);
  // 実行の記録の置き場所をファイルにして、run を RESULT の行の前に落とす。
  put(join(s.gori, '.git', 'gori', 'auto'), 'not a directory\n');
  const r = await watch(s.gori, s.fake);
  assert.equal(r.status, 1, r.out + r.err);
  assert.equal(r.result, 'RESULT=failed');
  assert.match(r.out, /run が結果を出さずに終わった（終了コード 1）。失敗として扱う/);
  assert.equal(s.fake.launched(), false);
});

test('見回りの間隔を読めなければ、run を呼ばず 2 で終わる', async () => {
  const s = setup('idle', Object.fromEntries(Object.entries(LIMITS).filter(([k]) => k !== 'watch-minutes')));
  const r = await watch(s.gori, s.fake);
  assert.equal(r.status, 2, r.out + r.err);
  assert.match(r.err, /設定を読めないので何も起動しない: .+watch-minutes/);
  assert.equal(s.fake.launched(), false);
  assert.deepEqual(records(s.gori), []);
  assert.equal(existsSync(join(s.gori, '.git', 'gori', 'auto')), false);
});

test('watch と status は、自分では claude を起動する呼び出しを持たない', () => {
  for (const f of ['tools/auto/watch', 'tools/auto/status', 'tools/lib/auto-status.mjs']) {
    const src = readFileSync(join(repoRoot, f), 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    assert.doesNotMatch(src, /GORI_CLAUDE_BIN'|\bclaude'/, f);
  }
});
