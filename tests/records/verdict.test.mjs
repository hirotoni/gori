import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test } from 'node:test';
import { recordsDir, repoRoot, testGori } from '../helpers.mjs';

// pre-commit の中で走ると git が GIT_INDEX_FILE などを渡す。レビュアーの中で走ると CLAUDE_* や GORI_* が立っている。
// どちらも一時リポジトリの操作と道具の判断に漏らさない。記録は一時の gori のチェックアウト（GORI_ROOT）の下に書かせる。
const cleanEnv = (extra = {}) => ({
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_') && !k.startsWith('CLAUDE') && !k.startsWith('GORI_'))),
  GORI_ROOT: testGori(),
  ...extra,
});
const LOG = join(repoRoot, 'tools', 'records', 'log');
const VERDICT = join(repoRoot, 'tools', 'records', 'verdict');
const ID = '20261103-100000-demo';

function gitRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'gori-verdict-'));
  const g = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8', env: cleanEnv() });
  g('init', '-q');
  g('config', 'user.name', 'tester');
  g('config', 'user.email', 't@t');
  g('commit', '-q', '--allow-empty', '-m', 'init');
  return { dir, g, head: () => g('rev-parse', 'HEAD').stdout.trim(), commit: (m = 'c') => g('commit', '-q', '--allow-empty', '-m', m) };
}

const exec = (bin, dir, args, env = {}) => {
  const r = spawnSync(process.execPath, [bin, ...args], { cwd: dir, encoding: 'utf8', env: cleanEnv(env) });
  return { status: r.status, out: `${r.stdout}${r.stderr}`, stdout: r.stdout };
};
const log = (dir, args, env = {}) => exec(LOG, dir, args, env);
const verdict = (dir, args, env = {}) => exec(VERDICT, dir, args, env);

// 作業者のセッション W が start を書いた作業を用意する。
const started = (worker = 'worker-1') => {
  const r = gitRepo();
  assert.equal(log(r.dir, ['start', '--task', ID, '--what', '目的'], { CLAUDE_CODE_SESSION_ID: worker }).status, 0);
  return r;
};
const auditFile = (dir) => join(recordsDir(dir), 'audit', `${ID}.tsv`);
const verdictFiles = (dir, sha) => {
  const d = join(recordsDir(dir), 'verdicts', sha);
  return existsSync(d) ? readdirSync(d).map((f) => join(d, f)) : [];
};
const outboxDir = () => mkdtempSync(join(tmpdir(), 'gori-outbox-test-'));
const outboxFiles = (d) => readdirSync(d).map((f) => join(d, f));
const recArgs = ['record', '--task', ID, '--result', 'pass', '--evidence', 'e'];

// 疑似端末の下で実行する（TTY を環境変数で差し替える口は、作業者の抜け道になるので作らない）。
const inPty = (dir, args, env = {}) => {
  const cmd = [process.execPath, VERDICT, ...args];
  const argv = process.platform === 'darwin' ? ['-q', '/dev/null', ...cmd] : ['-qec', cmd.map((a) => `'${a.replaceAll("'", "'\\''")}'`).join(' '), '/dev/null'];
  const r = spawnSync('script', argv, { cwd: dir, encoding: 'utf8', env: cleanEnv(env), stdio: [openSync('/dev/null', 'r'), 'pipe', 'pipe'] });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
};
// 疑似端末を開けない環境（review が起動したレビュアーの Seatbelt は openpty を拒む）では、疑似端末を要するテストを飛ばす。
// 飛ばすのは script が openpty の拒否で落ちたときだけで、それ以外の失敗は飛ばさない。
const ptyDenied = (() => {
  const argv = process.platform === 'darwin' ? ['-q', '/dev/null', '/usr/bin/true'] : ['-qec', 'true', '/dev/null'];
  const r = spawnSync('script', argv, { encoding: 'utf8', stdio: [openSync('/dev/null', 'r'), 'pipe', 'pipe'] });
  return r.status !== 0 && /openpty/i.test(`${r.stderr}${r.stdout}`);
})();
const ptyTest = (name, fn) => test(name, ptyDenied ? { skip: '疑似端末を開けない環境（script: openpty が拒まれた）なので飛ばす' } : {}, fn);
// 端末の人間としてレビュー結果を記録する（作業リポジトリの git の共通ディレクトリの下の gori/verdicts に直接書く道）。
const human = (dir, extra = ['--result', 'pass', '--evidence', 'tests を走らせ全件通った']) => inPty(dir, ['record', '--task', ID, ...extra]);
// review のレビュアーとしてレビュー結果を記録する（受け取り口にだけ書く道）。
const judged = (dir, outbox, extra = [], session = { CLAUDE_CODE_SESSION_ID: 'judge-1' }) =>
  verdict(dir, ['record', '--task', ID, '--result', 'pass', '--evidence', 'tests を走らせ全件通った', ...extra], { ...session, GORI_VERDICT_OUTBOX: outbox });
