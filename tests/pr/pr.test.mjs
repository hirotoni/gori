import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { commentableLines } from '../../tools/lib/pr.mjs';
import { repoRoot, tempTree } from '../helpers.mjs';

// 偽の gh。`<METHOD> <endpoint（? より前）>` を routes.json で引いて応答し、呼び出しを calls.jsonl に残す。
// PATH を偽の gh の置き場所だけにするので、node は絶対パスで起動させる。
const FAKE_GH = `#!${process.execPath}
const fs = require('fs');
const dir = process.env.FAKE_GH_DIR;
const args = process.argv.slice(2);
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

const BASE = 'repos/o/r/pulls/7';
const URL = 'https://github.com/o/r/pull/7';
const SHA = 'abc123';
const PATCH = ['@@ -10,4 +10,5 @@ fn()', ' ctx10', '-old11', '+new11', '+new12', ' ctx12', ' ctx13'].join('\n');

// --paginate --slurp の応答はページの配列なので、一枚のページに包む。
const page = (items) => [items];

function routes(over = {}) {
  return {
    [`GET ${BASE}`]: { number: 7, html_url: URL, title: 't', body: 'b', user: { login: 'author' }, base: { ref: 'main' }, head: { ref: 'feat', sha: SHA } },
    [`GET ${BASE}/files`]: page([
      { filename: 'src/a.js', status: 'modified', additions: 2, deletions: 1, patch: PATCH },
      { filename: 'img.png', status: 'added', additions: 0, deletions: 0 },
    ]),
    [`GET ${BASE}/reviews`]: page([{ id: 1, user: { login: 'ai-bot' }, state: 'COMMENTED', body: 'AI review' }]),
    [`GET ${BASE}/comments`]: page([{ id: 2, user: { login: 'ai-bot' }, path: 'src/a.js', line: 13, side: 'RIGHT', body: 'bot says', html_url: 'u2' }]),
    'GET user': { login: 'me' },
    'GET repos/o/r/issues/7/comments': page([{ id: 3, user: { login: 'ai-bot' }, body: 'summary', html_url: 'u3' }]),
    [`GET repos/o/r/commits/${SHA}/check-runs`]: page({ total_count: 1, check_runs: [{ name: 'lint', status: 'completed', conclusion: 'success' }] }),
    [`POST ${BASE}/reviews`]: { id: 99, state: 'PENDING', html_url: `${URL}#pullrequestreview-99` },
    [`GET ${BASE}/reviews/99/comments`]: page([{ path: 'src/a.js', line: 11, side: 'RIGHT', start_line: null, body: '名前が曖昧' }]),
    ...over,
  };
}

const GOOD = { body: '全体の所感', comments: [{ path: 'src/a.js', line: 11, side: 'RIGHT', body: '名前が曖昧' }] };

function setup({ route = {}, drafts = GOOD, withGh = true } = {}) {
  const dir = tempTree({ 'routes.json': JSON.stringify(routes(route)), 'drafts.json': JSON.stringify(drafts) });
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  if (withGh) {
    writeFileSync(join(bin, 'gh'), FAKE_GH);
    chmodSync(join(bin, 'gh'), 0o755);
  }
  return { dir, bin };
}

function tool(name, env, args) {
  const r = spawnSync(process.execPath, [join(repoRoot, 'tools', 'pr', name), ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: env.bin, FAKE_GH_DIR: env.dir },
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

const calls = (env) => {
  const p = join(env.dir, 'calls.jsonl');
  return existsSync(p) ? readFileSync(p, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
};
const posts = (env) => calls(env).filter((c) => c.method !== 'GET');

test('commentableLines: RIGHT は追加と文脈、LEFT は削除と文脈の行を hunk ごとに返す', () => {
  const [h] = commentableLines(`${PATCH}\n\\ No newline at end of file\n`);
  assert.deepEqual([...h.RIGHT], [10, 11, 12, 13, 14]);
  assert.deepEqual([...h.LEFT], [10, 11, 12, 13]);
});

test('collect: PR 本体、変更ファイル、レビュー、コメント、check run を一つの JSON にまとめ、GET しか呼ばない', () => {
  const env = setup();
  const r = tool('collect', env, [URL]);
  assert.equal(r.status, 0, r.out);
  const j = JSON.parse(r.out);
  assert.equal(j.pr.headSha, SHA);
  assert.deepEqual(j.files.map((f) => [f.path, f.patch === null]), [['src/a.js', false], ['img.png', true]]);
  assert.equal(j.reviews[0].author, 'ai-bot');
  assert.equal(j.reviewComments[0].line, 13);
  assert.equal(j.issueComments[0].body, 'summary');
  assert.deepEqual(j.checkRuns, [{ name: 'lint', status: 'completed', conclusion: 'success' }]);
  assert.equal(posts(env).length, 0);
});

test('collect: PR の番号なら {owner}/{repo} を gh に埋めさせる', () => {
  const env = setup({ route: { 'GET repos/{owner}/{repo}/pulls/7': { head: { sha: SHA } } } });
  tool('collect', env, ['7']);
  assert.equal(calls(env)[0].endpoint, 'repos/{owner}/{repo}/pulls/7');
});

test('check: 正しい下書きは合格し、何も書き込まない', () => {
  const env = setup();
  const r = tool('check', env, [URL, join(env.dir, 'drafts.json')]);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /OK 指摘 1 件/);
  assert.equal(posts(env).length, 0);
});

test('check: 違反を項目ごとの理由付きで終了コード 1 にする', () => {
  const drafts = {
    event: 'APPROVE',
    comments: [
      { path: 'src/a.js', line: 20, side: 'RIGHT', body: 'hunk の外' },
      { path: 'src/b.js', line: 11, side: 'RIGHT', body: '変更されていないファイル' },
      { path: 'img.png', line: 1, side: 'RIGHT', body: 'patch が無い' },
      { path: 'src/a.js', line: 13, side: 'RIGHT', body: 'AI と同じ位置' },
      { path: 'src/a.js', line: 12, side: 'LEFT', body: '削除側の文脈行は付けられる' },
      { path: 'src/a.js', line: 11, side: 'RIGHT', body: '' },
    ],
  };
  const env = setup({ drafts, route: { [`GET ${BASE}/reviews`]: page([{ id: 5, user: { login: 'me' }, state: 'PENDING' }]) } });
  const r = tool('check', env, [URL, join(env.dir, 'drafts.json')]);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /NG event: event は渡せない/);
  assert.match(r.out, /NG comments\[0\]: src\/a\.js:20（RIGHT）は差分の hunk の範囲外/);
  assert.match(r.out, /NG comments\[1\]: path src\/b\.js はこの PR の変更ファイルに無い/);
  assert.match(r.out, /NG comments\[2\]: img\.png の patch が無い/);
  assert.match(r.out, /NG comments\[3\]: 既存のコメント（ai-bot、u2）と同じ位置/);
  assert.doesNotMatch(r.out, /comments\[4\]/);
  assert.match(r.out, /NG comments\[5\]: body が空/);
  assert.match(r.out, /NG review: 自分の PENDING のレビュー（id 5）が既にある/);
});

test('check: 複数行の指摘は start_line が line と同じ hunk にあることを求める', () => {
  const env = setup({ drafts: { comments: [{ path: 'src/a.js', start_line: 5, line: 11, side: 'RIGHT', body: 'x' }] } });
  const r = tool('check', env, [URL, join(env.dir, 'drafts.json')]);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /start_line 5（RIGHT）が line と同じ hunk に無い/);
});

