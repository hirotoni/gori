import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { test } from 'node:test';
import { recordsDir, repoRoot, testGori } from '../helpers.mjs';

const TASK = '2026-11-03-demo';
const SID = 'sess-aaaa';
const HEADER = 'time\tsession\ttype\tstep\twhat\twhy\tevidence\tresult';
const row = (time, type, what, extra = {}) => [time, extra.session ?? SID, type, extra.step ?? '-', what, extra.why ?? '-', '-', '-'].join('\t');
const AUDIT = [
  HEADER,
  row('2026-11-03T10:00:00+09:00', 'start', '目的'),
  row('2026-11-03T10:00:00+09:00', 'step', '手順一', { step: '1' }),
  row('2026-11-03T10:30:00+09:00', 'step-skip', '手順一', { step: '1', why: '不要だから' }),
  row('2026-11-03T12:00:00+09:00', 'decision', '方針を決めた'),
  row('2026-11-03T13:00:00+09:00', 'done', '完了'),
].join('\n') + '\n';

// pre-commit の中で走ると git が GIT_INDEX_FILE などを渡し、レビュアーの中で走ると CLAUDE_* や GORI_* が立っている。どれも一時リポジトリの操作と道具に漏らさない。
// 記録は一時の gori のチェックアウト（GORI_ROOT）の下の repos/<名前>/ に置き、本物の gori の記録に触れない。
const cleanEnv = (extra = {}) => ({ ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_') && !k.startsWith('CLAUDE') && !k.startsWith('GORI_'))), GORI_ROOT: testGori(), ...extra });
const run = (bin, args) => {
  const r = spawnSync(process.execPath, [join(repoRoot, 'tools', bin), ...args], { encoding: 'utf8', env: cleanEnv() });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
};

const sh = (cwd, args, env = {}) => {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: cleanEnv(env) });
  assert.equal(r.status, 0, r.stderr);
};
const put = (dir, rel, text) => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), text);
};
const commit = (dir, msg, iso) => {
  put(dir, `f-${msg}.txt`, msg);
  sh(dir, ['add', '.']);
  sh(dir, ['commit', '-q', '-m', msg], { GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso });
};

function workRepo({ audit = AUDIT } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'gori-trace-'));
  sh(dir, ['init', '-q', '-b', 'main']);
  sh(dir, ['config', 'user.name', 't']);
  sh(dir, ['config', 'user.email', 't@example.com']);
  commit(dir, '初期', '2026-11-01T09:00:00+09:00');
  sh(dir, ['checkout', '-q', '-b', TASK]);
  commit(dir, '一つ目', '2026-11-03T11:00:00+09:00');
  commit(dir, '二つ目', '2026-11-03T12:30:00+09:00');
  if (audit) put(recordsDir(dir), `audit/${TASK}.tsv`, audit);
  const v = (sha, name, body) => put(recordsDir(dir), `verdicts/${sha}/${name}.json`, JSON.stringify(body));
  v('aaa', '1', { task: TASK, sha: 'aaa', judge: 'session:j', result: 'fail', findings: ['不足がある'], evidence: [], time: '2026-11-03T11:30:00+09:00' });
  v('bbb', '2', { task: TASK, sha: 'bbb', judge: 'session:j', result: 'pass', findings: [], evidence: ['確かめた'], time: '2026-11-03T12:45:00+09:00' });
  v('ccc', '3', { task: 'other-task', sha: 'ccc', judge: 'x', result: 'pass', findings: [], evidence: ['別'], time: '2026-11-03T11:00:00+09:00' });
  return dir;
}

const J = (o) => JSON.stringify(o);
function projects() {
  const dir = mkdtempSync(join(tmpdir(), 'gori-trace-proj-'));
  const lines = [
    J({ type: 'queue-operation', timestamp: '2026-11-03T01:00:00.000Z' }),
    J({ type: 'user', uuid: 'u-1', timestamp: '2026-11-03T01:10:00.000Z', message: { role: 'user', content: '最初の依頼' } }),
    J({ type: 'assistant', uuid: 'a-1', timestamp: '2026-11-03T01:11:00.000Z', message: { content: [{ type: 'text', text: 'アシスタントの発言' }] } }),
    J({ type: 'user', uuid: 'r-1', timestamp: '2026-11-03T01:12:00.000Z', message: { content: [{ type: 'tool_result', tool_use_id: 't', content: 'ツールの結果' }] } }),
    '壊れた行',
    J({ type: 'user', uuid: 'u-2', timestamp: '2026-11-03T02:20:00.000Z', message: { content: [{ type: 'text', text: '追加の指示' }] } }),
    J({ type: 'user', uuid: 'm-1', isMeta: true, timestamp: '2026-11-03T02:21:00.000Z', message: { content: 'メタ' } }),
  ];
  put(dir, `-some-project/${SID}.jsonl`, `${lines.join('\n')}\n`);
  return dir;
}

