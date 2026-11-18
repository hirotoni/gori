import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { test } from 'node:test';
import { recordsDir, repoRoot, testGori } from '../helpers.mjs';

// 本物の GitHub には何も送らない。偽の gh を置いた場所だけを PATH にして道具を走らせる。
// 一時リポジトリの操作と道具の判断に、pre-commit やレビュアーの環境変数を漏らさない。記録は一時の gori（GORI_ROOT）の下に書かせる。
const cleanEnv = (extra = {}) => ({
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_') && !k.startsWith('CLAUDE') && !k.startsWith('GORI_'))),
  GORI_ROOT: testGori(),
  ...extra,
});
const LOG = join(repoRoot, 'tools', 'records', 'log');
const POOL = join(repoRoot, 'tools', 'records', 'pool');
const TOOL = join(repoRoot, 'tools', 'repo', 'draft-pr');
const ID = '20261118-100000-demo';
const PR = { number: 5, html_url: 'https://github.com/o/r/pull/5', draft: true };
const LIST = 'GET repos/{owner}/{repo}/pulls';
const CREATE = 'POST repos/{owner}/{repo}/pulls';

// 偽の gh。--version には答え、api は `<METHOD> <endpoint（? より前）>` を routes.json で引いて応答し、呼び出しを calls.jsonl に残す。
const FAKE_GH = `#!${process.execPath}
const fs = require('fs');
const dir = process.env.FAKE_GH_DIR;
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('gh version 0.0.0'); process.exit(0); }
let method = 'GET', input = false, endpoint = null;
for (let i = 1; i < args.length; i++) {
  if (args[i] === '--method') method = args[++i];
  else if (args[i] === '--input') { input = true; i++; }
  else if (!args[i].startsWith('-')) endpoint = args[i];
}
const stdin = input ? fs.readFileSync(0, 'utf8') : null;
fs.appendFileSync(dir + '/calls.jsonl', JSON.stringify({ args, method, endpoint, stdin }) + '\\n');
const routes = JSON.parse(fs.readFileSync(dir + '/routes.json', 'utf8'));
const key = method + ' ' + endpoint.split('?')[0];
if (!(key in routes)) { process.stderr.write('HTTP 404: no route ' + key); process.exit(1); }
process.stdout.write(JSON.stringify(routes[key]));
`;

// 本物の git の絶対パス。道具に渡す PATH は偽の gh の置き場所だけにするので、git はそこに包みを置いて呼ばせる。
const realGit = process.env.PATH.split(delimiter).map((d) => join(d, 'git')).find((p) => existsSync(p));