test('pending: event を送らず、検査した head の commit に PENDING のレビューを一つ作り、照合して終了コード 0', () => {
  const env = setup();
  const r = tool('pending', env, [URL, join(env.dir, 'drafts.json')]);
  assert.equal(r.status, 0, r.out);
  const ps = posts(env);
  assert.equal(ps.length, 1);
  assert.equal(ps[0].endpoint, `${BASE}/reviews`);
  const body = JSON.parse(ps[0].stdin);
  assert.equal('event' in body, false);
  assert.equal(body.commit_id, SHA);
  assert.equal(body.body, '全体の所感');
  assert.deepEqual(body.comments, [{ path: 'src/a.js', line: 11, side: 'RIGHT', body: '名前が曖昧' }]);
  assert.deepEqual(JSON.parse(r.out.trim()), { result: 'PENDING', reviewId: 99, url: `${URL}#pullrequestreview-99`, comments: 1 });
});

test('pending: 検査に落ちたら POST しない', () => {
  const env = setup({ drafts: { comments: [{ path: 'src/a.js', line: 20, side: 'RIGHT', body: 'x' }] } });
  const r = tool('pending', env, [URL, join(env.dir, 'drafts.json')]);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /検査に落ちたので、レビューを作らない/);
  assert.equal(posts(env).length, 0);
});

test('pending: drafts に event があれば検査で落ち、POST しない', () => {
  const env = setup({ drafts: { ...GOOD, event: 'COMMENT' } });
  const r = tool('pending', env, [URL, join(env.dir, 'drafts.json')]);
  assert.equal(r.status, 1, r.out);
  assert.equal(posts(env).length, 0);
});

test('pending: 取り直したコメントが下書きと食い違えば終了コード 1', () => {
  const env = setup({ route: { [`GET ${BASE}/reviews/99/comments`]: page([{ path: 'src/a.js', line: 12, side: 'RIGHT', body: '名前が曖昧' }]) } });
  const r = tool('pending', env, [URL, join(env.dir, 'drafts.json')]);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /送った指摘が 1 件に対し、レビューには 0 件: src\/a\.js:11:RIGHT/);
  assert.match(r.out, /送っていないコメントが 1 件ある: src\/a\.js:12:RIGHT/);
});

test('pending: 作られたレビューが PENDING でなければ終了コード 1', () => {
  const env = setup({ route: { [`POST ${BASE}/reviews`]: { id: 99, state: 'COMMENTED', html_url: 'x' } } });
  const r = tool('pending', env, [URL, join(env.dir, 'drafts.json')]);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /状態が PENDING でない: COMMENTED/);
});

test('gh が無ければ、入れて認証するよう伝えて終了コード 2', () => {
  const env = setup({ withGh: false });
  const r = tool('check', env, [URL, join(env.dir, 'drafts.json')]);
  assert.equal(r.status, 2);
  assert.match(r.out, /gh が見つからない/);
});

test('gh api が失敗すれば、その出力を添えて終了コード 2', () => {
  const env = setup();
  const r = tool('check', env, ['https://github.com/o/r/pull/8', join(env.dir, 'drafts.json')]);
  assert.equal(r.status, 2);
  assert.match(r.out, /gh api GET repos\/o\/r\/pulls\/8 が失敗した.*no route/);
});