const check = (dir, extra = []) => verdict(dir, ['check', '--task', ID, ...extra]);

test('cwd が本体のチェックアウトでも、作業 ID のブランチの worktree があれば、check はその HEAD を見る', () => {
  const r = started();
  const wt = join(mkdtempSync(join(tmpdir(), 'gori-verdict-wt-')), 'wt');
  r.g('worktree', 'add', '-q', '-b', ID, wt);
  spawnSync('git', ['-C', wt, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'work'], { env: cleanEnv() });
  const wtHead = spawnSync('git', ['-C', wt, 'rev-parse', 'HEAD'], { encoding: 'utf8', env: cleanEnv() }).stdout.trim();
  const res = verdict(r.dir, ['check', '--task', ID, '--json']);
  assert.equal(JSON.parse(res.stdout).sha, wtHead, res.out);
});

test('レビュアーの record はレビュー結果を受け取り口に一ファイルで書き、作業リポジトリには何も書かない', () => {
  const r = started();
  const ob = outboxDir();
  const before = readFileSync(auditFile(r.dir), 'utf8');
  const res = judged(r.dir, ob, ['--model', 'opus']);
  assert.equal(res.status, 0, res.out);
  const files = outboxFiles(ob);
  assert.equal(files.length, 1);
  assert.match(files[0], /-session-judge-1\.json$/);
  const v = JSON.parse(readFileSync(files[0], 'utf8'));
  assert.equal(v.task, ID);
  assert.equal(v.sha, r.head());
  assert.equal(v.judge, 'session:judge-1');
  assert.equal(v.result, 'pass');
  assert.deepEqual(v.evidence, ['tests を走らせ全件通った']);
  assert.deepEqual(v.findings, []);
  assert.equal(v.model, 'opus');
  assert.equal(verdictFiles(r.dir, r.head()).length, 0);
  assert.equal(readFileSync(auditFile(r.dir), 'utf8'), before);
  assert.equal(check(r.dir).status, 3);
});

test('判断の記録に作業者として現れるセッションのレビューを、self-judgment で拒む', () => {
  const r = started('worker-1');
  const ob = outboxDir();
  const res = judged(r.dir, ob, [], { CLAUDE_CODE_SESSION_ID: 'worker-1' });
  assert.equal(res.status, 1);
  assert.match(res.out, /self-judgment/);
  assert.equal(outboxFiles(ob).length, 0);
});

test('CLAUDE_SESSION_ID でもレビュアーを決める', () => {
  const r = started('worker-1');
  assert.equal(judged(r.dir, outboxDir(), [], { CLAUDE_SESSION_ID: 'worker-1' }).status, 1);
  assert.equal(judged(r.dir, outboxDir(), [], { CLAUDE_SESSION_ID: 'other' }).status, 0);
});

test('受け取り口が無ければ書かない', () => {
  const r = started();
  const res = judged(r.dir, join(outboxDir(), 'none'));
  assert.equal(res.status, 2, res.out);
  assert.match(res.out, /受け取り口が無い/);
});