const trace = (repo, proj, extra = []) => run('records/trace', [TASK, '--repo', repo, '--projects', proj, ...extra]);
const parse = (r) => r.out.trim().split('\n').map((l) => JSON.parse(l));
const emptyProjects = () => mkdtempSync(join(tmpdir(), 'gori-trace-empty-'));

test('作業 ID の形でなければ 2 で、新しい形を主に、古い形も受け付けると案内する', () => {
  const res = run('records/trace', ['Bad_ID']);
  assert.equal(res.status, 2);
  assert.match(res.out, /<YYYYMMDD>-<hhmmss>-<slug>.*古い形 <YYYY-MM-DD>-<slug>/);
});

test('B1: 三つの source が時刻順に並び、ref が元の場所を指す', () => {
  const repo = workRepo();
  const rows = parse(trace(repo, projects()));
  const times = rows.map((r) => Date.parse(r.time));
  assert.deepEqual(times, [...times].sort((a, b) => a - b));
  for (const r of rows) for (const k of ['time', 'source', 'kind', 'text', 'ref']) assert.ok(k in r, k);
  assert.deepEqual([...new Set(rows.map((r) => r.source))].sort(), ['audit', 'human', 'verdict']);

  const audit = rows.filter((r) => r.source === 'audit');
  assert.deepEqual(audit.map((r) => [r.kind, r.ref.line, r.session]), [['start', 2, SID], ['step', 3, SID], ['step-skip', 4, SID], ['decision', 5, SID], ['done', 6, SID]]);
  assert.equal(audit.find((r) => r.kind === 'step-skip').text, '手順一（飛ばす理由: 不要だから）');
  // start 行だけが、作業を始めた手順書（判断の記録の evidence）を procedure に持つ。
  assert.equal(audit[0].procedure, '-');
  assert.ok(audit.slice(1).every((r) => !('procedure' in r)));
  // 記録の場所は gori のチェックアウトの git の共通ディレクトリからの相対で示す。
  assert.equal(audit[0].ref.file, `gori/repos/${basename(repo)}/audit/${TASK}.tsv`);

  const verdicts = rows.filter((r) => r.source === 'verdict');
  assert.deepEqual(verdicts.map((r) => [r.kind, r.ref.sha, r.ref.file, r.text]), [
    ['fail', 'aaa', `gori/repos/${basename(repo)}/verdicts/aaa/1.json`, '不足がある'],
    ['pass', 'bbb', `gori/repos/${basename(repo)}/verdicts/bbb/2.json`, '確かめた'],
  ]);

  const human = rows.filter((r) => r.source === 'human');
  assert.deepEqual(human.map((r) => [r.text, r.ref]), [['最初の依頼', { session: SID, message: 'u-1' }], ['追加の指示', { session: SID, message: 'u-2' }]]);
  // 直前のエージェントの発言が before に添えられる。最初の発言の前にはエージェントの発言が無い。
  assert.deepEqual(human.map((r) => r.before ?? null), [null, 'アシスタントの発言']);
  // 時刻順: 人間の発言（UTC 01:10 = 10:10 JST）は start と step-skip の間に入る
  const idx = (r) => rows.indexOf(r);
  assert.ok(idx(human[0]) > idx(audit[1]) && idx(human[0]) < idx(audit[2]));
});

test('B2: 会話の記録が無くても他の source は同じ数だけ出る', () => {
  const repo = workRepo();
  const withT = parse(trace(repo, projects()));
  const without = parse(trace(repo, emptyProjects()));
  const count = (rows, s) => rows.filter((r) => r.source === s).length;
  for (const s of ['audit', 'verdict']) assert.equal(count(without, s), count(withT, s), s);
  assert.equal(count(without, 'human'), 0);
  const missing = without.filter((r) => r.source === 'meta' && r.kind === 'transcript-missing');
  assert.equal(missing.length, 1);
  assert.equal(missing[0].ref.session, SID);
  assert.equal(withT.filter((r) => r.kind === 'transcript-missing').length, 0);
});

test('B3: 人間の発言だけを拾う', () => {
  const texts = parse(trace(workRepo(), projects())).filter((r) => r.source === 'human').map((r) => r.text);
  assert.deepEqual(texts, ['最初の依頼', '追加の指示']);
});

test('B4: 判断の記録が無ければ終了コード 2', () => {
  const r = trace(workRepo({ audit: null }), projects());
  assert.equal(r.status, 2);
  assert.match(r.out, /判断の記録が無い/);
});

test('B4: --text は表を出す', () => {
  const r = trace(workRepo(), projects(), ['--text']);
  assert.equal(r.status, 0);
  const lines = r.out.trim().split('\n');
  assert.match(lines[0], /^2026-11-03T10:00:00\+09:00 {2}audit\/start {2}目的$/);
  assert.ok(lines.some((l) => /^\S+ {2}human\/message {2}最初の依頼$/.test(l)));
  assert.ok(lines.every((l) => !l.startsWith('{')));
});

