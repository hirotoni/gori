import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test } from 'node:test';
import { recordsDir, repoRoot, testGori } from '../helpers.mjs';

// pre-commit の中で走ると git が GIT_INDEX_FILE などを渡し、レビュアーの中で走ると CLAUDE_* や GORI_* が立っている。どれも一時リポジトリの操作と道具に漏らさない。
// 記録は一時の gori のチェックアウト（GORI_ROOT）の下に書かせ、本物の gori の記録に触れない。
const cleanEnv = (extra = {}) => ({ ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_') && !k.startsWith('CLAUDE') && !k.startsWith('GORI_'))), GORI_ROOT: testGori(), ...extra });
const LOG = join(repoRoot, 'tools', 'records', 'log');
const ID = '20261103-100000-demo';

function gitRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'gori-log-'));
  const g = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8', env: cleanEnv() });
  g('init', '-q');
  g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init');
  return { dir, g };
}

function log(dir, args, env = {}) {
  const e = cleanEnv({ CLAUDE_SESSION_ID: '', CLAUDE_CODE_SESSION_ID: '', ...env });
  const r = spawnSync(process.execPath, [LOG, ...args], { cwd: dir, encoding: 'utf8', env: e });
  return { status: r.status, out: `${r.stdout}${r.stderr}`, stdout: r.stdout };
}

// 記録は作業ツリーでなく gori のチェックアウトの .git/gori/repos/<本体の名前>/ に置く。
const file = (dir) => join(recordsDir(dir), 'audit', `${ID}.tsv`);
const started = () => {
  const r = gitRepo();
  assert.equal(log(r.dir, ['start', '--task', ID, '--what', '目的']).status, 0);
  return r;
};

test('start はヘッダと start 行を書き、check を通る', () => {
  const { dir } = started();
  const lines = readFileSync(file(dir), 'utf8').trimEnd().split('\n');
  assert.equal(lines[0], 'time\tsession\ttype\tstep\twhat\twhy\tevidence\tresult');
  assert.equal(lines.length, 2);
  assert.equal(lines[1].split('\t')[2], 'start');
  assert.equal(log(dir, ['check', file(dir)]).status, 0);
});

test('start は記録を作業ツリーの外に書き、exclude を変えず、追跡対象を汚さない', () => {
  const { dir, g } = started();
  log(dir, ['start', '--task', '20261103-100000-other', '--what', '別']);
  assert.ok(existsSync(join(recordsDir(dir), 'audit', '20261103-100000-other.tsv')));
  assert.equal(existsSync(join(dir, '.gori')), false);
  const exclude = join(dir, '.git', 'info', 'exclude');
  assert.doesNotMatch(existsSync(exclude) ? readFileSync(exclude, 'utf8') : '', /gori/);
  assert.equal(g('status', '--porcelain').stdout.trim(), '');
});

test('start は同内容なら成功し、違う内容なら失敗する', () => {
  const { dir } = started();
  assert.equal(log(dir, ['start', '--task', ID, '--what', '目的']).status, 0);
  assert.equal(log(dir, ['start', '--task', ID, '--what', '別の目的']).status, 1);
  assert.equal(readFileSync(file(dir), 'utf8').trimEnd().split('\n').length, 2);
});

test('不正な作業 ID は拒否する', () => {
  const { dir } = gitRepo();
  assert.equal(log(dir, ['start', '--task', 'Bad_ID', '--what', 'x']).status, 2);
});

// 作業 ID は <YYYYMMDD>-<hhmmss>-<slug>。新しく始める作業の ID は start --slug で道具が発行する。
const NEW_FORM = /^\d{8}-\d{6}-demo$/;
test('start --slug は今の時刻で作業 ID を発行し、最終行に TASK_ID= を出し、その ID の記録を作る', () => {
  const { dir } = gitRepo();
  const before = Date.now();
  const r = log(dir, ['start', '--slug', 'demo', '--what', '目的']);
  assert.equal(r.status, 0, r.out);
  const last = r.stdout.trimEnd().split('\n').at(-1);
  const m = /^TASK_ID=(.+)$/.exec(last);
  assert.ok(m, last);
  const id = m[1];
  assert.match(id, NEW_FORM);
  const [, d, t] = /^(\d{8})-(\d{6})-/.exec(id);
  const issued = new Date(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6), +t.slice(0, 2), +t.slice(2, 4), +t.slice(4)).getTime();
  assert.ok(issued >= Math.floor(before / 1000) * 1000 - 1000 && issued <= Date.now(), `${id} が今の時刻でない`);
  const audit = join(recordsDir(dir), 'audit', `${id}.tsv`);
  assert.ok(existsSync(audit));
  assert.equal(readFileSync(audit, 'utf8').trimEnd().split('\n')[1].split('\t')[2], 'start');
  assert.equal(log(dir, ['add', '--task', id, '--type', 'decision', '--what', 'x']).status, 0);
  assert.equal(log(dir, ['check', audit]).status, 0);
});

test('start --task に新しい形の ID を渡せば通り、最終行に TASK_ID= を出す', () => {
  const { dir } = gitRepo();
  const r = log(dir, ['start', '--task', '20261108-103015-demo', '--what', '目的']);
  assert.equal(r.status, 0, r.out);
  assert.equal(r.stdout.trimEnd().split('\n').at(-1), 'TASK_ID=20261108-103015-demo');
  assert.ok(existsSync(join(recordsDir(dir), 'audit', '20261108-103015-demo.tsv')));
  const again = log(dir, ['start', '--task', '20261108-103015-demo', '--what', '目的']);
  assert.equal(again.status, 0);
  assert.equal(again.stdout.trimEnd().split('\n').at(-1), 'TASK_ID=20261108-103015-demo');
});

test('start --task に古い形の ID を渡すと 2 で、--slug で発行させるよう案内する。記録は作らない', () => {
  const { dir } = gitRepo();
  const r = log(dir, ['start', '--task', '2026-11-08-old', '--what', '目的']);
  assert.equal(r.status, 2);
  assert.match(r.out, /--slug/);
  assert.match(r.out, /<YYYYMMDD>-<hhmmss>-<slug>/);
  assert.equal(existsSync(join(recordsDir(dir), 'audit', '2026-11-08-old.tsv')), false);
});

test('start は --task と --slug の両方、どちらも無し、不正な slug を 2 で拒む', () => {
  const { dir } = gitRepo();
  const both = log(dir, ['start', '--task', '20261108-103015-demo', '--slug', 'demo', '--what', '目的']);
  assert.equal(both.status, 2);
  assert.match(both.out, /--slug/);
  const none = log(dir, ['start', '--what', '目的']);
  assert.equal(none.status, 2);
  assert.match(none.out, /--slug/);
  assert.equal(log(dir, ['start', '--slug', 'Bad_Slug', '--what', '目的']).status, 2);
  assert.equal(log(dir, ['start', '--slug', '', '--what', '目的']).status, 2);
  assert.equal(existsSync(join(recordsDir(dir), 'audit')), false);
});