ptyTest('未コミットの変更があると拒む。記録（作業ツリーの外）は変更に数えない', () => {
  const r = started();
  writeFileSync(join(r.dir, 'a.txt'), 'x');
  const res = human(r.dir);
  assert.equal(res.status, 1);
  assert.match(res.out, /dirty-tree/);
  assert.equal(judged(r.dir, outboxDir()).status, 1);
  r.g('add', 'a.txt');
  r.commit('add a');
  assert.equal(human(r.dir).status, 0);
});

ptyTest('pass で evidence が無いと拒む。fail で finding が無いと拒む', () => {
  const r = started();
  assert.equal(human(r.dir, ['--result', 'pass']).status, 1);
  assert.equal(human(r.dir, ['--result', 'fail']).status, 1);
  assert.equal(human(r.dir, ['--result', 'fail', '--finding', '足りない']).status, 0);
  assert.equal(verdictFiles(r.dir, r.head()).length, 1);
});

ptyTest('判断の記録が無いと拒む', () => {
  const r = gitRepo();
  const res = human(r.dir);
  assert.equal(res.status, 1);
  assert.match(res.out, /判断の記録が無い/);
});

ptyTest('人間が端末から実行すれば human:<git の user.name> をレビュアーにする。引数でレビュアーは指定できない', () => {
  const r = started();
  const judged = inPty(r.dir, [...recArgs, '--judge', 'session:fake']);
  assert.equal(judged.status, 2, judged.out);
  assert.match(judged.out, /知らないフラグ --judge/);
  assert.deepEqual(verdictFiles(r.dir, r.head()), []);
  const res = inPty(r.dir, recArgs);
  assert.equal(res.status, 0, res.out);
  assert.equal(JSON.parse(readFileSync(verdictFiles(r.dir, r.head())[0], 'utf8')).judge, 'human:tester');
});

test('セッション ID も端末も無い実行は拒む。review でレビューするよう示す', () => {
  const r = started();
  const res = verdict(r.dir, recArgs, {});
  assert.equal(res.status, 1);
  assert.match(res.out, /not-judge/);
  assert.match(res.out, /review/);
  assert.equal(verdictFiles(r.dir, r.head()).length, 0);
  assert.equal(check(r.dir).status, 3);
});

ptyTest('セッション ID があり受け取り口が無い実行は、GORI_REVIEWING=1 でも端末があっても拒む', () => {
  const r = started('worker-1');
  for (const env of [{ CLAUDE_CODE_SESSION_ID: 'worker-1' }, { CLAUDE_CODE_SESSION_ID: 'invented', GORI_REVIEWING: '1' }]) {
    const res = verdict(r.dir, recArgs, env);
    assert.equal(res.status, 1, res.out);
    assert.match(res.out, /not-judge/);
    assert.match(res.out, /review/);
    assert.equal(inPty(r.dir, recArgs, env).status, 1);
  }
  assert.equal(verdictFiles(r.dir, r.head()).length, 0);
  assert.equal(check(r.dir).status, 3);
});

test('作業者が自分で GORI_VERDICT_OUTBOX を立てて記録しても、誰も取り込まないので check は 0 にならない', () => {
  const r = started('worker-1');
  const ob = outboxDir();
  assert.equal(judged(r.dir, ob, [], { CLAUDE_CODE_SESSION_ID: 'invented', GORI_REVIEWING: '1' }).status, 0);
  assert.equal(outboxFiles(ob).length, 1);
  assert.equal(verdictFiles(r.dir, r.head()).length, 0);
  assert.equal(check(r.dir).status, 3);
});

