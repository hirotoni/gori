// 無人の作業の道具（run、watch、status）のテストが共有する、一時の gori、作業リポジトリ、偽の claude。
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { repoRoot } from '../helpers.mjs';

export const RUN = join(repoRoot, 'tools', 'auto', 'run');
export const LOG = join(repoRoot, 'tools', 'records', 'log');
export const TASK = '20261113-100000-auto-demo';
// pre-commit の中で走ると git が GIT_* を渡し、会話の中で走ると CLAUDE* や GORI_* が立っている。どれも一時リポジトリと道具に漏らさない。
export const cleanEnv = (extra = {}) => ({
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_') && !k.startsWith('CLAUDE') && !k.startsWith('GORI_') && !k.startsWith('ANTHROPIC_'))),
  ...extra,
});
export const tmp = (p) => realpathSync(mkdtempSync(join(tmpdir(), p)));
export const put = (file, text) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
};
export const git = (dir, ...a) => spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8', env: cleanEnv() });
export const LIMITS = { 'run-minutes': 60, 'worker-budget-usd': 10, 'reviewer-budget-usd': 5, 'runs-per-day': 3, 'watch-minutes': 30 };
export const limitsText = (l) => `| 上限 | 値 |\n| --- | --- |\n${Object.entries(l).map(([k, v]) => `| ${k} | ${v} |`).join('\n')}\n`;

// 一時の gori のチェックアウト（上限とモデルの表を持つ）と、空の設定の置き場所。
export function fakeGori(limits = LIMITS) {
  // 記録の置き場所の名前はディレクトリの名前から決まるので、gori 自身を作業リポジトリにする場合に備えて gori にする。
  const dir = join(tmp('gori-run-gori-'), 'gori');
  mkdirSync(dir);
  git(dir, 'init', '-q', '-b', 'main');
  put(join(dir, '.claude-plugin', 'plugin.json'), '{"name":"gori"}\n');
  put(join(dir, 'knowledge', 'config', 'models.md'), '| 役割 | モデル |\n| --- | --- |\n| implementer | sonnet |\n');
  if (limits) put(join(dir, 'knowledge', 'config', 'auto.md'), limitsText(limits));
  // run は、担当に渡すプラグインとして gori の main の worktree を作るので、main に commit を一つ置く。
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'gori');
  return dir;
}
// 作業リポジトリと、そのプールの一件。
export function workRepo(gori, name = 'app') {
  const dir = join(tmp('gori-run-work-'), name);
  mkdirSync(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'init');
  put(join(gori, '.git', 'gori', 'repos', name, 'repo.yml'), `path: ${dir}\n`);
  return dir;
}
export function item(gori, name, id, status = 'todo', kind = 'learning') {
  put(join(gori, '.git', 'gori', 'repos', name, 'pool', `${id}.md`), `---\nid: ${id}\ntitle: ${id} の題\nkind: ${kind}\nstatus: ${status}\ncreated: 2026-11-08T09:00:00+09:00\nupdated: 2026-11-08T09:00:00+09:00\n---\n## 現状\nx\n## 問題\nx\n## 期待する結果\nx\n## 確認したこと\nx\n## 受け入れ条件\n- 通る\n`);
  return id;
}

// gori 自身を作業リポジトリとして登録する（プールの名前は gori）。学びの一件の無人の取り込みは、このリポジトリだけが対象である。
export function selfRepo(gori) {
  put(join(gori, '.gitignore'), '.worktree/\n');
  git(gori, 'add', '-A');
  git(gori, 'commit', '-q', '-m', 'init');
  put(join(gori, '.git', 'gori', 'repos', 'gori', 'repo.yml'), `path: ${gori}\n`);
  return gori;
}

