import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { repoRoot } from '../helpers.mjs';

const RUN = join(repoRoot, 'tools', 'learning', 'extract-run');
const cleanEnv = (extra = {}) => ({
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_') && !k.startsWith('CLAUDE') && !k.startsWith('GORI_'))),
  ...extra,
});
const put = (dir, rel, text) => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), text);
};

// 一時的な gori の複製。git の操作はこの中だけで行う。
function goriClone(models = '| extract-run | haiku |\n| procedure-scout | opus |\n') {
  const dir = mkdtempSync(join(tmpdir(), 'gori-xrun-repo-'));
  put(dir, '.claude-plugin/plugin.json', JSON.stringify({ name: 'gori' }));
  put(dir, 'knowledge/config/models.md', `| 役割 | モデル |\n| --- | --- |\n${models}`);
  const g = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8', env: cleanEnv() });
  g('init', '-q', '-b', 'main');
  g('config', 'user.name', 'tester');
  g('config', 'user.email', 't@t');
  g('add', '-A');
  g('commit', '-q', '-m', 'init');
  return { dir, g };
}

// 偽の claude。起動ごとに様子を一行ずつ記録し、学び（.git/gori/learning/）に事例を書いて抽出待ちを消し、学びの外にも一つ書く。
// 標準出力と標準エラーに「会話の中身」の目印を出し、ログに写らないことを確かめる。
function fakeClaude(mode = 'write') {
  const dir = mkdtempSync(join(tmpdir(), 'gori-xrun-fake-'));
  const bin = join(dir, 'claude');
  const note = join(dir, 'note.json');
  writeFileSync(bin, `#!${process.execPath}
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const mode = ${JSON.stringify(mode)};
const scout = process.argv.includes('/gori:procedure-scout');
appendFileSync(${JSON.stringify(note)}, JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2), extracting: process.env.GORI_EXTRACTING ?? null, only: process.env.GORI_EXTRACT_SESSIONS ?? null, git: Object.keys(process.env).filter((k) => k.startsWith('GIT_')) }) + '\\n');
console.log('CONVERSATION-SECRET-TEXT');
console.error('CONVERSATION-SECRET-TEXT');
if (mode === 'sleep') setTimeout(() => {}, 60000);
else {
  if (mode === 'write') {
    mkdirSync('.git/gori/learning/cases', { recursive: true });
    writeFileSync('.git/gori/learning/cases/2026-11-03-demo.md', 'x\\n');
    writeFileSync('.git/gori/learning/cases/2026-11-03-demo-2.md', 'y\\n');
    mkdirSync('.git/gori/learning/pending', { recursive: true });
    rmSync('.git/gori/learning/pending/s-1', { force: true });
    mkdirSync('.git/gori/repos/demo/pool', { recursive: true });
    writeFileSync('.git/gori/repos/demo/pool/20261103-000000-demo.md', 'item\\n');
  }
  const failed = mode === 'fail' || (mode === 'fail-extract' && !scout) || (mode === 'fail-scout' && scout);
  process.exit(failed ? 3 : 0);
}
`);
  chmodSync(bin, 0o755);
  const notes = () => readFileSync(note, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  return { bin, note: () => notes()[0], notes, ran: () => existsSync(note) };
}

const run = (repo, home, bin, extra = [], env = {}) => {
  const r = spawnSync(process.execPath, [RUN, ...extra], { cwd: tmpdir(), encoding: 'utf8', env: cleanEnv({ GORI_HOME: home, GORI_ROOT: repo, GORI_CLAUDE_BIN: bin, ...env }) });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
};
const logs = (home) => readdirSync(join(home, 'logs')).map((f) => readFileSync(join(home, 'logs', f), 'utf8'));

test('D2: チェックアウトを cwd に、GORI_EXTRACTING=1 つきで偽の claude を起動し、git に何も commit しない', () => {
  const { dir, g } = goriClone();
  const home = mkdtempSync(join(tmpdir(), 'gori-xrun-home-'));
  const f = fakeClaude();
  const headBefore = g('rev-parse', 'HEAD').stdout.trim();
  const logBefore = g('log', '--all', '--oneline').stdout;
  const r = run(dir, home, f.bin);
  assert.equal(r.status, 0, r.out);
  const n = f.note();
  assert.equal(n.cwd, realpathSync(dir));
  assert.equal(n.extracting, '1');
  assert.deepEqual(n.git, []);
  assert.ok(n.args.includes('/gori:extract'));
  assert.equal(n.args[n.args.indexOf('--model') + 1], 'haiku');
  assert.equal(n.args[n.args.indexOf('--plugin-dir') + 1], realpathSync(dir));
  // 抽出が書いたものはチェックアウトに残り、commit も ブランチも worktree も作られない
  assert.ok(existsSync(join(dir, '.git', 'gori', 'learning', 'cases', '2026-11-03-demo.md')));
  assert.equal(g('rev-parse', 'HEAD').stdout.trim(), headBefore);
  assert.equal(g('log', '--all', '--oneline').stdout, logBefore);
  assert.equal(g('branch', '--list').stdout.trim().replace(/^\* /, ''), 'main');
  assert.equal(g('worktree', 'list').stdout.trim().split('\n').length, 1);
  assert.ok(!existsSync(join(home, 'worktrees')));
  // 続けて手順書の候補を、表の procedure-scout のモデルで、抽出と同じ渡し方で起動する
  const runs = f.notes();
  assert.equal(runs.length, 2);
  const s = runs[1];
  assert.ok(s.args.includes('/gori:procedure-scout'));
  assert.equal(s.args[s.args.indexOf('--model') + 1], 'opus');
  assert.equal(s.args[s.args.indexOf('--plugin-dir') + 1], realpathSync(dir));
  assert.deepEqual(s.args.slice(s.args.indexOf('--settings')), n.args.slice(n.args.indexOf('--settings')));
  assert.equal(s.cwd, realpathSync(dir));
  assert.equal(s.extracting, '1');
  // ログは終了コード、所要時間、起票数だけ
  const [log] = logs(home);
  assert.equal(log.trim().split('\n').length, 4);
  assert.match(log, /^exit=0\nprocedure-scout-exit=0\nseconds=\d+\nfiled=1\n$/);
  assert.ok(!log.includes('CONVERSATION-SECRET-TEXT'));
  assert.ok(!r.out.includes('CONVERSATION-SECRET-TEXT'));
  assert.ok(!existsSync(join(home, 'state', 'extract.lock')), 'ロックが残っている');
});

test('D2: ロックの持ち主が生きていれば何もしない。古いロックは取り除いて走る', () => {
  const { dir } = goriClone();
  const home = mkdtempSync(join(tmpdir(), 'gori-xrun-home-'));
  put(home, 'state/extract.lock', `${process.pid}\n`);
  const f = fakeClaude();
  const r = run(dir, home, f.bin);
  assert.equal(r.status, 0, r.out);
  assert.ok(!f.ran());
  const dead = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' }).stdout;
  put(home, 'state/extract.lock', `${dead}\n`);
  assert.equal(run(dir, home, f.bin).status, 0);
  assert.ok(f.ran());
});

test('D2: 偽の claude が失敗すれば 1 で、ログに終了コードを書く', () => {
  const { dir } = goriClone();
  const home = mkdtempSync(join(tmpdir(), 'gori-xrun-home-'));
  const r = run(dir, home, fakeClaude('fail').bin);
  assert.equal(r.status, 1);
  assert.match(logs(home)[0], /^exit=3\nprocedure-scout-exit=3\n/);
});

test('抽出が失敗しても手順書の候補は起動し、どちらかが失敗すれば 1', () => {
  const { dir } = goriClone();
  const home = mkdtempSync(join(tmpdir(), 'gori-xrun-home-'));
  const f = fakeClaude('fail-extract');
  assert.equal(run(dir, home, f.bin).status, 1);
  assert.equal(f.notes().length, 2);
  assert.match(logs(home)[0], /^exit=3\nprocedure-scout-exit=0\n/);
  const home2 = mkdtempSync(join(tmpdir(), 'gori-xrun-home-'));
  assert.equal(run(dir, home2, fakeClaude('fail-scout').bin).status, 1);
  assert.match(logs(home2)[0], /^exit=0\nprocedure-scout-exit=3\n/);
});

test('config/models に procedure-scout の行が無ければ、手順書の候補は起動せず理由をログに書く', () => {
  const { dir } = goriClone('| extract-run | haiku |\n');
  const home = mkdtempSync(join(tmpdir(), 'gori-xrun-home-'));
  const f = fakeClaude();
  assert.equal(run(dir, home, f.bin).status, 0);
  assert.equal(f.notes().length, 1);
  assert.match(logs(home)[0], /^exit=0\nprocedure-scout-exit=-\n[\s\S]*procedure-scout-skipped=config\/models に procedure-scout の行が無い\n$/);
  assert.match(run(dir, home, f.bin, ['--dry-run']).out, /手順書の候補: 起動しない（config\/models に procedure-scout の行が無い）/);
});

test('D2: 時間の上限を超えたら止める', () => {
  const { dir } = goriClone();
  const home = mkdtempSync(join(tmpdir(), 'gori-xrun-home-'));
  const t0 = Date.now();
  const r = run(dir, home, fakeClaude('sleep').bin, [], { GORI_EXTRACT_TIMEOUT_MINUTES: '0.02' });
  assert.equal(r.status, 1);
  assert.ok(Date.now() - t0 < 30_000);
  assert.match(logs(home)[0], /^exit=124\n[\s\S]*timeout=0\.02min/);
  assert.ok(!existsSync(join(home, 'state', 'extract.lock')));
});

test('D2: claude を起動できなければ 1 で、ログに残る', () => {
  const { dir } = goriClone();
  const home = mkdtempSync(join(tmpdir(), 'gori-xrun-home-'));
  const r = run(dir, home, join(tmpdir(), 'gori-no-such-claude'));
  assert.equal(r.status, 1);
  assert.match(logs(home)[0], /^exit=127\n[\s\S]*spawn-error=/);
});

test('--dry-run は起動内容だけ出し、何も作らない', () => {
  const { dir, g } = goriClone();
  const home = mkdtempSync(join(tmpdir(), 'gori-xrun-home-'));
  const f = fakeClaude();
  const r = run(dir, home, f.bin, ['--dry-run']);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /GORI_EXTRACTING=1/);
  assert.match(r.out, /"\/gori:extract"/);
  assert.match(r.out, /"haiku"/);
  assert.match(r.out, /"\/gori:procedure-scout" "--model" "opus"/);
  assert.ok(!f.ran());
  assert.ok(!existsSync(join(home, 'logs')));
  assert.ok(!existsSync(join(home, 'state')));
  assert.equal(g('status', '--porcelain').stdout.trim(), '');
});