test('受け取り口を作業リポジトリか gori のチェックアウト、またはその git の共通ディレクトリの中（記録の verdicts など）に向けても書けず、check は 0 にならない', () => {
  const r = started('worker-1');
  const gori = testGori();
  const insides = [
    join(recordsDir(r.dir), 'verdicts', r.head()),
    recordsDir(r.dir),
    join(gori, '.git', 'gori'),
    join(gori, '.git', 'outbox-test'),
    join(gori, 'outbox-test'),
    gori,
    join(r.dir, '.git', 'gori'),
    join(r.dir, '.git'),
    r.dir,
  ];
  for (const inside of insides) {
    mkdirSync(inside, { recursive: true });
    const res = judged(r.dir, inside, [], { CLAUDE_CODE_SESSION_ID: 'fake-judge' });
    assert.equal(res.status, 1, res.out);
    assert.match(res.out, /not-judge/);
  }
  assert.equal(verdictFiles(r.dir, r.head()).length, 0);
  assert.equal(check(r.dir).status, 3);
});

ptyTest('セッション ID の無い GORI_VERDICT_OUTBOX は拒む（端末があっても）', () => {
  const r = started();
  const ob = outboxDir();
  const res = inPty(r.dir, recArgs, { GORI_VERDICT_OUTBOX: ob });
  assert.equal(res.status, 1, res.out);
  assert.match(res.out, /not-judge/);
  assert.equal(outboxFiles(ob).length, 0);
  assert.equal(verdictFiles(r.dir, r.head()).length, 0);
});

test('GORI_ASSUME_TTY のような環境変数で端末を装えない', () => {
  const r = started();
  const res = verdict(r.dir, recArgs, { GORI_ASSUME_TTY: '1' });
  assert.equal(res.status, 1);
  assert.equal(verdictFiles(r.dir, r.head()).length, 0);
});

ptyTest('人間の record は判断の記録に decision 行を足し、同じレビュアーがもう一度記録しても拒まれない', () => {
  const r = started();
  assert.equal(human(r.dir).status, 0);
  const rows = readFileSync(auditFile(r.dir), 'utf8').trimEnd().split('\n').map((l) => l.split('\t'));
  const last = rows.at(-1);
  assert.equal(last[1], '-');
  assert.equal(last[2], 'decision');
  assert.equal(last[4], 'レビュー結果 pass');
  assert.equal(last[5], 'レビュアー human:tester');
  assert.ok(last[6].includes(r.head()));
  assert.ok(last[6].includes(`/.git/gori/repos/${basename(r.dir)}/verdicts/`));
  assert.equal(log(r.dir, ['check', auditFile(r.dir)]).status, 0);
  assert.equal(human(r.dir).status, 0);
  assert.equal(verdictFiles(r.dir, r.head()).length, 2);
});

ptyTest('done 済みの判断の記録には足さず、レビュー結果ファイルだけ書く', () => {
  const r = started();
  assert.equal(log(r.dir, ['add', '--task', ID, '--type', 'done', '--what', '完了'], { CLAUDE_CODE_SESSION_ID: 'worker-1' }).status, 0);
  const before = readFileSync(auditFile(r.dir), 'utf8');
  assert.equal(human(r.dir).status, 0);
  assert.equal(readFileSync(auditFile(r.dir), 'utf8'), before);
  assert.equal(verdictFiles(r.dir, r.head()).length, 1);
});

test('GORI_WORK_REPO があれば、そのリポジトリを作業リポジトリにする', () => {
  const r = started();
  const elsewhere = mkdtempSync(join(tmpdir(), 'gori-elsewhere-'));
  const ob = outboxDir();
  const res = verdict(elsewhere, ['record', '--task', ID, '--result', 'pass', '--evidence', 'e', '--sha', r.head()], { CLAUDE_CODE_SESSION_ID: 'judge-1', GORI_VERDICT_OUTBOX: ob, GORI_WORK_REPO: r.dir });
  assert.equal(res.status, 0, res.out);
  assert.equal(JSON.parse(readFileSync(outboxFiles(ob)[0], 'utf8')).sha, r.head());
  const self = verdict(elsewhere, ['record', '--task', ID, '--result', 'pass', '--evidence', 'e', '--sha', r.head()], { CLAUDE_CODE_SESSION_ID: 'worker-1', GORI_VERDICT_OUTBOX: ob, GORI_WORK_REPO: r.dir });
  assert.match(self.out, /self-judgment/);
  const w = log(elsewhere, ['add', '--task', ID, '--type', 'decision', '--what', 'x'], { GORI_WORK_REPO: r.dir });
  assert.equal(w.status, 0, w.out);
});