test('古い形の作業 ID の記録にも add、check、state が今までどおり動く', () => {
  const { dir } = gitRepo();
  const old = '2026-11-03-legacy';
  const audit = join(recordsDir(dir), 'audit', `${old}.tsv`);
  mkdirSync(join(recordsDir(dir), 'audit'), { recursive: true });
  writeFileSync(audit, 'time\tsession\ttype\tstep\twhat\twhy\tevidence\tresult\n2026-11-03T10:00:00+09:00\ts\tstart\t-\t目的\t-\t-\t-\n');
  assert.equal(log(dir, ['add', '--task', old, '--type', 'decision', '--what', '決めた']).status, 0);
  assert.equal(log(dir, ['check', audit]).status, 0);
  const st = log(dir, ['state', '--task', old]);
  assert.equal(st.status, 0, st.out);
  assert.match(st.out, /決めた/);
  assert.equal(readFileSync(audit, 'utf8').trimEnd().split('\n').length, 3);
});

test('newTaskId は <YYYYMMDD>-<hhmmss>-<slug> をローカル時刻で作り、TASK_ID と NEW_TASK_ID に当たる。不正な slug は投げる', async () => {
  const { newTaskId, NEW_TASK_ID, TASK_ID } = await import(join(repoRoot, 'tools', 'lib', 'audit.mjs'));
  const id = newTaskId('proj-123-login-timeout', new Date(2026, 10, 8, 10, 30, 15));
  assert.equal(id, '20261108-103015-proj-123-login-timeout');
  assert.ok(NEW_TASK_ID.test(id) && TASK_ID.test(id));
  assert.ok(TASK_ID.test('2026-11-08-old') && !NEW_TASK_ID.test('2026-11-08-old'));
  for (const bad of ['20261108-1030-x', '20261108-103015-', '20261108-103015-X', '2026-11-08-X', 'x', '20261108-103015-a--b']) assert.equal(TASK_ID.test(bad), false, bad);
  assert.throws(() => newTaskId('Bad'));
  assert.throws(() => newTaskId(''));
});

test('add は値の中のタブと改行を空白にし、空の列に - を入れる', () => {
  const { dir } = started();
  assert.equal(log(dir, ['add', '--task', ID, '--type', 'decision', '--what', 'a\tb\nc']).status, 0);
  const cells = readFileSync(file(dir), 'utf8').trimEnd().split('\n').at(-1).split('\t');
  assert.equal(cells.length, 8);
  assert.equal(cells[4], 'a b c');
  assert.equal(cells[3], '-');
});

test('session は環境変数と既定の - だけで決まる。--session では名乗れない（知らないフラグとして断る）', () => {
  const { dir } = started();
  log(dir, ['add', '--task', ID, '--type', 'decision', '--what', 'x']);
  const flagged = log(dir, ['add', '--task', ID, '--type', 'decision', '--what', 'x', '--session', 'from-flag']);
  assert.equal(flagged.status, 2, flagged.out);
  assert.match(flagged.out, /知らないフラグ --session/);
  log(dir, ['add', '--task', ID, '--type', 'decision', '--what', 'x'], { CLAUDE_SESSION_ID: 'from-env' });
  log(dir, ['add', '--task', ID, '--type', 'decision', '--what', 'x'], { CLAUDE_CODE_SESSION_ID: 'from-code-env' });
  const sessions = readFileSync(file(dir), 'utf8').trimEnd().split('\n').slice(2).map((l) => l.split('\t')[1]);
  assert.deepEqual(sessions, ['-', 'from-env', 'from-code-env']);
});

test('log は、知らないフラグと値の無いフラグを、行を足さずに 2 で断り、使い方を示す', () => {
  const { dir } = started();
  const before = readFileSync(file(dir), 'utf8');
  const typo = log(dir, ['add', '--task', ID, '--type', 'decision', '--what', 'x', '--evidnce', 'y']);
  assert.equal(typo.status, 2, typo.out);
  assert.match(typo.out, /知らないフラグ --evidnce/);
  assert.match(typo.out, /使い方: log start\|add\|check\|state/);
  for (const args of [['add', '--task', ID, '--type', 'decision', '--what'], ['add', '--task', ID, '--type', 'decision', '--what', '--evidence', 'y']]) {
    const r = log(dir, args);
    assert.equal(r.status, 2, r.out);
    assert.match(r.out, /--what に値が無い/);
  }
  assert.equal(readFileSync(file(dir), 'utf8'), before);
  // 値は -- で始まる文でもよい。
  assert.equal(log(dir, ['add', '--task', ID, '--type', 'decision', '--what', '--- 区切りの後を読む']).status, 0);
});

test('add は start を受け付けず、ファイルが無ければ失敗する', () => {
  const { dir } = started();
  assert.equal(log(dir, ['add', '--task', ID, '--type', 'start', '--what', 'x']).status, 2);
  assert.equal(log(dir, ['add', '--task', '2026-11-03-none', '--type', 'decision', '--what', 'x']).status, 1);
});

test('done の後の add は after-done で拒否され、ファイルは変わらない', () => {
  const { dir } = started();
  log(dir, ['add', '--task', ID, '--type', 'done', '--what', '終わり']);
  const before = readFileSync(file(dir), 'utf8');
  const r = log(dir, ['add', '--task', ID, '--type', 'decision', '--what', 'x']);
  assert.equal(r.status, 1);
  assert.match(r.out, /:\d+: after-done: /);
  assert.equal(readFileSync(file(dir), 'utf8'), before);
});

test('fix は実在の行番号を含まなければ拒否される', () => {
  const { dir } = started();
  assert.equal(log(dir, ['add', '--task', ID, '--type', 'fix', '--what', '直した']).status, 1);
  assert.equal(log(dir, ['add', '--task', ID, '--type', 'fix', '--what', '行 9 を訂正']).status, 1);
  assert.equal(log(dir, ['add', '--task', ID, '--type', 'fix', '--what', '行 2 を訂正: 目的は別']).status, 0);
});

test('accept は step 列 - で記録でき、check を通る。done の後は拒まれる', () => {
  const { dir } = started();
  assert.equal(log(dir, ['add', '--task', ID, '--type', 'accept', '--what', '引数があれば挨拶する']).status, 0);
  assert.match(readFileSync(file(dir), 'utf8'), /\taccept\t-\t引数があれば挨拶する\t-\t-\t-\n/);
  assert.equal(log(dir, ['check', file(dir)]).status, 0);
  assert.equal(log(dir, ['add', '--task', ID, '--type', 'accept']).status, 2);
  log(dir, ['add', '--task', ID, '--type', 'done', '--what', '終わり']);
  const r = log(dir, ['add', '--task', ID, '--type', 'accept', '--what', '後から']);
  assert.equal(r.status, 1);
  assert.match(r.out, /after-done/);
});

const header = 'time\tsession\ttype\tstep\twhat\twhy\tevidence\tresult';
const row = (time, type, what = 'x') => [time, 's', type, '-', what, '-', '-', '-'].join('\t');
const T1 = '2026-11-03T10:00:00+09:00';
const T2 = '2026-11-03T10:00:05+09:00';