test('D2: gori のチェックアウトを決められなければ、起動せず理由を一行ログに書いて 0', () => {
  const home = mkdtempSync(join(tmpdir(), 'gori-xrun-home-'));
  const cache = mkdtempSync(join(tmpdir(), 'gori-xrun-cache-'));
  const f = fakeClaude();
  const r = spawnSync(process.execPath, [RUN], { cwd: tmpdir(), encoding: 'utf8', env: cleanEnv({ GORI_HOME: home, GORI_CLAUDE_BIN: f.bin, CLAUDE_PLUGIN_ROOT: cache }) });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!f.ran());
  const [log] = logs(home);
  assert.match(log, /^skipped=.* は git のチェックアウトでない/);
  assert.equal(log.trim().split('\n').length, 1);
});

test('gori のチェックアウトでなければ起動しない', () => {
  const home = mkdtempSync(join(tmpdir(), 'gori-xrun-home-'));
  const other = mkdtempSync(join(tmpdir(), 'gori-xrun-other-'));
  spawnSync('git', ['-C', other, 'init', '-q'], { env: cleanEnv() });
  const f = fakeClaude();
  const r = run(other, home, f.bin);
  assert.equal(r.status, 0);
  assert.ok(!f.ran());
  assert.match(logs(home)[0], /gori のチェックアウトでない/);
});