ptyTest('check: pass で 0', () => {
  const r = started();
  human(r.dir);
  const res = check(r.dir);
  assert.equal(res.status, 0, res.out);
  assert.match(res.out, /合格/);
});

test('unverified は finding と evidence の両方が無ければ記録できず、両方あれば受け取り口に書ける', () => {
  const r = started();
  const ob = outboxDir();
  const rec = (extra) => verdict(r.dir, ['record', '--task', ID, '--result', 'unverified', ...extra], { CLAUDE_CODE_SESSION_ID: 'judge-1', GORI_VERDICT_OUTBOX: ob });
  for (const extra of [[], ['--finding', 'E2E が渡っていない'], ['--evidence', 'bash tests/e2e/x.sh: operation not permitted']]) {
    const res = rec(extra);
    assert.equal(res.status, 1, res.out);
    assert.match(res.out, /unverified には --finding/);
  }
  assert.equal(outboxFiles(ob).length, 0);
  const ok = rec(['--finding', 'E2E が渡っていない。--e2e tests/e2e/x.sh があれば確かめられる', '--evidence', 'bash tests/e2e/x.sh: operation not permitted']);
  assert.equal(ok.status, 0, ok.out);
  assert.equal(JSON.parse(readFileSync(outboxFiles(ob)[0], 'utf8')).result, 'unverified');
});

test('check: レビュー結果が無ければ未レビューで 3', () => {
  const r = started();
  const res = check(r.dir);
  assert.equal(res.status, 3);
  assert.match(res.out, /未レビュー/);
});

ptyTest('check: 最新が fail なら 1。その後に pass を足せば 0', () => {
  const r = started();
  human(r.dir, ['--result', 'pass', '--evidence', 'e']);
  assert.equal(human(r.dir, ['--result', 'fail', '--finding', 'x']).status, 0);
  assert.equal(check(r.dir).status, 1);
  assert.equal(human(r.dir, ['--result', 'pass', '--evidence', 'e']).status, 0);
  assert.equal(check(r.dir).status, 0);
});

ptyTest('check: 最新が unverified なら確認できずで 4 を返し、足りない材料を示す。その後に pass を足せば 0', () => {
  const r = started();
  assert.equal(human(r.dir, ['--result', 'unverified', '--finding', '承認したたたき台が範囲に無い', '--evidence', 'git show で探したが無い']).status, 0);
  const res = check(r.dir);
  assert.equal(res.status, 4, res.out);
  assert.match(res.out, /^確認できず: .*成果を直さず.*承認したたたき台が範囲に無い/m);
  assert.equal(human(r.dir, ['--result', 'pass', '--evidence', 'e']).status, 0);
  assert.equal(check(r.dir).status, 0);
});

ptyTest('check: レビュー結果の後に commit を一つ足すと、新しい HEAD にレビュー結果が無いので 3 になる', () => {
  const r = started();
  human(r.dir);
  assert.equal(check(r.dir).status, 0);
  r.commit('レビュー結果の後の変更');
  const res = check(r.dir);
  assert.equal(res.status, 3, res.out);
  assert.match(res.out, /未レビュー/);
});

ptyTest('check: 古い sha の pass を、今の sha のレビューに数えない。古い sha を指せば 0', () => {
  const r = started();
  const old = r.head();
  human(r.dir);
  r.commit('次');
  assert.equal(check(r.dir).status, 3);
  assert.equal(check(r.dir, ['--sha', old]).status, 0);
});