const violations = [
  ['bad-header', [`time\tsession`, row(T1, 'start')]],
  ['column-count', [header, row(T1, 'start'), 'a\tb\tc']],
  ['empty-field', [header, row(T1, 'start'), [T2, 's', 'decision', '-', '', '-', '-', '-'].join('\t')]],
  ['bad-type', [header, row(T1, 'start'), row(T2, 'note')]],
  ['bad-time', [header, row(T1, 'start'), row('2026-11-03 10:00', 'decision')]],
  ['start-position', [header, row(T1, 'decision')]],
  ['start-position', [header, row(T1, 'start'), row(T2, 'start')]],
  ['time-order', [header, row(T2, 'start'), row(T1, 'decision')]],
  ['after-done', [header, row(T1, 'start'), row(T1, 'done'), row(T2, 'decision')]],
  ['fix-target', [header, row(T1, 'start'), row(T2, 'fix', '行 5 を訂正')]],
];

test('check は「行 N を取り下げ」の fix 行を通し、範囲の外の行を指す取り下げを fix-target で落とす', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gori-log-'));
  const f = join(dir, 'x.tsv');
  writeFileSync(f, `${[header, row(T1, 'start'), row(T1, 'accept', '条件'), row(T2, 'fix', '行 3 を取り下げ: 方針が変わった')].join('\n')}\n`);
  assert.equal(log(dir, ['check', f]).status, 0);
  writeFileSync(f, `${[header, row(T1, 'start'), row(T2, 'fix', '行 5 を取り下げ: 方針が変わった')].join('\n')}\n`);
  const r = log(dir, ['check', f]);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /fix-target/);
});

for (const [rule, lines] of violations) {
  test(`check は ${rule} を名指しで落とす`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'gori-log-'));
    const f = join(dir, 'x.tsv');
    writeFileSync(f, `${lines.join('\n')}\n`);
    const r = log(dir, ['check', f]);
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, new RegExp(`x\\.tsv:\\d+: ${rule}: `));
  });
}

test('state は pause の内容と SHA の一致を示し、HEAD が動くと不一致を示す', () => {
  const { dir, g } = started();
  log(dir, ['add', '--task', ID, '--type', 'pause', '--what', '手順 3', '--why', '時間切れ', '--result', 'c.txt']);
  let s = JSON.parse(log(dir, ['state', '--task', ID, '--json']).stdout);
  assert.equal(s.pause.what, '手順 3');
  assert.equal(s.pause.result, 'c.txt');
  assert.equal(s.shaMatch, true);
  assert.equal(s.done, false);
  g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'next');
  s = JSON.parse(log(dir, ['state', '--task', ID, '--json']).stdout);
  assert.equal(s.shaMatch, false);
  assert.match(log(dir, ['state', '--task', ID]).out, /SHA: 不一致/);
});

test('state は pause 以降の行と done を示す', () => {
  const { dir } = started();
  log(dir, ['add', '--task', ID, '--type', 'pause', '--what', 'n']);
  log(dir, ['add', '--task', ID, '--type', 'resume', '--what', 'r']);
  log(dir, ['add', '--task', ID, '--type', 'done', '--what', 'd']);
  const s = JSON.parse(log(dir, ['state', '--task', ID, '--json']).stdout);
  assert.deepEqual(s.after.map((r) => r.type), ['resume', 'done']);
  assert.equal(s.done, true);
});

test('resume の evidence に、記録した SHA と現在の HEAD の照合結果が入る', () => {
  const { dir, g } = started();
  log(dir, ['add', '--task', ID, '--type', 'pause', '--what', 'n']);
  g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'next');
  log(dir, ['add', '--task', ID, '--type', 'resume', '--what', 'r']);
  const last = readFileSync(file(dir), 'utf8').trimEnd().split('\n').at(-1).split('\t');
  assert.match(last[6], /不一致/);
});

// EnterWorktree に入れず cwd が本体のチェックアウトのまま進んだ作業を模す。作業 ID のブランチの worktree に commit を一つ足す。
function withTaskWorktree() {
  const r = started();
  const wt = join(mkdtempSync(join(tmpdir(), 'gori-log-wt-')), 'wt');
  r.g('worktree', 'add', '-q', '-b', ID, wt);
  spawnSync('git', ['-C', wt, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'work'], { env: cleanEnv() });
  const head = (d, ...a) => spawnSync('git', ['-C', d, 'rev-parse', ...a, 'HEAD'], { encoding: 'utf8', env: cleanEnv() }).stdout.trim();
  return { ...r, wt, head };
}

test('cwd が本体のチェックアウトでも、作業 ID のブランチの worktree があれば pause の sha と branch はその worktree を指す', () => {
  const { dir, wt, head } = withTaskWorktree();
  assert.notEqual(head(wt), head(dir));
  assert.equal(log(dir, ['add', '--task', ID, '--type', 'pause', '--what', 'n']).status, 0);
  const pause = readFileSync(file(dir), 'utf8').trimEnd().split('\n').at(-1).split('\t');
  assert.match(pause[6], new RegExp(`sha=${head(wt)} branch=${ID} `));
  assert.ok(!existsSync(join(wt, '.gori')), '記録が worktree に書かれた');
  const s = JSON.parse(log(dir, ['state', '--task', ID, '--json']).stdout);
  assert.equal(s.shaMatch, true);
  assert.deepEqual(s.head, { sha: head(wt), branch: ID });
  assert.equal(JSON.parse(log(wt, ['state', '--task', ID, '--json']).stdout).shaMatch, true);
  log(dir, ['add', '--task', ID, '--type', 'resume', '--what', 'r']);
  assert.match(readFileSync(file(dir), 'utf8').trimEnd().split('\n').at(-1).split('\t')[6], /現在 sha=\S+ 一致$/);
});

test('作業 ID のブランチの worktree の場所が消えていれば、標準エラーで知らせて cwd の作業ツリーを使う', () => {
  const { dir, wt, head } = withTaskWorktree();
  rmSync(wt, { recursive: true, force: true });
  const res = log(dir, ['add', '--task', ID, '--type', 'pause', '--what', 'n']);
  assert.equal(res.status, 0, res.out);
  assert.equal(res.out.match(/警告: 作業 ID \S+ のブランチの worktree \S+ が無い/g)?.length, 1, res.out);
  assert.match(readFileSync(file(dir), 'utf8').trimEnd().split('\n').at(-1).split('\t')[6], new RegExp(`sha=${head(dir)} `));
});

test('--repo と GORI_WORK_REPO は、作業 ID の worktree より優先する', () => {
  const { dir, head } = withTaskWorktree();
  log(dir, ['add', '--task', ID, '--type', 'pause', '--what', 'n', '--repo', dir]);
  log(dir, ['add', '--task', ID, '--type', 'pause', '--what', 'n'], { GORI_WORK_REPO: dir });
  const rows = readFileSync(file(dir), 'utf8').trimEnd().split('\n').slice(-2).map((l) => l.split('\t')[6]);
  for (const ev of rows) assert.match(ev, new RegExp(`sha=${head(dir)} branch=${head(dir, '--abbrev-ref')} `));
});

