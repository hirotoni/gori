import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test } from 'node:test';
import { recordsDir, repoRoot, testGori } from '../helpers.mjs';

// 課題の worktree の中で記録の道具を使っても、記録は gori のチェックアウトの .git/gori/repos/<本体の名前>/ に書かれ、worktree を消した後も残ることを確かめる。
// gori のチェックアウトは一時のもの（GORI_ROOT）にし、本物の gori の記録に触れない。
const cleanEnv = (extra = {}) => ({
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_') && !k.startsWith('CLAUDE') && !k.startsWith('GORI_'))),
  GORI_ROOT: testGori(),
  ...extra,
});
const LOG = join(repoRoot, 'tools', 'records', 'log');
const VERDICT = join(repoRoot, 'tools', 'records', 'verdict');
const REVIEW = join(repoRoot, 'tools', 'records', 'review');
const TRACE = join(repoRoot, 'tools', 'records', 'trace');
const SESSIONS = join(repoRoot, 'tools', 'learning', 'sessions');
const ID = '20261104-100000-demo';

const exec = (bin, cwd, args, env = {}) => {
  const r = spawnSync(process.execPath, [bin, ...args], { cwd, encoding: 'utf8', env: cleanEnv(env) });
  return { status: r.status, out: `${r.stdout}${r.stderr}`, stdout: r.stdout };
};
const worker = { CLAUDE_CODE_SESSION_ID: 'worker-1' };
// review は、レビューする commit の点検の行（check 行）が欠けていれば止まる。この確かめの対象ではないので、欠けた指しを書いてから呼ぶ。
const attest = (cwd, env = {}) => {
  const r = exec(REVIEW, cwd, ['--task', ID, '--dry-run'], env);
  for (const m of r.out.matchAll(/^  - (.+)$/gm)) {
    const a = exec(LOG, cwd, ['add', '--task', ID, '--type', 'check', '--criterion', m[1], '--evidence', 'テストで点検した'], env);
    assert.equal(a.status, 0, a.out);
  }
};

// 本体のチェックアウトと、dispatch と同じく本体の .worktree/ の下に置いた課題の worktree を作る。worktree の HEAD は本体の HEAD と違う commit にする。
function setup() {
  const main = realpathSync(mkdtempSync(join(tmpdir(), 'gori-wt-main-')));
  const g = (dir, ...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8', env: cleanEnv() });
  g(main, 'init', '-q');
  g(main, 'config', 'user.name', 'tester');
  g(main, 'config', 'user.email', 't@t');
  writeFileSync(join(main, '.git', 'info', 'exclude'), '.worktree/\n');
  g(main, 'commit', '-q', '--allow-empty', '-m', 'init');
  const wt = join(main, '.worktree', 'task-1');
  const add = g(main, 'worktree', 'add', '-q', '-b', 'improvement/task-1', wt);
  assert.equal(add.status, 0, add.stderr);
  const l = exec(LOG, wt, ['start', '--task', ID, '--what', 'greet.sh が挨拶する'], worker);
  assert.equal(l.status, 0, l.out);
  const a = exec(LOG, wt, ['add', '--task', ID, '--type', 'accept', '--what', 'greet.sh が挨拶する'], worker);
  assert.equal(a.status, 0, a.out);
  // 承認の行はセッション ID の無い環境（端末の人間）から書くので、会話の記録と照合されない。
  const ap = exec(LOG, wt, ['add', '--task', ID, '--type', 'approval', '--what', '受け入れ条件の承認', '--quote', 'よい']);
  assert.equal(ap.status, 0, ap.out);
  writeFileSync(join(wt, 'greet.sh'), 'echo hi\n');
  g(wt, 'add', '-A');
  g(wt, 'commit', '-q', '-m', 'greet');
  const head = (dir) => g(dir, 'rev-parse', 'HEAD').stdout.trim();
  assert.notEqual(head(wt), head(main));
  return { main, wt, g, head };
}
// 記録の場所。本体のチェックアウトの名前で、gori のチェックアウトの .git/gori/repos/<名前>/ に決まる。
const auditOf = (root) => join(recordsDir(root), 'audit', `${ID}.tsv`);
const verdictsOf = (root, sha) => {
  const d = join(recordsDir(root), 'verdicts', sha);
  return existsSync(d) ? readdirSync(d).filter((f) => f.endsWith('.json')) : [];
};
const removeWorktree = (s) => {
  const r = s.g(s.main, 'worktree', 'remove', '--force', s.wt);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!existsSync(s.wt));
};