ptyTest('check: 他の作業のレビュー結果を数えない', () => {
  const r = started();
  human(r.dir);
  const other = '20261103-100000-other';
  assert.equal(log(r.dir, ['start', '--task', other, '--what', '別の作業']).status, 0);
  assert.equal(verdict(r.dir, ['check', '--task', other]).status, 3);
});
ptyTest('古い形の作業 ID の記録にも、record と check が今までどおり動く', () => {
  const r = gitRepo();
  const old = '2026-11-03-legacy';
  mkdirSync(join(recordsDir(r.dir), 'audit'), { recursive: true });
  writeFileSync(join(recordsDir(r.dir), 'audit', `${old}.tsv`), 'time\tsession\ttype\tstep\twhat\twhy\tevidence\tresult\n2026-11-03T10:00:00+09:00\tworker-1\tstart\t-\t目的\t-\t-\t-\n');
  assert.equal(verdict(r.dir, ['check', '--task', old]).status, 3);
  const rec = inPty(r.dir, ['record', '--task', old, '--result', 'pass', '--evidence', 'tests を走らせ全件通った']);
  assert.equal(rec.status, 0, rec.out);
  assert.equal(verdict(r.dir, ['check', '--task', old]).status, 0);
});

test('check: 作業 ID の形でなければ 2 で、新しい形を案内する', () => {
  const r = gitRepo();
  const res = verdict(r.dir, ['check', '--task', 'Bad_ID']);
  assert.equal(res.status, 2);
  assert.match(res.out, /<YYYYMMDD>-<hhmmss>-<slug>/);
});
test('check: 最新のレビュー結果のレビュアーが作業者なら合格にしない', () => {
  const r = started();
  const dir = join(recordsDir(r.dir), 'verdicts', r.head());
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, '20261103T000000000Z-session-worker-1.json'), JSON.stringify({ task: ID, sha: r.head(), judge: 'session:worker-1', result: 'pass', evidence: ['e'], findings: [], time: 't', model: null }));
  const res = check(r.dir);
  assert.equal(res.status, 1);
  assert.match(res.out, /作業者/);
});

test('check: 状態が分からなければ 2（git が使えない、判断の記録が無い、レビュー結果が壊れている）', () => {
  const notGit = mkdtempSync(join(tmpdir(), 'gori-nogit-'));
  assert.equal(check(notGit).status, 2);
  const r = gitRepo();
  assert.equal(check(r.dir).status, 2);
  const s = started();
  const dir = join(recordsDir(s.dir), 'verdicts', s.head());
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, '20261103T000000000Z-x.json'), '{壊れた');
  assert.equal(check(s.dir).status, 2);
});

test('check --json は state と reason を出す', () => {
  const r = started();
  const res = check(r.dir, ['--json']);
  assert.equal(res.status, 3);
  const j = JSON.parse(res.stdout);
  assert.equal(j.state, '未レビュー');
  assert.ok(j.reason);
});

test('workerSessions は、レビュー結果の行（gori/repos/<名前>/verdicts/ と、移す前の gori/verdicts/ の両方）のレビュアーを作業者に数えない', async () => {
  const { workerSessions } = await import(join(repoRoot, 'tools', 'lib', 'audit.mjs'));
  const H = 'time\tsession\ttype\tstep\twhat\twhy\tevidence\tresult';
  const row = (s, type, what, evidence = '-') => ['2026-11-03T10:00:00+09:00', s, type, '-', what, '-', evidence, '-'].join('\t');
  const text = [
    H,
    row('w', 'start', '目的'),
    row('j1', 'decision', 'レビュー結果 pass', 'sha=abc /x/.git/gori/repos/demo/verdicts/abc/1.json'),
    row('j2', 'decision', 'レビュー結果 fail', 'sha=abc /x/.git/gori/verdicts/abc/2.json'),
    row('j3', 'decision', 'レビュー結果 pass', 'sha=abc /x/verdicts/abc/3.json'),
    // 言い換える前の記録の形（評決 pass）も、レビュー結果の行と見る。
    row('j4', 'decision', '評決 pass', 'sha=abc /x/.git/gori/repos/demo/verdicts/abc/4.json'),
  ].join('\n');
  assert.deepEqual([...workerSessions(text)].sort(), ['j3', 'w']);
});