const PROC = `---
id: x
---
## 対象

a

## 手順

1. 最初の項目。
2. 複数行の項目は
   空白でつなぐ。
3. 最後の項目。

## 報告

b
`;

// その場の手順書は、ファイルに置かず標準入力で渡す。
function withProcedure(text = PROC) {
  const r = gitRepo();
  return { ...r, input: text };
}
const logIn = (dir, args, input) => {
  const r = spawnSync(process.execPath, [LOG, ...args], { cwd: dir, encoding: 'utf8', input, env: cleanEnv({ CLAUDE_SESSION_ID: '', CLAUDE_CODE_SESSION_ID: '' }) });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
};
const rowsOf = (dir) => readFileSync(file(dir), 'utf8').trimEnd().split('\n').slice(1).map((l) => l.split('\t'));
const START_P = ['start', '--task', ID, '--what', '目的', '--procedure', '-'];

test('start --procedure -（標準入力）は「## 手順」の各項目を step 行として一行ずつ書き、start 行の evidence を stdin にし、作業ツリーにも exclude にも何も足さない', () => {
  const { dir, input, g } = withProcedure();
  assert.equal(logIn(dir, START_P, input).status, 0);
  assert.equal(rowsOf(dir)[0][6], 'stdin');
  assert.equal(existsSync(join(dir, '.gori')), false);
  assert.equal(g('status', '--porcelain').stdout.trim(), '');
  const rows = rowsOf(dir);
  assert.deepEqual(rows.map((r) => [r[2], r[3], r[4]]), [
    ['start', '-', '目的'],
    ['step', '1', '最初の項目。'],
    ['step', '2', '複数行の項目は 空白でつなぐ。'],
    ['step', '3', '最後の項目。'],
  ]);
  assert.equal(log(dir, ['check', file(dir)]).status, 0);
});

test('start --procedure は手順の中の ${CLAUDE_PLUGIN_ROOT} を gori の実際の位置に置き換えて写す', () => {
  const { dir, input } = withProcedure(PROC.replace('最初の項目。', '`${CLAUDE_PLUGIN_ROOT}/tools/records/log` を使う。'));
  assert.equal(logIn(dir, START_P, input).status, 0);
  const step1 = rowsOf(dir).find((r) => r[2] === 'step' && r[3] === '1')[4];
  assert.equal(step1, `\`${LOG}\` を使う。`);
});

test('start --procedure（参照キー）は gori の knowledge/ から手順書を解決する', () => {
  const tools = mkdtempSync(join(tmpdir(), 'gori-root-'));
  cpSync(join(repoRoot, 'tools'), join(tools, 'tools'), { recursive: true });
  cpSync(join(repoRoot, 'tests', 'knowledge', 'fixtures', 'ok', 'knowledge'), join(tools, 'knowledge'), { recursive: true });
  const { dir } = gitRepo();
  const r = spawnSync(process.execPath, [join(tools, 'tools', 'records', 'log'), 'start', '--task', ID, '--what', '目的', '--procedure', 'procedures/bug-fix'], { cwd: dir, encoding: 'utf8', env: cleanEnv() });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(rowsOf(dir).filter((x) => x[2] === 'step').map((x) => x[3]), ['1', '2']);
});

test('start --procedure は手順書が無い、または手順が番号付きリストでないと失敗し、ファイルを作らない', () => {
  const { dir, input } = withProcedure('## 手順\n\n前提を確かめる。\n');
  const r = logIn(dir, START_P, input);
  assert.equal(r.status, 1);
  assert.match(r.out, /番号付きリスト/);
  assert.equal(logIn(dir, START_P, '').status, 1);
  // ファイルのパスは受け取らない。その場の手順書は標準入力で渡す。
  assert.equal(log(dir, ['start', '--task', ID, '--what', 'x', '--procedure', '.gori/procedures/none.md']).status, 2);
  assert.equal(log(dir, ['start', '--task', ID, '--what', 'x', '--procedure', 'procedures/none']).status, 1);
  assert.equal(existsSync(file(dir)), false);
});

test('start --procedure を同じ内容でやり直しても step 行は増えない', () => {
  const { dir, input } = withProcedure();
  logIn(dir, START_P, input);
  assert.equal(logIn(dir, START_P, input).status, 0);
  assert.equal(rowsOf(dir).length, 4);
});

test('add は step を受け付けず、step-done と step-skip は --step を要し、step-skip は --why を要する', () => {
  const { dir, input } = withProcedure();
  logIn(dir, START_P, input);
  assert.equal(log(dir, ['add', '--task', ID, '--type', 'step', '--what', 'x', '--step', '9']).status, 2);
  assert.equal(log(dir, ['add', '--task', ID, '--type', 'step-done']).status, 2);
  assert.equal(log(dir, ['add', '--task', ID, '--type', 'step-skip', '--step', '2']).status, 2);
  assert.equal(log(dir, ['add', '--task', ID, '--type', 'step-skip', '--step', '2', '--why', '不要']).status, 0);
  assert.equal(log(dir, ['add', '--task', ID, '--type', 'step-done', '--step', '1', '--evidence', 'e', '--result', 'r']).status, 0);
  const last = rowsOf(dir).at(-1);
  assert.deepEqual([last[2], last[3], last[4], last[6], last[7]], ['step-done', '1', '最初の項目。', 'e', 'r']);
});

test('存在しない番号への step-done は step-unknown で拒否される', () => {
  const { dir, input } = withProcedure();
  logIn(dir, START_P, input);
  const r = log(dir, ['add', '--task', ID, '--type', 'step-done', '--step', '7']);
  assert.equal(r.status, 1);
  assert.match(r.out, /step-unknown/);
});

test('残っている step があると done は step-unfinished で拒否され、片付ければ書ける', () => {
  const { dir, input } = withProcedure();
  logIn(dir, START_P, input);
  log(dir, ['add', '--task', ID, '--type', 'step-done', '--step', '1']);
  const r = log(dir, ['add', '--task', ID, '--type', 'done', '--what', '終わり']);
  assert.equal(r.status, 1);
  assert.match(r.out, /step-unfinished: step 2、3 /);
  log(dir, ['add', '--task', ID, '--type', 'step-skip', '--step', '2', '--why', 'r']);
  log(dir, ['add', '--task', ID, '--type', 'step-done', '--step', '3']);
  assert.equal(log(dir, ['add', '--task', ID, '--type', 'done', '--what', '終わり']).status, 0);
});