test('壊れた行は飛ばさず meta unreadable で場所を示す', () => {
  const broken = AUDIT.split('\n');
  broken.splice(4, 0, 'これは壊れた行');
  const rows = parse(trace(workRepo({ audit: broken.join('\n') }), projects()));
  const bad = rows.filter((r) => r.source === 'meta' && r.kind === 'unreadable');
  assert.equal(bad.length, 1);
  assert.equal(bad[0].ref.line, 5);
  assert.equal(rows.filter((r) => r.source === 'audit').length, 5);
});

const withExtra = () => {
  const proj = projects();
  const before = J({ type: 'user', uuid: 'u-0', timestamp: '2026-11-03T00:30:00.000Z', message: { content: '前の作業の依頼' } });
  const fix = J({ type: 'user', uuid: 'u-8', timestamp: '2026-11-03T04:30:00.000Z', message: { content: '完了と言ったが違う' } });
  const next = J({ type: 'user', uuid: 'u-9', timestamp: '2026-11-03T05:00:00.000Z', message: { content: '次の作業の依頼' } });
  const file = join(proj, '-some-project', `${SID}.jsonl`);
  writeFileSync(file, `${before}\n${readFileSync(file, 'utf8')}${fix}\n${next}\n`);
  return proj;
};
const nextAudit = (session, start) => [HEADER, row(start, 'start', '次の目的', { session })].join('\n') + '\n';

test('start より前の人間の発言は拾わない', () => {
  const human = parse(trace(workRepo(), withExtra())).filter((r) => r.source === 'human');
  assert.ok(!human.some((r) => r.ref.message === 'u-0'));
  assert.deepEqual(human.slice(0, 2).map((r) => r.ref.message), ['u-1', 'u-2']);
});

test('done の後、同じセッションの次の作業の start より前の発言は afterDone を付けて拾う', () => {
  const repo = workRepo();
  put(recordsDir(repo), 'audit/2026-11-03-next.tsv', nextAudit(SID, '2026-11-03T14:30:00+09:00'));
  const human = parse(trace(repo, withExtra())).filter((r) => r.source === 'human');
  assert.deepEqual(human.map((r) => [r.ref.message, r.afterDone === true]), [['u-1', false], ['u-2', false], ['u-8', true], ['u-9', true]]);
});

test('次の作業が無ければ会話の記録の終わりまでの発言を拾う', () => {
  const human = parse(trace(workRepo(), withExtra())).filter((r) => r.source === 'human');
  assert.deepEqual(human.map((r) => r.ref.message), ['u-1', 'u-2', 'u-8', 'u-9']);
  assert.deepEqual(human.map((r) => r.afterDone === true), [false, false, true, true]);
});

test('同じセッションの次の作業の start より後の発言は拾わない', () => {
  const repo = workRepo();
  // u-8（13:30 JST）は done（13:00）の後、u-9（14:00 JST）より前に次の作業が始まる
  put(recordsDir(repo), 'audit/2026-11-03-next.tsv', nextAudit(SID, '2026-11-03T13:45:00+09:00'));
  const human = parse(trace(repo, withExtra())).filter((r) => r.source === 'human');
  assert.deepEqual(human.map((r) => r.ref.message), ['u-1', 'u-2', 'u-8']);
});

test('別のセッションの次の作業の start は期間の終わりに使わない', () => {
  const repo = workRepo();
  put(recordsDir(repo), 'audit/2026-11-03-next.tsv', nextAudit('sess-other', '2026-11-03T13:45:00+09:00'));
  const human = parse(trace(repo, withExtra())).filter((r) => r.source === 'human');
  assert.deepEqual(human.map((r) => r.ref.message), ['u-1', 'u-2', 'u-8', 'u-9']);
});

test('--text の表で done の後の発言が分かる', () => {
  const lines = trace(workRepo(), withExtra(), ['--text']).out.trim().split('\n');
  assert.ok(lines.some((l) => /human\/message\(done後\)  完了と言ったが違う$/.test(l)));
});

// 履歴を畳むと古い commit は読めなくなるので、作業の commit は出さない。
test('作業ブランチがあっても、レビュー結果の commit が手元にあっても、commit の行を出さない', () => {
  const repo = workRepo();
  const head = spawnSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8', env: cleanEnv() }).stdout.trim();
  put(recordsDir(repo), `verdicts/${head}/p.json`, J({ task: TASK, sha: head, judge: 'session:j', result: 'pass', findings: [], evidence: ['確かめた'], time: '2026-11-03T12:50:00+09:00' }));
  const rows = parse(trace(repo, projects()));
  assert.ok(rows.some((r) => r.source === 'verdict' && r.ref.sha === head));
  assert.deepEqual(rows.filter((r) => r.source === 'commit'), []);
});