const ptyDenied = (() => {
  const argv = process.platform === 'darwin' ? ['-q', '/dev/null', '/usr/bin/true'] : ['-qec', 'true', '/dev/null'];
  const r = spawnSync('script', argv, { encoding: 'utf8', stdio: [openSync('/dev/null', 'r'), 'pipe', 'pipe'] });
  return r.status !== 0 && /openpty/i.test(`${r.stderr}${r.stdout}`);
})();
const ptyTest = (name, fn) => test(name, ptyDenied ? { skip: '疑似端末を開けない環境（script: openpty が拒まれた）なので飛ばす' } : {}, fn);
const inPty = (dir, args) => {
  const cmd = [process.execPath, VERDICT, ...args];
  const argv = process.platform === 'darwin' ? ['-q', '/dev/null', ...cmd] : ['-qec', cmd.map((a) => `'${a.replaceAll("'", "'\\''")}'`).join(' '), '/dev/null'];
  const r = spawnSync('script', argv, { cwd: dir, encoding: 'utf8', env: cleanEnv(), stdio: [openSync('/dev/null', 'r'), 'pipe', 'pipe'] });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
};

test('worktree の中の log start と log add は、本体の名前の記録の場所の audit に書き、start 行には worktree の HEAD を残す', () => {
  const s = setup();
  assert.ok(existsSync(auditOf(s.main)));
  assert.ok(!existsSync(recordsDir(s.wt)), 'worktree の名前の記録の場所ができている');
  assert.ok(!existsSync(join(s.main, '.git', 'gori')), '作業リポジトリの古い置き場所に書いた');
  assert.ok(!existsSync(join(s.wt, '.gori')), 'worktree に .gori/ ができている');
  const rows = readFileSync(auditOf(s.main), 'utf8').trimEnd().split('\n').map((l) => l.split('\t'));
  const base = s.g(s.wt, 'rev-parse', 'HEAD~1').stdout.trim();
  assert.equal(rows[1][7], `base=${base}`);
  assert.equal(rows[2][2], 'accept');
  assert.equal(s.g(s.wt, 'status', '--porcelain').stdout.trim(), '');
  assert.equal(s.g(s.main, 'status', '--porcelain').stdout.trim(), '');
  const st = exec(LOG, s.wt, ['state', '--task', ID, '--json']);
  assert.equal(st.status, 0, st.out);
  assert.equal(JSON.parse(st.stdout).head.sha, s.head(s.wt));
});

ptyTest('worktree の中の端末の verdict record は、worktree の HEAD のレビュー結果を本体の名前の記録の場所の verdicts に書き、worktree を消しても残る', () => {
  const s = setup();
  const sha = s.head(s.wt);
  const res = inPty(s.wt, ['record', '--task', ID, '--result', 'pass', '--evidence', 'tests を走らせた']);
  assert.equal(res.status, 0, res.out);
  assert.equal(verdictsOf(s.main, sha).length, 1);
  assert.ok(!existsSync(join(s.wt, '.gori')), 'worktree に .gori/ ができている');
  assert.match(readFileSync(auditOf(s.main), 'utf8').trimEnd().split('\n').at(-1), /レビュー結果 pass/);
  assert.match(exec(VERDICT, s.wt, ['check', '--task', ID]).out, /合格/);
  removeWorktree(s);
  assert.equal(verdictsOf(s.main, sha).length, 1);
  const c = exec(VERDICT, s.main, ['check', '--task', ID, '--sha', sha]);
  assert.equal(c.status, 0, c.out);
  assert.match(c.out, /合格/);
});