test('state は残りの step を出し、pause の result を書かなくても分かる', () => {
  const { dir, input } = withProcedure();
  logIn(dir, START_P, input);
  log(dir, ['add', '--task', ID, '--type', 'step-done', '--step', '1']);
  log(dir, ['add', '--task', ID, '--type', 'pause', '--what', '手順 2', '--why', '時間切れ']);
  const s = JSON.parse(log(dir, ['state', '--task', ID, '--json']).stdout);
  assert.deepEqual(s.remainingSteps.map((x) => x.step), ['2', '3']);
  assert.equal(s.pause.result, '-');
  assert.deepEqual(s.after, []);
  const text = log(dir, ['state', '--task', ID]).out;
  assert.match(text, /残りの手順/);
  assert.match(text, /2\. 複数行の項目は 空白でつなぐ。/);
  assert.doesNotMatch(text, /1\. 最初の項目/);
});

const srow = (time, type, step = '-', why = '-') => [time, 's', type, step, 'x', why, '-', '-'].join('\t');
const stepViolations = [
  ['step-position', [header, row(T1, 'start'), row(T1, 'decision'), srow(T1, 'step', '1')]],
  ['step-position', [header, row(T1, 'start'), srow(T1, 'step', '1'), row(T1, 'decision'), srow(T2, 'step', '2')]],
  ['step-unknown', [header, row(T1, 'start'), srow(T1, 'step', '1'), srow(T2, 'step-done', '2')]],
  ['step-unknown', [header, row(T1, 'start'), srow(T2, 'step-skip', '1', '理由')]],
  ['step-unfinished', [header, row(T1, 'start'), srow(T1, 'step', '1'), srow(T1, 'step', '2'), srow(T2, 'step-done', '1'), row(T2, 'done')]],
  ['skip-reason', [header, row(T1, 'start'), srow(T1, 'step', '1'), srow(T2, 'step-skip', '1')]],
];

for (const [rule, lines] of stepViolations) {
  test(`check は ${rule} を名指しで落とす（step）`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'gori-log-'));
    const f = join(dir, 'x.tsv');
    writeFileSync(f, `${lines.join('\n')}\n`);
    const r = log(dir, ['check', f]);
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, new RegExp(`x\\.tsv:\\d+: ${rule}: `));
  });
}

// 事例 2026-11-05-record-before-check: commit を伴う作業の done を、worktree の HEAD の verdict check の 0 を確かめる前に書いた。
// レビュー結果を記録の場所の verdicts/<sha>/ に置く（レビューの道は verdict.test と review.test が試す。ここでは done の検査だけを見る）。
function putVerdict(dir, sha, result = 'pass', judge = 'human:t') {
  const d = join(recordsDir(dir), 'verdicts', sha);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, `20261105T000000000Z-${result}.json`), `${JSON.stringify({ task: ID, sha, judge, result, evidence: ['e'], findings: result === 'fail' ? ['f'] : [], time: '2026-11-05T09:00:00+09:00' })}\n`);
}
const headOf = (d) => spawnSync('git', ['-C', d, 'rev-parse', 'HEAD'], { encoding: 'utf8', env: cleanEnv() }).stdout.trim();
const commitIn = (d, m = 'work') => spawnSync('git', ['-C', d, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', m], { env: cleanEnv() });
const DONE = ['add', '--task', ID, '--type', 'done', '--what', '終わり', '--evidence', 'tests/run.sh all passed'];
// 作業のブランチに切り替えて commit する（main に無い commit を作る）。
const workCommit = (d) => {
  spawnSync('git', ['-C', d, 'switch', '-q', '-c', 'work'], { env: cleanEnv() });
  commitIn(d);
};

test('commit を伴う作業（start の base= と HEAD が違う）は、HEAD のレビュー結果が無いか不合格なら done-unjudged で拒まれ、合格なら書ける', () => {
  const { dir } = started();
  workCommit(dir);
  const sha = headOf(dir);
  const before = readFileSync(file(dir), 'utf8');
  let r = log(dir, DONE);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, new RegExp(`: done-unjudged: 作業ツリー \\S+ の HEAD ${sha.slice(0, 12)} には .*verdict check が 3 である（未レビュー: `));
  assert.match(r.out, /tools\/records\/review/);
  putVerdict(dir, sha, 'fail');
  r = log(dir, DONE);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /done-unjudged: .*verdict check が 1 である（不合格: /);
  assert.equal(readFileSync(file(dir), 'utf8'), before);
  putVerdict(dir, sha, 'pass');
  r = log(dir, DONE);
  assert.equal(r.status, 0, r.out);
  assert.equal(log(dir, ['check', file(dir)]).status, 0);
});

test('最新のレビュー結果のレビュアーが作業者なら、合格でも done-unjudged で拒まれる', () => {
  const { dir } = gitRepo();
  assert.equal(log(dir, ['start', '--task', ID, '--what', '目的'], { CLAUDE_CODE_SESSION_ID: 'worker-1' }).status, 0);
  workCommit(dir);
  putVerdict(dir, headOf(dir), 'pass', 'session:worker-1');
  const r = log(dir, DONE, { CLAUDE_CODE_SESSION_ID: 'worker-1' });
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /done-unjudged: .*レビュアー session:worker-1 は作業者である/);
});

test('レビュー結果を受けた後に HEAD が変わると（マージなど）done は拒まれる。done はマージの前に書く', () => {
  const { dir } = started();
  workCommit(dir);
  putVerdict(dir, headOf(dir));
  commitIn(dir, 'merge のつもり');
  const r = log(dir, DONE);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /done-unjudged: .*マージは done の後に行う/);
});

test('cwd が本体のチェックアウトで main が進んでいても、done は作業 ID の worktree の HEAD のレビュー結果で決まる', () => {
  const { dir, wt } = withTaskWorktree();
  commitIn(dir, 'main の先端');
  const before = readFileSync(file(dir), 'utf8');
  const r0 = log(dir, DONE);
  assert.equal(r0.status, 1, r0.out);
  assert.match(r0.out, new RegExp(`done-unjudged: 作業ツリー \\S+ の HEAD ${headOf(wt).slice(0, 12)} には .*に無い commit が 1 件ある`));
  assert.equal(readFileSync(file(dir), 'utf8'), before);
  putVerdict(dir, headOf(wt));
  const r = log(dir, DONE);
  assert.equal(r.status, 0, r.out);
});

test('pause と resume を挟んでも、done は start 行の base= から数えてレビュー結果を求める', () => {
  const { dir } = started();
  log(dir, ['add', '--task', ID, '--type', 'pause', '--what', 'n']);
  workCommit(dir);
  log(dir, ['add', '--task', ID, '--type', 'resume', '--what', 'r']);
  assert.match(log(dir, DONE).out, /done-unjudged/);
  putVerdict(dir, headOf(dir));
  assert.equal(log(dir, DONE).status, 0);
});