test('record は、finding か evidence に秘密情報らしい文字列があれば書かずに 2 で終え、値を出さない', () => {
  const r = started();
  const ob = outboxDir();
  const url = ['postgres://user', 'pass@host/db'].join(':'); // 検査のための偽の値
  const rec = (extra) => verdict(r.dir, ['record', '--task', ID, ...extra], { CLAUDE_CODE_SESSION_ID: 'judge-1', GORI_VERDICT_OUTBOX: ob });
  for (const extra of [['--result', 'pass', '--evidence', `接続 ${url}`], ['--result', 'fail', '--finding', `${url} が載っている`]]) {
    const res = rec(extra);
    assert.equal(res.status, 2, res.out);
    assert.match(res.out, /secret-like: --(evidence|finding)（URL の利用者名とパスワード）/);
    assert.doesNotMatch(res.out, /pass@host/);
  }
  assert.equal(outboxFiles(ob).length, 0);
});

// 合格した commit に main を取り込んだだけの merge commit の判定。
// 作業のブランチと main に、それぞれファイルを変える commit を作り、作業の commit にだけ合格を置く。
const carrySetup = () => {
  const r = started();
  const main = r.g('branch', '--show-current').stdout.trim();
  const write = (f, text) => writeFileSync(join(r.dir, f), text);
  const ci = (m) => assert.equal(r.g('commit', '-qam', m).status, 0);
  write('shared.txt', '1\n2\n3\n4\n5\n6\n7\n8\n');
  r.g('add', '-A');
  ci('shared');
  r.g('checkout', '-q', '-b', ID);
  write('work.txt', 'work\n');
  r.g('add', '-A');
  ci('work');
  const passed = r.head();
  const pass = (sha) => {
    mkdirSync(join(recordsDir(r.dir), 'verdicts', sha), { recursive: true });
    writeFileSync(join(recordsDir(r.dir), 'verdicts', sha, `20261112T000000000Z-session-judge-1.json`), JSON.stringify({ task: ID, sha, judge: 'session:judge-1', result: 'pass', evidence: ['確かめた'], findings: [], time: '2026-11-12T09:00:00+09:00' }));
  };
  pass(passed);
  const onMain = (f, text) => {
    r.g('checkout', '-q', main);
    write(f, text);
    r.g('add', '-A');
    ci(`main ${f}`);
    r.g('checkout', '-q', ID);
  };
  return { ...r, main, write, ci, passed, pass, onMain };
};

test('check: 合格した commit に、重ならない main を自動で取り込んだだけの merge は、前の合格を引き継いで 0', () => {
  const r = carrySetup();
  r.onMain('other.txt', 'other\n');
  assert.equal(r.g('merge', '-q', '--no-edit', r.main).status, 0);
  const res = verdict(r.dir, ['check', '--task', ID, '--json']);
  assert.equal(res.status, 0, res.out);
  const j = JSON.parse(res.stdout);
  assert.equal(j.carriedFrom, r.passed);
  assert.match(j.reason, /前の合格を引き継ぐ/);
  // 引き継いだ merge に、さらに main を取り込んでも引き継ぐ。
  r.onMain('more.txt', 'more\n');
  assert.equal(r.g('merge', '-q', '--no-edit', r.main).status, 0);
  assert.equal(check(r.dir).status, 0);
  // done も書ける。
  assert.equal(log(r.dir, ['add', '--task', ID, '--type', 'done', '--what', 'w', '--result', 'r'], { CLAUDE_CODE_SESSION_ID: 'worker-1' }).status, 0);
});