test('worktree の中の review は、レビュー結果を本体の名前の記録の場所に取り込み、worktree を消しても残る', () => {
  const s = setup();
  const sha = s.head(s.wt);
  const dir = mkdtempSync(join(tmpdir(), 'gori-fake-'));
  const bin = join(dir, 'claude');
  writeFileSync(bin, `#!${process.execPath}
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const prompt = readFileSync(0, 'utf8');
const sha = /--sha ([0-9a-f]{40})/.exec(prompt)[1];
console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'judge-fake' }));
const r = spawnSync(${JSON.stringify(VERDICT)}, ['record', '--task', ${JSON.stringify(ID)}, '--sha', sha, '--result', 'pass', '--evidence', 'e'], { env: { ...process.env, CLAUDE_CODE_SESSION_ID: 'judge-fake' }, encoding: 'utf8' });
if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
`);
  chmodSync(bin, 0o755);
  attest(s.wt, worker);
  const res = exec(REVIEW, s.wt, ['--task', ID], { GORI_CLAUDE_BIN: bin, ...worker });
  assert.equal(res.status, 0, res.out);
  assert.equal(verdictsOf(s.main, sha).length, 1);
  // レビュアーの出力は写さない（docs/design.md の記録の置き場所）。
  assert.ok(!existsSync(join(recordsDir(s.main), 'reviews')));
  assert.ok(!existsSync(join(s.wt, '.gori')), 'worktree に .gori/ ができている');
  assert.equal(s.g(s.wt, 'status', '--porcelain').stdout.trim(), '');
  const tr = exec(TRACE, s.wt, [ID]);
  assert.equal(tr.status, 0, tr.out);
  assert.ok(tr.out.includes(`"gori/repos/${basename(s.main)}/verdicts/`), tr.out);
  removeWorktree(s);
  assert.equal(verdictsOf(s.main, sha).length, 1);
  const rows = readFileSync(auditOf(s.main), 'utf8').trimEnd().split('\n').map((l) => l.split('\t'));
  assert.deepEqual([rows.at(-1)[1], rows.at(-1)[4]], ['judge-fake', 'レビュー結果 pass']);
  const c = exec(VERDICT, s.main, ['check', '--task', ID, '--sha', sha]);
  assert.equal(c.status, 0, c.out);
});

test('worktree から review を依頼すると、レビュアーのサンドボックスは worktree、git の共通ディレクトリ、本体の作業ツリー、gori のチェックアウトへの書き込みを塞ぐ', () => {
  const s = setup();
  attest(s.wt);
  const res = exec(REVIEW, s.wt, ['--task', ID, '--dry-run']);
  assert.equal(res.status, 0, res.out);
  const m = /"--settings" ("(?:[^"\\]|\\.)*")/.exec(res.out);
  const settings = JSON.parse(JSON.parse(m[1]));
  const deny = settings.sandbox.filesystem.denyWrite;
  assert.ok(deny.includes(realpathSync(s.wt)), JSON.stringify(deny));
  assert.ok(deny.includes(join(s.main, '.git')), JSON.stringify(deny));
  assert.ok(deny.includes(realpathSync(s.main)), JSON.stringify(deny));
  assert.ok(deny.includes(realpathSync(testGori())), JSON.stringify(deny));
  assert.ok(deny.includes(join(realpathSync(testGori()), '.git')), JSON.stringify(deny));
});

test('受け取り口が記録の場所か作業リポジトリの git の共通ディレクトリの中にあれば、worktree のレビュアーの record は拒まれる', () => {
  const s = setup();
  for (const ob of [join(recordsDir(s.main), 'outbox'), join(s.main, '.git', 'outbox')]) {
    mkdirSync(ob, { recursive: true });
    const res = exec(VERDICT, s.wt, ['record', '--task', ID, '--result', 'pass', '--evidence', 'e'], { CLAUDE_CODE_SESSION_ID: 'judge-1', GORI_VERDICT_OUTBOX: ob });
    assert.equal(res.status, 1, res.out);
    assert.match(res.out, /not-judge/);
    assert.deepEqual(readdirSync(ob), []);
  }
});