// 別の worktree のブランチ other で commit し、本体の main に fast-forward でマージする（他の作業のマージを模す）。
function mergeOther(dir, m = '他の作業') {
  const other = join(mkdtempSync(join(tmpdir(), 'gori-log-other-')), 'wt');
  spawnSync('git', ['-C', dir, 'worktree', 'add', '-q', '-b', 'other', other], { env: cleanEnv() });
  commitIn(other, m);
  spawnSync('git', ['-C', dir, 'merge', '-q', '--ff-only', 'other'], { env: cleanEnv() });
  return { other, sha: headOf(other) };
}
const currentBranch = (d) => spawnSync('git', ['-C', d, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8', env: cleanEnv() }).stdout.trim();

test('commit の無い作業の間に、他の作業のマージで main だけが進んだなら、done はレビュー結果なしで書ける', () => {
  const { dir } = started();
  assert.ok(['main', 'master'].includes(currentBranch(dir)), currentBranch(dir));
  const { sha } = mergeOther(dir);
  assert.equal(headOf(dir), sha);
  const r = log(dir, DONE);
  assert.equal(r.status, 0, r.out);
  assert.equal(readFileSync(file(dir), 'utf8').trimEnd().split('\n').at(-1).split('\t')[6], 'tests/run.sh all passed');
});

test('他の作業を merge --no-commit と commit で 3-way マージしても（merge-reviewed-branch の形）、commit の無い作業の done はレビュー結果なしで書ける', () => {
  const { dir } = started();
  const other = join(mkdtempSync(join(tmpdir(), 'gori-log-other-')), 'wt');
  spawnSync('git', ['-C', dir, 'worktree', 'add', '-q', '-b', 'other', other], { env: cleanEnv() });
  commitIn(other, '他の作業');
  spawnSync('git', ['-C', dir, 'merge', '-q', '--no-commit', '--no-ff', 'other'], { env: cleanEnv() });
  spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--no-edit'], { env: cleanEnv() });
  assert.match(spawnSync('git', ['-C', dir, 'reflog', '-1', '--format=%gs'], { encoding: 'utf8', env: cleanEnv() }).stdout, /^commit \(merge\)/);
  const r = log(dir, DONE);
  assert.equal(r.status, 0, r.out);
});

test('main の上で start し、main に直接 commit した作業は、レビュー結果が無ければ done を断られ、合格なら書ける', () => {
  const { dir } = started();
  assert.ok(['main', 'master'].includes(currentBranch(dir)), currentBranch(dir));
  commitIn(dir, '自分の変更');
  const before = readFileSync(file(dir), 'utf8');
  const r = log(dir, DONE);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /done-unjudged: .*reflog で start の後に自分が作った commit が 1 件ある（(main|master) の上にある）/);
  assert.equal(readFileSync(file(dir), 'utf8'), before);
  putVerdict(dir, headOf(dir));
  assert.equal(log(dir, DONE).status, 0);
});

test('作業ブランチを先に main へ fast-forward で取り込んでから done を書いても、レビュー結果を求める', () => {
  const { dir, wt } = withTaskWorktree();
  spawnSync('git', ['-C', dir, 'merge', '-q', '--ff-only', ID], { env: cleanEnv() });
  assert.equal(headOf(dir), headOf(wt));
  const r = log(dir, DONE);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /done-unjudged: .*自分が作った commit が 1 件ある/);
  putVerdict(dir, headOf(wt));
  assert.equal(log(dir, DONE).status, 0);
});

test('他の作業のマージで main が進んだ後に、自分でも main に commit した作業は、レビュー結果を求める', () => {
  const { dir } = started();
  mergeOther(dir);
  commitIn(dir, '自分の変更');
  const r = log(dir, DONE);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /自分が作った commit が 1 件ある/);
  putVerdict(dir, headOf(dir));
  assert.equal(log(dir, DONE).status, 0);
});

test('amend で作った commit も自分の commit と数え、reset で捨てた commit は、その後に他の作業が入っても数えない', () => {
  const { dir } = started();
  const base = headOf(dir);
  commitIn(dir, 'a');
  spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--amend', '--allow-empty', '-m', 'a2'], { env: cleanEnv() });
  assert.match(log(dir, DONE).out, /自分が作った commit が 1 件ある/);
  spawnSync('git', ['-C', dir, 'reset', '-q', '--hard', base], { env: cleanEnv() });
  mergeOther(dir);
  assert.notEqual(headOf(dir), base);
  const r = log(dir, DONE);
  assert.equal(r.status, 0, r.out);
});

test('main も master も無いリポジトリでは、HEAD が start の base= から変わっていればレビュー結果を求める', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gori-log-'));
  spawnSync('git', ['-C', dir, 'init', '-q', '-b', 'trunk'], { env: cleanEnv() });
  commitIn(dir, 'init');
  assert.equal(log(dir, ['start', '--task', ID, '--what', '目的']).status, 0);
  commitIn(dir);
  const r = log(dir, DONE);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /done-unjudged: .* main に無い commit が 1 件ある/);
  putVerdict(dir, headOf(dir));
  assert.equal(log(dir, DONE).status, 0);
});

test('commit の無い作業（HEAD が start の base= のまま）と base= の無い記録の done は、レビュー結果なしで書ける', () => {
  const { dir } = started();
  assert.equal(log(dir, DONE).status, 0);
  assert.equal(readFileSync(file(dir), 'utf8').trimEnd().split('\n').at(-1).split('\t')[6], 'tests/run.sh all passed');
  const empty = mkdtempSync(join(tmpdir(), 'gori-log-'));
  spawnSync('git', ['-C', empty, 'init', '-q'], { env: cleanEnv() });
  assert.equal(log(empty, ['start', '--task', ID, '--what', '目的']).status, 0);
  assert.match(readFileSync(file(empty), 'utf8'), /\tstart\t-\t目的\t-\t-\t-\n/);
  commitIn(empty);
  assert.equal(log(empty, DONE).status, 0);
});

// 記録の場所は gori のチェックアウトの .git/gori/repos/<本体の名前>/（docs/design.md）。
test('start は記録を gori のチェックアウトの repos/<名前>/audit に書き、repo.yml に本体のパスを残す。作業リポジトリの .git/gori/ には書かない', () => {
  const { dir } = started();
  assert.ok(existsSync(join(testGori(), '.git', 'gori', 'repos', basename(dir), 'audit', `${ID}.tsv`)));
  assert.equal(readFileSync(join(recordsDir(dir), 'repo.yml'), 'utf8'), `path: ${realpathSync(dir)}\n`);
  assert.equal(existsSync(join(dir, '.git', 'gori')), false);
});

test('読むだけの道（state、check、add の失敗）は repo.yml を作らない', () => {
  const { dir } = gitRepo();
  assert.equal(log(dir, ['state', '--task', ID]).status, 1);
  assert.equal(log(dir, ['add', '--task', ID, '--type', 'decision', '--what', 'x']).status, 1);
  assert.equal(log(dir, ['start', '--task', ID]).status, 2);
  assert.equal(existsSync(recordsDir(dir)), false);
});