// 作業 ID のブランチに commit が一つあり、受け入れ条件を記録した作業を用意する。
// origin は手元の bare リポジトリ。pushed が真なら作業のブランチを push し、verdict が真なら HEAD に合格のレビュー結果を置く。
function setup({ withGh = true, pushed = true, verdict = true, routes = { [LIST]: [], [CREATE]: PR }, accepts = ['条件その一'] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'gori-draft-pr-'));
  const origin = mkdtempSync(join(tmpdir(), 'gori-draft-pr-origin-'));
  const g = (...a) => {
    const r = spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8', env: cleanEnv() });
    assert.equal(r.status, 0, `git ${a.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  spawnSync('git', ['init', '-q', '--bare', origin], { env: cleanEnv() });
  spawnSync('git', ['init', '-q', '-b', 'main', dir], { env: cleanEnv() });
  g('config', 'user.name', 'tester');
  g('config', 'user.email', 't@t');
  g('commit', '-q', '--allow-empty', '-m', 'init');
  g('remote', 'add', 'origin', origin);
  g('push', '-q', 'origin', 'main');
  g('checkout', '-q', '-b', ID);
  const log = (args) => {
    const r = spawnSync(process.execPath, [LOG, ...args], { cwd: dir, encoding: 'utf8', env: cleanEnv({ CLAUDE_CODE_SESSION_ID: 'worker-1' }) });
    assert.equal(r.status, 0, `log ${args.join(' ')}: ${r.stdout}${r.stderr}`);
  };
  log(['start', '--task', ID, '--what', '題の無い PR を無くす']);
  for (const a of accepts) log(['add', '--task', ID, '--type', 'accept', '--what', a]);
  g('commit', '-q', '--allow-empty', '-m', '最初の変更');
  g('commit', '-q', '--allow-empty', '-m', '二つ目の変更');
  const sha = g('rev-parse', 'HEAD');
  if (pushed) g('push', '-q', 'origin', ID);
  if (verdict) {
    const vdir = join(recordsDir(dir), 'verdicts', sha);
    mkdirSync(vdir, { recursive: true });
    writeFileSync(join(vdir, 'judge.json'), JSON.stringify({ task: ID, sha, judge: 'session:judge-1', result: 'pass', time: '2026-11-18T10:00:00+09:00', suggestions: ['名前を直すとよい'] }));
  }
  const fake = mkdtempSync(join(tmpdir(), 'gori-draft-pr-gh-'));
  const bin = join(fake, 'bin');
  mkdirSync(bin);
  writeFileSync(join(fake, 'routes.json'), JSON.stringify(routes));
  writeFileSync(join(bin, 'git'), `#!/bin/sh\nexec "${realGit}" "$@"\n`);
  chmodSync(join(bin, 'git'), 0o755);
  if (withGh) {
    writeFileSync(join(bin, 'gh'), FAKE_GH);
    chmodSync(join(bin, 'gh'), 0o755);
  }
  return { dir, origin, fake, bin, sha, g, log };
}

function tool(env, args = ['--task', ID]) {
  const r = spawnSync(process.execPath, [TOOL, ...args], { cwd: env.dir, encoding: 'utf8', env: cleanEnv({ PATH: env.bin, FAKE_GH_DIR: env.fake }) });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}
const calls = (env) => {
  const p = join(env.fake, 'calls.jsonl');
  return existsSync(p) ? readFileSync(p, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
};
const writes = (env) => calls(env).filter((c) => c.method !== 'GET');
const originHead = (env) => spawnSync('git', ['-C', env.origin, 'rev-parse', '--verify', '-q', `refs/heads/${ID}`], { encoding: 'utf8', env: cleanEnv() }).stdout.trim();

test('合格した作業なら draft の PR を作り、本文に目的と受け入れ条件とレビュー結果を入れる', () => {
  const env = setup({ accepts: ['条件その一', '条件その二'] });
  const r = tool(env);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /PR_URL=https:\/\/github\.com\/o\/r\/pull\/5\n$/);
  const [post] = writes(env);
  assert.equal(writes(env).length, 1);
  assert.equal(post.method, 'POST');
  const sent = JSON.parse(post.stdin);
  assert.equal(sent.draft, true);
  assert.equal(sent.head, ID);
  assert.equal(sent.base, 'main');
  assert.equal(sent.title, '最初の変更');
  assert.match(sent.body, /## 目的\n\n題の無い PR を無くす\n/);
  assert.match(sent.body, /## 受け入れ条件\n\n- 条件その一\n- 条件その二\n/);
  assert.match(sent.body, new RegExp(`## レビュー結果\\n\\n合格: ${env.sha.slice(0, 12)} は session:judge-1 がレビューで合格とした`));
  assert.match(sent.body, /直すことを勧める指摘: 名前を直すとよい/);
});

test('--title、--base、--footer を渡せば、題と向き先と本文の末尾に使う', () => {
  const env = setup();
  assert.equal(tool(env, ['--task', ID, '--title', '題', '--base', 'develop', '--footer', '末尾の一行']).status, 0);
  const sent = JSON.parse(writes(env)[0].stdin);
  assert.deepEqual([sent.title, sent.base, sent.draft], ['題', 'develop', true]);
  assert.match(sent.body, /\n末尾の一行\n$/);
});

test('取り下げた条件は本文に入れず、訂正した条件は訂正後の文で入れる', () => {
  const env = setup({ accepts: ['古い条件', '消す条件', '残る条件'] });
  // accept 行は、列名、start に続く 3、4、5 行目である。
  env.log(['add', '--task', ID, '--type', 'fix', '--what', '行 3 を訂正: 直した条件']);
  env.log(['add', '--task', ID, '--type', 'fix', '--what', '行 4 を取り下げ: 要らなくなった']);
  assert.equal(tool(env).status, 0);
  const { body } = JSON.parse(writes(env)[0].stdin);
  assert.match(body, /## 受け入れ条件\n\n- 直した条件\n- 残る条件\n\n/);
  assert.doesNotMatch(body, /古い条件|消す条件/);
});

test('accept 行が pool:<ID> なら、プールの一件の受け入れ条件を本文に入れる', () => {
  const env = setup({ accepts: [] });
  const text = ['## 現状', 'a', '', '## 問題', 'b', '', '## 期待する結果', 'c', '', '## 確認したこと', 'd', '', '## 受け入れ条件', '- プールの条件一', '- プールの条件二', ''].join('\n');
  const add = spawnSync(process.execPath, [POOL, 'add', '--kind', 'improvement', '--slug', 'demo', '--title', '題'], { cwd: env.dir, input: text, encoding: 'utf8', env: cleanEnv() });
  assert.equal(add.status, 0, `${add.stdout}${add.stderr}`);
  const id = /\d{8}-\d{6}-demo/.exec(add.stdout)[0];
  env.log(['add', '--task', ID, '--type', 'accept', '--what', `pool:${id}`]);
  const r = tool(env);
  assert.equal(r.status, 0, r.out);
  assert.match(JSON.parse(writes(env)[0].stdin).body, /## 受け入れ条件\n\n- プールの条件一\n- プールの条件二\n/);
});

test('レビュー結果が無ければ、PR を作らずに終了コード 1', () => {
  const env = setup({ verdict: false });
  const r = tool(env);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /未レビュー/);
  assert.match(r.out, /PR を作らない/);
  assert.equal(calls(env).length, 0);
});

test('合格の後に commit を足したら、その HEAD は合格していないので作らない', () => {
  const env = setup();
  env.g('commit', '-q', '--allow-empty', '-m', 'レビューの後の変更');
  env.g('push', '-q', 'origin', ID);
  assert.equal(tool(env).status, 1);
  assert.equal(calls(env).length, 0);
});

test('gh が無ければ、入れて認証するよう伝えて終了コード 2', () => {
  const env = setup({ withGh: false });
  const r = tool(env);
  assert.equal(r.status, 2, r.out);
  assert.match(r.out, /gh が見つからない/);
});

test('同じブランチの open の PR が既にあれば、新しく作らず本文を更新する', () => {
  const env = setup({ routes: { [LIST]: [PR], 'PATCH repos/{owner}/{repo}/pulls/5': PR } });
  const r = tool(env);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /PR_URL=https:\/\/github\.com\/o\/r\/pull\/5\n$/);
  assert.deepEqual(writes(env).map((c) => c.method), ['PATCH']);
  assert.deepEqual(Object.keys(JSON.parse(writes(env)[0].stdin)), ['body']);
  assert.match(calls(env)[0].endpoint, new RegExp(`head=\\{owner\\}:${ID}`));
});

test('作業のブランチが origin に無ければ、push せず、PR を作らずに終了コード 1', () => {
  const env = setup({ pushed: false });
  const r = tool(env);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, new RegExp(`git push origin ${ID}`));
  assert.equal(calls(env).length, 0);
  assert.equal(originHead(env), '');
});

test('origin のブランチが HEAD より古ければ、push せず、PR を作らずに終了コード 1', () => {
  const env = setup({ verdict: false });
  const old = originHead(env);
  env.g('commit', '-q', '--allow-empty', '-m', 'push していない変更');
  const sha = env.g('rev-parse', 'HEAD');
  const vdir = join(recordsDir(env.dir), 'verdicts', sha);
  mkdirSync(vdir, { recursive: true });
  writeFileSync(join(vdir, 'judge.json'), JSON.stringify({ task: ID, sha, judge: 'session:judge-1', result: 'pass', time: '2026-11-18T10:00:00+09:00' }));
  assert.equal(tool(env).status, 1);
  assert.equal(calls(env).length, 0);
  assert.equal(originHead(env), old);
});

test('作られた PR が draft でなければ、知らせて終了コード 1', () => {
  const env = setup({ routes: { [LIST]: [], [CREATE]: { ...PR, draft: false } } });
  const r = tool(env);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /draft でない/);
});

test('draft を外す指定は無く、知らないフラグは何も送らずに終了コード 2', () => {
  for (const flag of ['--no-draft', '--ready', '--draft']) {
    const env = setup();
    const r = tool(env, ['--task', ID, flag]);
    assert.equal(r.status, 2, `${flag}: ${r.out}`);
    assert.equal(calls(env).length, 0);
  }
});

test('作業 ID のブランチの外では作らない', () => {
  const env = setup();
  env.g('checkout', '-q', 'main');
  const r = tool(env);
  assert.equal(r.status, 2, r.out);
  assert.equal(calls(env).length, 0);
});