test('worktree を片付けた後も、sessions は会話の cwd の祖先からリポジトリの記録（本体の名前の記録の場所）を引き、作業 ID を出す', () => {
  const s = setup();
  removeWorktree(s);
  const proj = mkdtempSync(join(tmpdir(), 'gori-wt-proj-'));
  mkdirSync(join(proj, '-a'));
  writeFileSync(join(proj, '-a', 'worker-1.jsonl'), `${JSON.stringify({ type: 'user', uuid: 'u-1', cwd: s.wt, timestamp: '2026-11-04T01:00:00.000Z', message: { role: 'user', content: '直して' } })}\n`);
  const root = mkdtempSync(join(tmpdir(), 'gori-wt-root-'));
  mkdirSync(join(root, '.claude-plugin'));
  writeFileSync(join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'gori' }));
  gitIn(root, 'init', '-q');
  // SessionEnd フックが積んだのと同じ形で、会話を抽出待ちに置く（tools/lib/learning.mjs の enqueue）。
  mkdirSync(join(root, '.git', 'gori', 'learning', 'pending'), { recursive: true });
  writeFileSync(join(root, '.git', 'gori', 'learning', 'pending', 'worker-1'), `${join(proj, '-a', 'worker-1.jsonl')}\n`);
  const r = exec(SESSIONS, tmpdir(), ['--unprocessed', '--root', root, '--projects', proj]);
  assert.equal(r.status, 0, r.out);
  const row = JSON.parse(r.stdout.trim().split('\n')[0]);
  assert.equal(row.repo, s.main);
  assert.deepEqual(row.tasks, [ID]);
  // extract の手順と同じく、出力の repo をそのまま trace に渡せば判断の記録とレビュー結果まで辿れる。
  const tr = exec(TRACE, tmpdir(), [ID, '--repo', row.repo, '--projects', proj]);
  assert.equal(tr.status, 0, tr.out);
  assert.match(tr.out, /"source":"audit"/);
});

// bare や --separate-git-dir でも、記録は git worktree list の先頭（本体）の名前の記録の場所に置き、作業ツリーに .gori/ を作らず、
// 作業リポジトリの git の共通ディレクトリの下にも書かず、警告しない。
const inCommon = (common, wt, name) => {
  const r = exec(LOG, wt, ['start', '--task', ID, '--what', '目的'], worker);
  assert.equal(r.status, 0, r.out);
  assert.ok(existsSync(join(testGori(), '.git', 'gori', 'repos', name, 'audit', `${ID}.tsv`)), r.out);
  assert.ok(!existsSync(join(common, 'gori')), '作業リポジトリの git の共通ディレクトリに書いた');
  assert.ok(!existsSync(join(wt, '.gori')), 'worktree に .gori/ ができている');
  assert.doesNotMatch(r.out, /警告/);
};
const gitIn = (dir, ...a) => {
  const r = spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8', env: cleanEnv() });
  assert.equal(r.status, 0, r.stderr);
  return r;
};

test('bare リポジトリの worktree では、記録を bare リポジトリの名前（git worktree list の先頭）の記録の場所に置く', () => {
  const top = realpathSync(mkdtempSync(join(tmpdir(), 'gori-wt-bare-')));
  const src = join(top, 'src');
  mkdirSync(src);
  gitIn(src, 'init', '-q');
  gitIn(src, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init');
  spawnSync('git', ['clone', '-q', '--bare', src, join(top, 'bare.git')], { env: cleanEnv() });
  gitIn(join(top, 'bare.git'), 'worktree', 'add', '-q', '-b', 'w', join(top, 'wt'));
  inCommon(join(top, 'bare.git'), join(top, 'wt'), 'bare.git');
});

test('--separate-git-dir の本体の worktree では（本体が残っていても、消えていても）、記録を git ディレクトリの名前（git worktree list の先頭）の記録の場所に置く', () => {
  const top = realpathSync(mkdtempSync(join(tmpdir(), 'gori-wt-gone-')));
  const main = join(top, 'main');
  gitIn(top, 'init', '-q', '--separate-git-dir', join(top, 'gd'), main);
  gitIn(main, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init');
  gitIn(main, 'worktree', 'add', '-q', '-b', 'w', join(top, 'wt'));
  inCommon(join(top, 'gd'), join(top, 'wt'), 'gd');
  assert.ok(!existsSync(join(main, '.gori')), '本体の作業ツリーに .gori/ ができている');
  rmSync(main, { recursive: true, force: true });
  rmSync(join(testGori(), '.git', 'gori', 'repos', 'gd', 'audit'), { recursive: true, force: true });
  inCommon(join(top, 'gd'), join(top, 'wt'), 'gd');
});

test('worktree でない作業ツリーでは、そのディレクトリの名前の記録の場所に置き、.git/gori/ には書かず、警告しない', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'gori-wt-plain-')));
  gitIn(dir, 'init', '-q');
  const r = exec(LOG, dir, ['start', '--task', ID, '--what', '目的'], worker);
  assert.equal(r.status, 0, r.out);
  assert.ok(existsSync(auditOf(dir)));
  assert.ok(!existsSync(join(dir, '.gori')));
  assert.ok(!existsSync(join(dir, '.git', 'gori')));
  assert.doesNotMatch(r.out, /警告/);
});
