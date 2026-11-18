import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { recordsDir, repoRoot, testGori } from '../helpers.mjs';

// 事例は一時ディレクトリの git リポジトリ（その .git/gori/learning/）に、判断の記録とレビュー結果は一時の gori のチェックアウト（GORI_ROOT）の
// .git/gori/repos/<名前>/ に作り、本体の記録と学びに触れない。
// pre-commit やレビュアーの中で走っても、GIT_*、CLAUDE*、GORI_* を一時リポジトリの操作と道具に漏らさない。
const cleanEnv = (extra = {}) => ({ ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_') && !k.startsWith('CLAUDE') && !k.startsWith('GORI_'))), GORI_ROOT: testGori(), ...extra });
const temps = [];
after(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});
const tempDir = (prefix) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  assert.ok(dir && existsSync(dir) && statSync(dir).isDirectory(), `一時ディレクトリを作れない: ${dir}`);
  temps.push(dir);
  return dir;
};
const sh = (cwd, args, env = {}) => {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: cleanEnv(env) });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};
const put = (dir, rel, text) => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), text);
};
const commit = (dir, msg, iso) => {
  put(dir, `f-${msg}.txt`, msg);
  sh(dir, ['add', `f-${msg}.txt`]);
  sh(dir, ['commit', '-q', '-m', msg], { GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso });
  return sh(dir, ['rev-parse', 'HEAD']);
};

const HEADER = 'time\tsession\ttype\tstep\twhat\twhy\tevidence\tresult';
const row = (time, type, what, extra = {}) => [time, 'sess-w', type, extra.step ?? '-', what, extra.why ?? '-', extra.evidence ?? '-', '-'].join('\t');
const audit = (rows) => [HEADER, ...rows].join('\n') + '\n';
const verdict = (dir, task, sha, name, result, time, extra = {}) =>
  put(recordsDir(dir), `verdicts/${sha}/${name}.json`, JSON.stringify({ task, sha, judge: 'session:judge', result, evidence: result === 'pass' ? ['確かめた'] : [], findings: result === 'fail' ? ['不足がある'] : [], time, ...extra }));
const caseFile = (dir, id, pattern) => put(dir, `.git/gori/learning/cases/${id}.md`, `---\nid: ${id}\ntype: correction\npattern: ${pattern}\nsession: s-1\nmessage: m-${id}\nquote: "引用"\n---\n\n本文。\n`);

// 2026-11-08 は日曜日（2026-W45 の最後の日）、2026-11-09 は月曜日（2026-W46 の最初の日）、2026-11-15 は日曜日（2026-W46 の最後の日）、2026-11-16 は月曜日（2026-W47）である。
const ALPHA = '2026-11-08-alpha';
const BETA = '2026-11-09-beta';
const GAMMA = '2026-10-01-gamma';
const DELTA = '2026-10-05-delta';
function fixture() {
  const dir = tempDir('gori-metrics-');
  sh(dir, ['init', '-q', '-b', 'main']);
  sh(dir, ['config', 'user.name', 't']);
  sh(dir, ['config', 'user.email', 't@example.com']);
  commit(dir, 'init', '2026-09-01T09:00:00+09:00');

  // alpha: 不合格のレビュー結果（日曜 23:59）の後に直し、最後の commit に合格のレビュー結果（月曜 0:00）がある。
  sh(dir, ['checkout', '-q', '-b', ALPHA]);
  const a1 = commit(dir, 'a1', '2026-11-08T21:00:00+09:00');
  const a2 = commit(dir, 'a2', '2026-11-09T00:10:00+09:00');
  verdict(dir, ALPHA, a1, '1', 'fail', '2026-11-08T23:59:00+09:00');
  verdict(dir, ALPHA, a2, '2', 'pass', '2026-11-09T00:00:00+09:00');
  put(recordsDir(dir), `audit/${ALPHA}.tsv`, audit([
    row('2026-11-08T20:00:00+09:00', 'start', '目的'),
    row('2026-11-08T20:00:00+09:00', 'step', '手順一', { step: '1' }),
    row('2026-11-08T20:00:00+09:00', 'step', '手順二', { step: '2' }),
    row('2026-11-08T23:59:00+09:00', 'step-skip', '手順一', { step: '1', why: '不要' }),
    // レビュー結果を取り込んだときに判断の記録に足す行。レビュー結果の不合格として二重に数えない。
    row('2026-11-08T23:59:00+09:00', 'decision', 'レビュー結果 fail', { why: 'レビュアー session:judge', evidence: `sha=${a1} .git/gori/repos/x/verdicts/${a1}/1.json` }),
    row('2026-11-09T00:00:00+09:00', 'step-skip', '手順二', { step: '2', why: '不要' }),
    row('2026-11-09T00:20:00+09:00', 'done', '完了'),
  ]));

  // beta: 一つ目の commit にだけ不合格のレビュー結果があり、最後の commit（月曜 11:00）にレビュー結果が無い。レビュー結果の無い commit は、どの指標にも数えない。
  sh(dir, ['checkout', '-q', 'main']);
  sh(dir, ['checkout', '-q', '-b', BETA]);
  const b1 = commit(dir, 'b1', '2026-11-09T10:00:00+09:00');
  commit(dir, 'b2', '2026-11-16T11:00:00+09:00');
  verdict(dir, BETA, b1, '1', 'fail', '2026-11-09T10:30:00+09:00');
  put(recordsDir(dir), `audit/${BETA}.tsv`, audit([
    row('2026-11-09T09:00:00+09:00', 'start', '目的'),
    row('2026-11-15T23:59:00+09:00', 'decision', '止まった'),
  ]));

  // gamma と delta: step-skip もレビュー結果も無い作業は、どの指標にも数えない。
  sh(dir, ['checkout', '-q', 'main']);
  commit(dir, 'main-later', '2026-10-12T10:00:00+09:00');
  put(recordsDir(dir), `audit/${DELTA}.tsv`, audit([row('2026-10-05T09:00:00+09:00', 'start', '目的'), row('2026-10-11T23:59:00+09:00', 'decision', '途中')]));
  put(recordsDir(dir), `audit/${GAMMA}.tsv`, audit([row('2026-10-01T09:00:00+09:00', 'start', '目的'), row('2026-10-01T10:00:00+09:00', 'done', '完了')]));

  // 事例。取り消した事例は数えない。
  caseFile(dir, '2026-11-08-sunday', 'p1');
  caseFile(dir, '2026-11-09-monday', 'p1');
  caseFile(dir, '2026-11-09-another', 'p1');
  caseFile(dir, '2026-11-09-retracted', 'p2');
  put(dir, '.git/gori/learning/retractions/2026-11-09-retracted.md', '---\nid: 2026-11-09-retracted\nretracted: 2026-11-10\n---\n\n誤りだった。\n');
  return dir;
}