test('作業リポジトリの worktree から書いても、記録は本体のチェックアウトの名前の場所に入る', () => {
  const { dir, g } = gitRepo();
  const wt = join(mkdtempSync(join(tmpdir(), 'gori-log-wt-')), 'wt-other-name');
  g('worktree', 'add', '-q', '-b', ID, wt);
  const r = log(wt, ['start', '--task', ID, '--what', '目的']);
  assert.equal(r.status, 0, r.out);
  assert.ok(existsSync(file(dir)), r.out);
  assert.equal(readFileSync(join(recordsDir(dir), 'repo.yml'), 'utf8'), `path: ${realpathSync(dir)}\n`);
  assert.equal(existsSync(recordsDir(wt)), false);
  assert.equal(log(wt, ['add', '--task', ID, '--type', 'decision', '--what', 'x']).status, 0);
  assert.equal(readFileSync(file(dir), 'utf8').trimEnd().split('\n').length, 3);
});

test('repo.yml の path が今のリポジトリと違えば、start と add は何も書かずに 2 で止まり、直し方を示す', () => {
  const { dir } = gitRepo();
  mkdirSync(recordsDir(dir), { recursive: true });
  writeFileSync(join(recordsDir(dir), 'repo.yml'), 'path: /somewhere/else\n');
  const r = log(dir, ['start', '--task', ID, '--what', '目的']);
  assert.equal(r.status, 2, r.out);
  assert.match(r.out, /repo\.yml/);
  assert.match(r.out, /クローンのディレクトリ名を変えるか/);
  assert.deepEqual(readdirSync(recordsDir(dir)), ['repo.yml']);
  assert.equal(readFileSync(join(recordsDir(dir), 'repo.yml'), 'utf8'), 'path: /somewhere/else\n');
  assert.equal(existsSync(join(dir, '.git', 'gori')), false);
  assert.equal(log(dir, ['add', '--task', ID, '--type', 'decision', '--what', 'x']).status, 2);
  assert.equal(log(dir, ['state', '--task', ID]).status, 2);
});

test('gori のチェックアウトが見つからなければ、start は何も書かずに 2 で止まり、古い置き場所にも書かない', () => {
  const { dir } = gitRepo();
  const notGori = mkdtempSync(join(tmpdir(), 'gori-log-notgori-'));
  const r = log(dir, ['start', '--task', ID, '--what', '目的'], { GORI_ROOT: notGori });
  assert.equal(r.status, 2, r.out);
  assert.match(r.out, /gori の git のチェックアウトでない/);
  assert.deepEqual(readdirSync(notGori), []);
  assert.equal(existsSync(join(dir, '.git', 'gori')), false);
  assert.equal(existsSync(recordsDir(dir)), false);
});

// 承認の行は、--quote の引用が最後の人間の入力に含まれるときだけ、会話の中から書ける。
function transcript(session, turns) {
  const projects = mkdtempSync(join(tmpdir(), 'gori-log-projects-'));
  mkdirSync(join(projects, '-demo'));
  // choice は選択式の質問（AskUserQuestion）への回答の行で、text は {問い: 選んだ答え} である。
  const rows = turns.map(([role, text, labels], i) =>
    role === 'user'
      ? { type: 'user', uuid: `u-${i}`, timestamp: `2026-11-08T00:00:0${i}Z`, message: { role: 'user', content: text } }
      : role === 'summary'
        ? { type: 'user', uuid: `s-${i}`, timestamp: `2026-11-08T00:00:0${i}Z`, isCompactSummary: true, isVisibleInTranscriptOnly: true, message: { role: 'user', content: text } }
        : role === 'choice'
        ? {
            type: 'user',
            uuid: `c-${i}`,
            timestamp: `2026-11-08T00:00:0${i}Z`,
            message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `t-${i}`, content: `Your questions have been answered: ${Object.entries(text).map(([q, a]) => `"${q}"="${a}"`).join(', ')}.` }] },
            toolUseResult: { questions: Object.keys(labels ?? text).map((question) => ({ question, options: (labels?.[question] ?? [text[question]]).map((label) => ({ label })), multiSelect: false })), answers: text },
          }
          : { type: 'assistant', uuid: `a-${i}`, timestamp: `2026-11-08T00:00:0${i}Z`, message: { role: 'assistant', content: [{ type: 'text', text }] } });
  writeFileSync(join(projects, '-demo', `${session}.jsonl`), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return projects;
}
const lastRow = (dir) => readFileSync(file(dir), 'utf8').trimEnd().split('\n').at(-1).split('\t');

const approve = (dir, session, projects, quote, extra = []) => log(dir, ['add', '--task', ID, '--type', 'approval', '--what', '案の承認', ...(quote === null ? [] : ['--quote', quote]), ...extra], { CLAUDE_CODE_SESSION_ID: session, GORI_PROJECTS_DIR: projects });

test('approval は、引用が最後の人間の文章の発言に含まれれば書く。問いや番号の無い添え書きがあっても書く', () => {
  const { dir } = started();
  const projects = transcript('s-1', [['assistant', '案 1 2 3 です。'], ['user', '1 よい、2 よい。ところで、これは何ですか？ ちなみに補足です'], ['user', '<task-notification>\n<task-id>x</task-id>\n</task-notification>']]);
  const r = approve(dir, 's-1', projects, '1 よい、2 よい');
  assert.equal(r.status, 0, r.out);
  const row = lastRow(dir);
  assert.equal(row[2], 'approval');
  assert.equal(row[1], 's-1');
  assert.equal(row[6], '発言 u-1 「1 よい、2 よい」');
  // 空白の違いは無視する。
  assert.equal(approve(dir, 's-1', projects, '1よい、2よい').status, 0);
  assert.equal(log(dir, ['check', file(dir)]).status, 0);
});

test('approval は、選択式の回答の選んだ答えに引用が含まれれば書く。問いの文だけに含まれるなら書かない', () => {
  const { dir } = started();
  const projects = transcript('s-c', [['assistant', '案です。'], ['choice', { 'この案で進めてよいですか？': 'この案で進めてよい' }]]);
  const r = approve(dir, 's-c', projects, '案で進めてよい');
  assert.equal(r.status, 0, r.out);
  assert.match(lastRow(dir)[6], /^回答 c-1 問い「この案で進めてよいですか？」 答え「この案で進めてよい」 引用「案で進めてよい」$/);
  const before = readFileSync(file(dir), 'utf8');
  const q = approve(dir, 's-c', projects, '進めてよいですか');
  assert.equal(q.status, 2, q.out);
  assert.match(q.out, /approval-unverified/);
  assert.equal(readFileSync(file(dir), 'utf8'), before);
});

test('approval は、選んだ選択肢のラベルに続けて別件の一文を添えた答えも、その選択肢の承認として書く', () => {
  const { dir } = started();
  const projects = transcript('s-x', [['assistant', '案です。'], ['choice', { 'この案で進めてよいですか？': 'それでよい。なんかこの承認の仕組みが二度手間になっている気がするので改善して欲しい。' }, { 'この案で進めてよいですか？': ['それでよい', '直す'] }]]);
  const r = approve(dir, 's-x', projects, 'それでよい');
  assert.equal(r.status, 0, r.out);
  assert.match(lastRow(dir)[6], /^回答 c-1 問い「この案で進めてよいですか？」 答え「それでよい。なんかこの承認の仕組みが二度手間/);
});