// 偽の claude。auth status には auth の JSON を返す。-p の起動は様子を記録し、mode に応じて振る舞う。
// pass-steps は、手順書の手順を最後の一つだけ残して合格する。pass-gap は、途中の手順を残したまま合格する。pass-steps-move-main は、合格したうえで柵を外して main を進める。pass-fix-step と pass-fix-accept は、手順の行か受け入れ条件の行を訂正してから合格する。pass-steps-lock-pool は、合格したうえでプールの置き場所を読み取り専用にし、取り込んだ後にプールの一件を done にできなくする。どれも worktree を本体の .worktree/ の下に作る。pause-early は、作業 ID を道具に付けさせて作業を始め、受け入れ条件の行を書く前に pause で止まる。
export function fakeClaude(mode = 'idle', { auth = { loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty' }, name = 'app' } = {}) {
  const dir = tmp('gori-run-fake-');
  const bin = join(dir, 'claude');
  const note = join(dir, 'note.json');
  writeFileSync(bin, `#!${process.execPath}
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
const argv = process.argv.slice(2);
if (argv[0] === 'auth') { console.log(${JSON.stringify(typeof auth === 'string' ? auth : JSON.stringify(auth))}); process.exit(0); }
const mode = ${JSON.stringify(mode)};
const id = /pool:(\\S+?)\`/.exec(argv[1])?.[1];
const e = process.env;
writeFileSync(${JSON.stringify(note)}, JSON.stringify({ cwd: process.cwd(), args: argv, id, auto: e.GORI_AUTO ?? null, hooks: e.GIT_CONFIG_VALUE_0 ?? null, hooksKey: e.GIT_CONFIG_KEY_0 ?? null, gh: e.GH_CONFIG_DIR ?? null, ghEmpty: e.GH_CONFIG_DIR ? readdirSync(e.GH_CONFIG_DIR).length === 0 : null, ignoreUpstream: e.GORI_IGNORE_UPSTREAM ?? null, leaked: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY', 'ANTHROPIC_BASE_URL', 'GH_TOKEN', 'GITHUB_TOKEN', 'CLAUDE_CODE_SESSION_ID'].filter((k) => k in e) }));
const run = (cmd, args, opts = {}) => { const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts }); if (r.status !== 0) { console.error(cmd, args.join(' '), r.stderr); process.exit(9); } return r.stdout.trim(); };
const worker = { ...e, CLAUDE_CODE_SESSION_ID: 'worker-1' };
const done = (o) => console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 1.25, session_id: 'sess-1', result: 'CONVERSATION-TEXT', ...o }));
if (mode === 'sleep') setTimeout(() => {}, 60000);
else if (mode === 'exit3') process.exit(3);
else if (mode === 'budget') { done({ subtype: 'error_max_budget_usd', is_error: true }); process.exit(1); }
else {
  const steps = ['pass-steps', 'pass-steps-move-main', 'pass-steps-lock-pool', 'pass-fix-step', 'pass-fix-accept'].includes(mode) ? 7 : mode === 'pass-gap' ? 5 : 0;
  const pass = mode === 'pass' || steps > 0;
  if (pass || mode === 'stop') {
    run(${JSON.stringify(LOG)}, ['start', '--task', ${JSON.stringify(TASK)}, '--what', '目的', ...(steps ? ['--procedure', 'procedures/harness-change'] : [])], { env: worker });
    for (let n = 1; n <= steps; n++) run(${JSON.stringify(LOG)}, ['add', '--task', ${JSON.stringify(TASK)}, '--type', 'step-done', '--step', String(n), '--evidence', 'e'], { env: worker });
    run(${JSON.stringify(LOG)}, ['add', '--task', ${JSON.stringify(TASK)}, '--type', 'accept', '--what', 'pool:' + id], { env: worker });
  }
  // 手順の行の訂正（行 11 は手順 1 の step-done）と、受け入れ条件の行の訂正（行 18 は accept）。
  if (mode === 'pass-fix-step') run(${JSON.stringify(LOG)}, ['add', '--task', ${JSON.stringify(TASK)}, '--type', 'fix', '--what', '行 11 を訂正: 手順の書き方を直した'], { env: worker });
  if (mode === 'pass-fix-accept') run(${JSON.stringify(LOG)}, ['add', '--task', ${JSON.stringify(TASK)}, '--type', 'fix', '--what', '行 18 を訂正: pool:' + id + ' の条件を読み替えた'], { env: worker });
  if (pass) {
    const wt = steps ? join(process.cwd(), '.worktree', basename(process.cwd()), ${JSON.stringify(TASK)}) : join(${JSON.stringify(dir)}, 'wt');
    run('git', ['worktree', 'add', '-q', '-b', ${JSON.stringify(TASK)}, wt]);
    writeFileSync(join(wt, 'work.txt'), 'work\\n');
    run('git', ['-C', wt, 'add', 'work.txt']);
    run('git', ['-C', wt, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'work']);
    const sha = run('git', ['-C', wt, 'rev-parse', 'HEAD']);
    // レビュアーのレビュー結果は、review が取り込む形のファイルを記録の場所に直接置いて代える。
    const vdir = join(e.GORI_ROOT, '.git', 'gori', 'repos', ${JSON.stringify(name)}, 'verdicts', sha);
    mkdirSync(vdir, { recursive: true });
    writeFileSync(join(vdir, '20261113T000000000Z-session-judge-1.json'), JSON.stringify({ task: ${JSON.stringify(TASK)}, sha, judge: 'session:judge-1', result: 'pass', evidence: ['e'], findings: [], time: '2026-11-13T10:00:00+09:00', model: null }));
  }
  if (mode === 'move-main' || mode === 'pass-steps-move-main') run('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'moved']);
  if (mode === 'dirty') writeFileSync('left-behind.txt', 'x');
  if (mode === 'pass-steps-lock-pool') {
    const pool = join(e.GORI_ROOT, '.git', 'gori', 'repos', ${JSON.stringify(name)}, 'pool');
    for (const f of readdirSync(pool)) chmodSync(join(pool, f), 0o444);
    chmodSync(pool, 0o555);
  }
  // 受け入れ条件の行を書く前に pause で止まる。結果の session_id は、判断の記録の行を書いたセッションと同じにする（本物の claude -p と同じ）。
  if (mode === 'pause-early') {
    // 本物の担当と同じく、作業 ID は始めた時刻から道具に付けさせる（run は実行より前に始めた作業を探さない）。
    const early = /^TASK_ID=(\\S+)$/m.exec(run(${JSON.stringify(LOG)}, ['start', '--slug', 'auto-early', '--what', '目的'], { env: worker }))[1];
    run(${JSON.stringify(LOG)}, ['add', '--task', early, '--type', 'pause', '--what', '適用せずに返すと決めた', '--why', '学びが当てはまらない', '--evidence', '次の一手: 人間に確かめる'], { env: worker });
    done({ session_id: 'worker-1' });
  } else done({});
}
`);
  chmodSync(bin, 0o755);
  return { bin, launched: () => existsSync(note), note: () => JSON.parse(readFileSync(note, 'utf8')) };
}

export function run(gori, fake, { env = {}, args = [] } = {}) {
  const config = tmp('gori-run-config-');
  const r = spawnSync(process.execPath, [RUN, ...args], { encoding: 'utf8', env: cleanEnv({ GORI_ROOT: gori, GORI_CLAUDE_BIN: fake.bin, CLAUDE_CONFIG_DIR: config, ...env }) });
  return { status: r.status, out: `${r.stdout}${r.stderr}`, result: /^RESULT=(\S+)$/m.exec(r.stdout)?.[1] ?? null };
}
export const records = (gori) => {
  const d = join(gori, '.git', 'gori', 'auto', 'runs');
  return existsSync(d) ? readdirSync(d).sort().map((f) => JSON.parse(readFileSync(join(d, f), 'utf8'))) : [];
};
export const setup = (mode, limits) => {
  const gori = fakeGori(limits);
  const repo = workRepo(gori);
  const id = item(gori, 'app', '20261108-090000-first');
  return { gori, repo, id, fake: fakeClaude(mode) };
};