const metrics = (args, { cwd = tmpdir(), tz = 'Asia/Tokyo' } = {}) => {
  const r = spawnSync(process.execPath, [join(repoRoot, 'tools', 'learning', 'metrics'), ...args], { encoding: 'utf8', cwd, env: cleanEnv({ TZ: tz }) });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
};

const EXPECTED_TOKYO = [
  'week\tmetric\tkey\tcount',
  '2026-W45\tcases\tp1\t1',
  '2026-W45\tstep-skip\t-\t1',
  '2026-W45\tverdict-fail\t-\t1',
  '2026-W46\tcases\tp1\t2',
  '2026-W46\tstep-skip\t-\t1',
  '2026-W46\tverdict-fail\t-\t1',
].join('\n');

test('三つの指標を週ごとに数え、日曜 23:59 と月曜 0:00 を別の週にし、取り消した事例を除く', () => {
  const dir = fixture();
  const r = metrics(['--root', dir]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), EXPECTED_TOKYO);
});

test('step-skip は、索引の手順書から始めた作業なら手順書と手順ごとに、その場の手順書なら - にまとめて数える', () => {
  const dir = fixture();
  const STEP1 = '一二三四五六七八九十一二三四五六七八九十を超える手順の文';
  const shared = (task, start) =>
    put(recordsDir(dir), `audit/${task}.tsv`, audit([
      row(start, 'start', '目的', { evidence: 'procedures/p' }),
      row(start, 'step', STEP1, { step: '1' }),
      row(start, 'step', '手順二', { step: '2' }),
      row('2026-11-10T10:00:00+09:00', 'step-skip', STEP1, { step: '1', why: '不要' }),
      row('2026-11-10T10:00:00+09:00', 'done', '完了'),
    ]));
  shared('2026-11-10-eps', '2026-11-10T09:00:00+09:00');
  shared('2026-11-10-zeta', '2026-11-10T09:30:00+09:00');
  put(recordsDir(dir), 'audit/2026-11-10-eta.tsv', audit([
    row('2026-11-10T09:00:00+09:00', 'start', '目的', { evidence: 'stdin' }),
    row('2026-11-10T09:00:00+09:00', 'step', 'その場の手順', { step: '1' }),
    row('2026-11-10T11:00:00+09:00', 'step-skip', 'その場の手順', { step: '1', why: '不要' }),
  ]));
  const r = metrics(['--root', dir]);
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split('\n');
  assert.ok(lines.includes(`2026-W46\tstep-skip\tprocedures/p#1:${STEP1.slice(0, 20)}\t2`), r.stdout);
  // alpha（evidence が -）の一行と、eta（stdin）の一行を - にまとめる。
  assert.ok(lines.includes('2026-W46\tstep-skip\t-\t2'), r.stdout);
  assert.equal(lines.filter((l) => l.includes('step-skip')).length, 3, r.stdout);
});