test('approval は、会話の要約の行を人間の入力に数えず、要約の前の人間の返事を引いて書く', () => {
  const { dir } = started();
  const summary = 'This session is being continued from a previous conversation. 人間は「1：直さないで良い。2：それでよい」と答えた。';
  const projects = transcript('s-sum', [['assistant', '問い 1 と 2 です。'], ['user', '1：直さないで良い。2：それでよい'], ['summary', summary], ['assistant', '続けます。']]);
  const r = approve(dir, 's-sum', projects, '1：直さないで良い。2：それでよい');
  assert.equal(r.status, 0, r.out);
  assert.equal(lastRow(dir)[6], '発言 u-1 「1：直さないで良い。2：それでよい」');
  // 要約の文だけにある言葉は、人間の発言でないので引けない。
  const only = approve(dir, 's-sum', projects, 'This session is being continued');
  assert.equal(only.status, 2, only.out);
  assert.match(only.out, /approval-unverified/);
  // 要約の後に人間が話せば、その発言が最後の人間の入力になる。
  const after = transcript('s-sum2', [['user', '1 よい'], ['summary', summary], ['user', '直す']]);
  const stale = approve(dir, 's-sum2', after, '1 よい');
  assert.equal(stale.status, 2, stale.out);
  assert.match(stale.out, /approval-unverified/);
});

test('GORI_AUTO があれば、approval は行を書かずに 1 で止まる。ほかの行は書ける', () => {
  const { dir } = started();
  const before = readFileSync(file(dir), 'utf8');
  const r = log(dir, ['add', '--task', ID, '--type', 'approval', '--what', '承認', '--quote', 'よい'], { GORI_AUTO: '1' });
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /auto-fence: 無人の作業（GORI_AUTO）は 承認の行/);
  assert.equal(readFileSync(file(dir), 'utf8'), before);
  assert.equal(log(dir, ['add', '--task', ID, '--type', 'decision', '--what', '決めた'], { GORI_AUTO: '1' }).status, 0);
  assert.equal(log(dir, ['add', '--task', ID, '--type', 'approval', '--what', '承認', '--quote', 'よい']).status, 0, '印が無ければ端末の人間として書ける');
});

test('approval は、引用が最後の人間の入力に含まれなければ、書かずに 2 で止まる', () => {
  const { dir } = started();
  const before = readFileSync(file(dir), 'utf8');
  const stale = transcript('s-s', [['user', '1 よい'], ['assistant', '別の案です'], ['user', '直す']]);
  const r = approve(dir, 's-s', stale, '1 よい');
  assert.equal(r.status, 2, r.out);
  assert.match(r.out, /approval-unverified: .*最後の人間の発言に含まれていない/);
  const later = approve(dir, 's-l', transcript('s-l', [['user', '1 よい'], ['choice', { '進めてよいですか？': '進めてよい' }]]), '1 よい');
  assert.equal(later.status, 2, later.out);
  assert.match(later.out, /approval-unverified/);
  const none = approve(dir, 's-a', transcript('s-a', [['user', '1 よい']]), null);
  assert.equal(none.status, 2, none.out);
  assert.match(none.out, /--quote/);
  const missing = approve(dir, 's-none', transcript('s-x', [['user', '1 よい']]), '1 よい');
  assert.equal(missing.status, 2, missing.out);
  assert.match(missing.out, /approval-unverified/);
  assert.equal(readFileSync(file(dir), 'utf8'), before);
});

test('approval は、セッション ID が無ければ端末の人間が書いたと見なし、照合せずに書く', () => {
  const { dir } = started();
  const r = log(dir, ['add', '--task', ID, '--type', 'approval', '--what', '端末から承認', '--quote', 'OK']);
  assert.equal(r.status, 0, r.out);
  assert.equal(lastRow(dir)[6], '端末の人間 「OK」');
  assert.equal(log(dir, ['check', file(dir)]).status, 0);
});

test('start と add は、秘密情報らしい文字列を含む欄があれば書かずに 2 で終え、値を出さない', () => {
  const { dir } = started();
  const before = readFileSync(file(dir), 'utf8');
  const url = ['postgres://user', 'pass@host/db'].join(':'); // 検査のための偽の値
  for (const [name, extra] of [
    ['--what', ['--type', 'decision', '--what', `接続先 ${url}`]],
    ['--why', ['--type', 'decision', '--what', 'w', '--why', url]],
    ['--evidence', ['--type', 'decision', '--what', 'w', '--evidence', `出力: ${url}`]],
    ['--result', ['--type', 'done', '--what', 'w', '--result', url]],
    ['--quote', ['--type', 'approval', '--what', 'w', '--quote', url]],
  ]) {
    const r = log(dir, ['add', '--task', ID, ...extra]);
    assert.equal(r.status, 2, `${name}: ${r.out}`);
    assert.match(r.out, new RegExp(`secret-like: ${name}（URL の利用者名とパスワード）`));
    assert.doesNotMatch(r.out, /pass@host/);
  }
  assert.equal(readFileSync(file(dir), 'utf8'), before);
  const s = log(gitRepo().dir, ['start', '--slug', 'leak', '--what', url]);
  assert.equal(s.status, 2, s.out);
  assert.match(s.out, /secret-like/);
  // 秘密でない文字列は通す。
  assert.equal(log(dir, ['add', '--task', ID, '--type', 'decision', '--what', 'https://example.com/a を読んだ', '--evidence', 'git@example.com:o/r.git']).status, 0);
});

test('check 行は --criterion と --evidence が要り、what に指し、result に今の HEAD の SHA を道具が入れる', () => {
  const { dir, g } = started();
  const sha = g('rev-parse', 'HEAD').stdout.trim();
  const before = readFileSync(file(dir), 'utf8');
  const add = (...a) => log(dir, ['add', '--task', ID, '--type', 'check', ...a]);
  assert.equal(add('--evidence', 'e').status, 2);
  assert.equal(add('--criterion', '行 3').status, 2);
  assert.equal(add('--criterion', '何か', '--evidence', 'e').status, 2);
  assert.equal(readFileSync(file(dir), 'utf8'), before);
  for (const c of ['行 3', '行 3#2', '承認', '文書']) assert.equal(add('--criterion', c, '--evidence', 'node --test が通った', '--result', 'nonsense').status, 0, c);
  const rows = readFileSync(file(dir), 'utf8').trimEnd().split('\n').map((l) => l.split('\t')).filter((c) => c[2] === 'check');
  assert.deepEqual(rows.map((c) => c[4]), ['行 3', '行 3#2', '承認', '文書']);
  for (const c of rows) {
    assert.equal(c[7], sha);
    assert.equal(c[6], 'node --test が通った');
  }
  assert.equal(log(dir, ['check', file(dir)]).status, 0);
});

test('check 行は GORI_AUTO（無人の作業）でも書ける', () => {
  const { dir } = started();
  assert.equal(log(dir, ['add', '--task', ID, '--type', 'check', '--criterion', '承認', '--evidence', 'e'], { GORI_AUTO: '1' }).status, 0);
});