test('フックから切り離して起動し、偽の claude まで届く（GORI_ROOT の差し替えだけで届く）', async () => {
  const { dir } = goriClone();
  const home = mkdtempSync(join(tmpdir(), 'gori-xrun-home-'));
  const f = fakeClaude();
  const r = spawnSync(process.execPath, [join(repoRoot, 'tools', 'hooks', 'session-end')], { input: '{}', encoding: 'utf8', env: cleanEnv({ GORI_HOME: home, GORI_ROOT: dir, GORI_CLAUDE_BIN: f.bin, GORI_EXTRACT_RUN: RUN }) });
  assert.equal(r.status, 0, r.stderr);
  for (let i = 0; i < 100 && !(existsSync(join(home, 'logs')) && readdirSync(join(home, 'logs')).length); i++) await new Promise((x) => setTimeout(x, 100));
  assert.ok(f.ran());
  assert.equal(f.note().cwd, realpathSync(dir));
});

test('--session で指定したセッションだけを、GORI_EXTRACT_SESSIONS で抽出に渡す', () => {
  const { dir } = goriClone();
  const home = mkdtempSync(join(tmpdir(), 'gori-xrun-home-'));
  const f = fakeClaude();
  const r = run(dir, home, f.bin, ['--session', 's-1', '--session', 's-2']);
  assert.equal(r.status, 0, r.out);
  assert.equal(f.note().only, 's-1,s-2');
  // 手順書の候補はセッションと関わりが無いので起動しない
  assert.equal(f.notes().length, 1);
  assert.match(logs(home)[0], /procedure-scout-exit=-\n[\s\S]*procedure-scout-skipped=--session\n/);
  const dry = run(dir, home, f.bin, ['--dry-run', '--session', 's-1']);
  assert.match(dry.out, /GORI_EXTRACT_SESSIONS=s-1/);
  assert.match(dry.out, /手順書の候補: 起動しない（--session）/);
  assert.doesNotMatch(dry.out, /"\/gori:procedure-scout"/);
});

test('--session が無ければ GORI_EXTRACT_SESSIONS を渡さない', () => {
  const { dir } = goriClone();
  const home = mkdtempSync(join(tmpdir(), 'gori-xrun-home-'));
  const f = fakeClaude();
  assert.equal(run(dir, home, f.bin).status, 0);
  assert.equal(f.note().only, null);
});