test('確認できずのレビュー結果は verdict-fail に混ぜず、verdict-unverified として数える', () => {
  const dir = fixture();
  const b1 = sh(dir, ['rev-parse', `${BETA}~1`]);
  verdict(dir, BETA, b1, '2', 'unverified', '2026-11-10T09:00:00+09:00');
  const r = metrics(['--root', dir]);
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split('\n');
  assert.ok(lines.includes('2026-W46\tverdict-unverified\t-\t1'), r.stdout);
  assert.ok(lines.includes('2026-W46\tverdict-fail\t-\t1'), r.stdout);
});

test('週はローカル時刻で決める。UTC では月曜 0:00（+09:00）が前の週の日曜になる', () => {
  const dir = fixture();
  const r = metrics(['--root', dir], { tz: 'UTC' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(
    r.stdout.trim(),
    [
      'week\tmetric\tkey\tcount',
      '2026-W45\tcases\tp1\t1',
      '2026-W45\tstep-skip\t-\t2',
      '2026-W45\tverdict-fail\t-\t1',
      '2026-W46\tcases\tp1\t2',
      '2026-W46\tverdict-fail\t-\t1',
    ].join('\n'),
  );
});

test('--root を省いても --root に worktree を渡しても、worktree から呼べば本体のチェックアウトと同じ記録と事例を数える', () => {
  const dir = fixture();
  const wt = join(tempDir('gori-metrics-wt-'), 'wt');
  sh(dir, ['worktree', 'add', '-q', '-b', 'side', wt]);
  const fromWt = metrics([], { cwd: wt });
  assert.equal(fromWt.status, 0, fromWt.stderr);
  assert.equal(fromWt.stdout.trim(), EXPECTED_TOKYO);
  const rootWt = metrics(['--root', wt]);
  assert.equal(rootWt.status, 0, rootWt.stderr);
  assert.equal(rootWt.stdout.trim(), EXPECTED_TOKYO);
  assert.equal(realpathSync(dir), realpathSync(sh(wt, ['worktree', 'list', '--porcelain']).split('\n')[0].slice('worktree '.length)));
});

test('--text は同じ数を人間向けの表にする', () => {
  const dir = fixture();
  const r = metrics(['--root', dir, '--text']);
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trimEnd().split('\n');
  assert.match(lines[0], /^週\s+指標\s+key\s+数$/);
  assert.equal(lines.length, EXPECTED_TOKYO.split('\n').length);
  assert.match(lines.at(-1), /^2026-W46\s+verdict-fail\s+-\s+1$/);
  assert.match(lines[1], /^2026-W45\s+cases\s+p1\s+1$/);
});

test('記録も事例も無ければ見出しだけを出す', () => {
  const dir = tempDir('gori-metrics-empty-');
  sh(dir, ['init', '-q', '-b', 'main']);
  const r = metrics(['--root', dir]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), 'week\tmetric\tkey\tcount');
});

test('読めない引数は使い方を出して終了コード 2', () => {
  const r = metrics(['--bogus']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /使い方/);
});

test('軽い重さで受けたレビュー結果を review-light として数え、重さの無い古いレビュー結果は数えない', () => {
  const dir = fixture();
  const b1 = sh(dir, ['rev-parse', `${BETA}~1`]);
  verdict(dir, BETA, b1, '3', 'pass', '2026-11-10T09:00:00+09:00', { weight: 'light' });
  verdict(dir, BETA, b1, '4', 'pass', '2026-11-17T09:00:00+09:00', { weight: 'normal' });
  const r = metrics(['--root', dir]);
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split('\n');
  assert.deepEqual(lines.filter((l) => l.includes('review-light')), ['2026-W46\treview-light\t-\t1'], r.stdout);
});

// --learnings の材料。プールは一時の gori のチェックアウトの .git/gori/repos/<名前>/pool に置く。
const poolItem = (dir, id, fields) =>
  put(recordsDir(dir), `pool/${id}.md`, `---\nid: ${id}\ntitle: "題"\n${Object.entries({ created: '2026-11-01T09:00:00+09:00', updated: '2026-11-01T09:00:00+09:00', ...fields }).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n## 現状\n-\n## 問題\n-\n## 期待する結果\n-\n## 確認したこと\n-\n## 受け入れ条件\n- 条件\n`);
function learningFixture() {
  const dir = tempDir('gori-metrics-learn-');
  sh(dir, ['init', '-q', '-b', 'main']);
  sh(dir, ['config', 'user.name', 't']);
  sh(dir, ['config', 'user.email', 't@example.com']);
  const applied = commit(dir, 'apply', '2026-11-01T08:00:00+09:00');
  // done にした時刻（updated）は、ローカル時刻（Asia/Tokyo）で 2026-11-10。UTC では 2026-11-09。
  const updated = '2026-11-10T08:00:00+09:00';
  caseFile(dir, '2026-11-08-p1', 'p1');
  caseFile(dir, '2026-11-09-p1', 'p1');
  caseFile(dir, '2026-11-10-p1', 'p1');
  caseFile(dir, '2026-11-12-p1', 'p1');
  caseFile(dir, '2026-11-13-p1-retracted', 'p1');
  put(dir, '.git/gori/learning/retractions/2026-11-13-p1-retracted.md', '---\nid: 2026-11-13-p1-retracted\nretracted: 2026-11-14\n---\n\n誤りだった。\n');
  caseFile(dir, '2026-11-11-p2', 'p2');
  // 見た日数は、取り消していない全事例の最も新しい日付（2026-11-12）から数える。
  poolItem(dir, '20261101-090000-learn-done', { kind: 'learning', status: 'done', pattern: 'p1', commit: applied, updated });
  poolItem(dir, '20261101-090001-learn-todo', { kind: 'learning', status: 'todo', pattern: 'p1' });
  poolItem(dir, '20261101-090002-improve-done', { kind: 'improvement', status: 'done', commit: applied });
  // commit が手元に無くても（履歴を畳んだ後）、適用日は updated から決まる。
  poolItem(dir, '20261101-090003-learn-gone-commit', { kind: 'learning', status: 'done', pattern: 'p2', commit: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef', updated });
  poolItem(dir, '20261101-090005-learn-bad-updated', { kind: 'learning', status: 'done', pattern: 'p2', commit: applied, updated: 'いつか' });
  poolItem(dir, '20261101-090004-learn-no-pattern', { kind: 'learning', status: 'done', commit: applied });
  return dir;
}

test('--learnings は done の学びごとに、適用日の前・当日・後の事例の件数と見た日数を出し、取り消した事例を除く', () => {
  const dir = learningFixture();
  const r = metrics(['--root', dir, '--learnings']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(
    r.stdout.trim(),
    [
      'id\tpattern\tapplied\tbefore\tsame\tafter\tlast-after\tdays',
      '20261101-090000-learn-done\tp1\t2026-11-10\t2\t1\t1\t2026-11-12\t2',
      '20261101-090003-learn-gone-commit\tp2\t2026-11-10\t0\t0\t1\t2026-11-11\t2',
    ].join('\n'),
  );
  // updated を読めない一件と pattern の無い一件は出さず、注意を出す。todo の学びと improvement は黙って数えない。
  assert.match(r.stderr, /20261101-090005-learn-bad-updated の updated「いつか」を読めない/);
  assert.doesNotMatch(r.stderr, /learn-gone-commit/);
  assert.match(r.stderr, /20261101-090004-learn-no-pattern に pattern が無い/);
  assert.doesNotMatch(r.stderr, /learn-todo|improve-done/);
});

test('--learnings の適用日はローカル時刻の日付で決める', () => {
  const dir = learningFixture();
  const r = metrics(['--root', dir, '--learnings'], { tz: 'UTC' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /learn-done\tp1\t2026-11-09\t1\t1\t2\t2026-11-12\t3/);
});

test('--learnings と --text は表で出し、適用した学びが無ければそう出す', () => {
  const dir = learningFixture();
  const r = metrics(['--root', dir, '--learnings', '--text']);
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trimEnd().split('\n');
  assert.match(lines[0], /^学び\s+pattern\s+適用日\s+前\s+当日\s+後\s+後の最後\s+見た日数$/);
  assert.match(lines[1], /^20261101-090000-learn-done\s+p1\s+2026-11-10\s+2\s+1\s+1\s+2026-11-12\s+2$/);
  const empty = tempDir('gori-metrics-learn-empty-');
  sh(empty, ['init', '-q', '-b', 'main']);
  const e = metrics(['--root', empty, '--learnings', '--text']);
  assert.equal(e.status, 0, e.stderr);
  assert.match(e.stdout, /（適用した学びが無い）/);
});

test('--learnings を付けなければ、プールに学びがあっても週ごとの出力は変わらない', () => {
  const dir = fixture();
  poolItem(dir, '20261101-090000-learn-done', { kind: 'learning', status: 'done', pattern: 'p1', commit: sh(dir, ['rev-parse', 'main']) });
  const r = metrics(['--root', dir]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), EXPECTED_TOKYO);
});