test('check: 取り込みが重なるか、手を加えたか、合格が無いか、main でない枝の merge なら引き継がず 3', () => {
  // 作業と main が同じファイルを変えた（衝突はしない）。
  const overlap = carrySetup();
  overlap.write('work.txt', 'work\nmore\n');
  overlap.ci('work 2');
  overlap.pass(overlap.head());
  overlap.onMain('shared.txt', '1\n2\n3\n4\n5\n6\n7\n8 main\n');
  overlap.g('checkout', '-q', ID);
  overlap.write('shared.txt', '1 work\n2\n3\n4\n5\n6\n7\n8\n');
  overlap.ci('work 3');
  overlap.pass(overlap.head());
  assert.equal(overlap.g('merge', '-q', '--no-edit', overlap.main).status, 0);
  assert.equal(check(overlap.dir).status, 3);
  // merge commit に変更を足した。
  const amended = carrySetup();
  amended.onMain('other.txt', 'other\n');
  assert.equal(amended.g('merge', '-q', '--no-edit', amended.main).status, 0);
  amended.write('extra.txt', 'x\n');
  amended.g('add', '-A');
  assert.equal(amended.g('commit', '-q', '--amend', '--no-edit').status, 0);
  assert.equal(check(amended.dir).status, 3);
  // 一つ目の親に合格が無い。
  const unjudged = carrySetup();
  unjudged.write('work.txt', 'work\nagain\n');
  unjudged.ci('work 2');
  unjudged.onMain('other.txt', 'other\n');
  assert.equal(unjudged.g('merge', '-q', '--no-edit', unjudged.main).status, 0);
  assert.equal(check(unjudged.dir).status, 3);
  // 二つ目の親が main に含まれない。
  const side = carrySetup();
  side.g('checkout', '-q', '-b', 'side', side.main);
  side.write('side.txt', 's\n');
  side.g('add', '-A');
  side.ci('side');
  side.g('checkout', '-q', ID);
  assert.equal(side.g('merge', '-q', '--no-edit', 'side').status, 0);
  assert.equal(check(side.dir).status, 3);
});

test('pass に --suggest で勧める指摘を添えられ、check は 0 のままその指摘を出す。fail と unverified には付けられない', () => {
  const r = started();
  const ob = outboxDir();
  const rec = (extra) => verdict(r.dir, ['record', '--task', ID, ...extra], { CLAUDE_CODE_SESSION_ID: 'judge-1', GORI_VERDICT_OUTBOX: ob });
  for (const extra of [
    ['--result', 'fail', '--finding', 'f', '--suggest', 's'],
    ['--result', 'unverified', '--finding', 'f', '--evidence', 'e', '--suggest', 's'],
    ['--result', 'pass', '--evidence', 'e', '--finding', '参考: 直さなくてよい'],
  ]) {
    const res = rec(extra);
    assert.equal(res.status, 1, `${extra.join(' ')}: ${res.out}`);
  }
  assert.equal(outboxFiles(ob).length, 0);
  const ok = rec(['--result', 'pass', '--evidence', 'tests を走らせ全件通った', '--suggest', 'README の件数を 49 に直す', '--suggest', '注釈を短くする']);
  assert.equal(ok.status, 0, ok.out);
  const body = JSON.parse(readFileSync(outboxFiles(ob)[0], 'utf8'));
  assert.deepEqual(body.suggestions, ['README の件数を 49 に直す', '注釈を短くする']);
  assert.deepEqual(body.findings, []);
  // 受け取り口のレビュー結果を記録の場所に置き、check の出力を見る。
  const sha = r.head();
  mkdirSync(join(recordsDir(r.dir), 'verdicts', sha), { recursive: true });
  writeFileSync(join(recordsDir(r.dir), 'verdicts', sha, basename(outboxFiles(ob)[0])), JSON.stringify(body));
  const c = check(r.dir);
  assert.equal(c.status, 0, c.out);
  assert.match(c.out, /合格: .*直すことを勧める指摘: README の件数を 49 に直す \/ 注釈を短くする/);
  const j = JSON.parse(verdict(r.dir, ['check', '--task', ID, '--json']).stdout);
  assert.deepEqual(j.suggestions, ['README の件数を 49 に直す', '注釈を短くする']);
});
