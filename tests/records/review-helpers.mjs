// review の各テストのファイルが共有する補助。review.test.mjs が長く、一つのプロセスで順に走ると全体のテストの律速になるので、主題ごとのファイルに分けた。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { recordsDir, repoRoot, testGori } from '../helpers.mjs';

// 記録とプールは一時の gori のチェックアウト（GORI_ROOT）の下に置き、本物の gori の記録、プール、学びに触れない。
export const cleanEnv = (extra = {}) => ({
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_') && !k.startsWith('CLAUDE') && !k.startsWith('GORI_'))),
  GORI_ROOT: testGori(),
  ...extra,
});
export const LOG = join(repoRoot, 'tools', 'records', 'log');
export const REVIEW = join(repoRoot, 'tools', 'records', 'review');
export const VERDICT = join(repoRoot, 'tools', 'records', 'verdict');
export const ID = '20261103-100000-demo';

// 承認の行。テストはセッション ID の無い環境から書くので、端末の人間が書いたものとして照合されない。
export const approve = (cwd) => {
  const a = spawnSync(process.execPath, [LOG, 'add', '--task', ID, '--type', 'approval', '--what', '受け入れ条件の承認', '--quote', 'よい'], { cwd, encoding: 'utf8', env: cleanEnv() });
  assert.equal(a.status, 0, a.stderr);
};
// 自己点検の行（check 行）。review --dry-run が示す欠けた指しを、今の HEAD で全部書く。点検の後に commit したら、書き直す。
export const attest = (cwd, env = {}, args = []) => {
  const r = spawnSync(process.execPath, [REVIEW, '--task', ID, ...args.filter((a) => a !== '--dry-run'), '--dry-run'], { cwd, encoding: 'utf8', env: cleanEnv(env) });
  if (!r.stderr.includes('自己点検の行（check 行）が欠けている')) return;
  for (const m of r.stderr.matchAll(/^  - (.+)$/gm)) {
    const a = spawnSync(process.execPath, [LOG, 'add', '--task', ID, '--type', 'check', '--criterion', m[1], '--evidence', 'テストで点検した'], { cwd, encoding: 'utf8', env: cleanEnv(env) });
    assert.equal(a.status, 0, a.stderr);
  }
};
// 文章の発言を引いた承認の行（evidence が「発言 <uuid> 「引用」」）。会話から書く承認は --quote で、この形の evidence になる。
// ここでは review がこの形を読めることだけを確かめるので、端末から書いた行の evidence を書き換えて作る。
export const textApproval = (dir, what, session, uuid, quote) => {
  const a = spawnSync(process.execPath, [LOG, 'add', '--task', ID, '--type', 'approval', '--what', what, '--quote', quote], { cwd: dir, encoding: 'utf8', env: cleanEnv() });
  assert.equal(a.status, 0, a.stderr);
  const f = join(recordsDir(dir), 'audit', `${ID}.tsv`);
  const lines = readFileSync(f, 'utf8').split('\n');
  const i = lines.findLastIndex((l) => l.includes(`端末の人間 「${quote}」`));
  const cols = lines[i].split('\t');
  cols[1] = session;
  lines[i] = cols.join('\t').replace(`端末の人間 「${quote}」`, `発言 ${uuid} 「${quote}」`);
  writeFileSync(f, lines.join('\n'));
};
export function workRepo({ accept = true, files = { 'greet.sh': 'echo hi\n' } } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'gori-review-test-'));
  const g = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8', env: cleanEnv() });
  g('init', '-q');
  g('config', 'user.name', 'tester');
  g('config', 'user.email', 't@t');
  g('commit', '-q', '--allow-empty', '-m', 'init');
  const l = spawnSync(process.execPath, [LOG, 'start', '--task', ID, '--what', 'greet.sh が名前を挨拶する', '--procedure', 'procedures/feature'], { cwd: dir, encoding: 'utf8', env: cleanEnv({ CLAUDE_CODE_SESSION_ID: 'worker-1' }) });
  assert.equal(l.status, 0, l.stderr);
  if (accept) {
    const a = spawnSync(process.execPath, [LOG, 'add', '--task', ID, '--type', 'accept', '--what', '引数があれば Hello, <引数> を出す'], { cwd: dir, encoding: 'utf8', env: cleanEnv({ CLAUDE_CODE_SESSION_ID: 'worker-1' }) });
    assert.equal(a.status, 0, a.stderr);
    approve(dir);
  }
  for (const [f, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), text);
  }
  g('add', '-A');
  g('commit', '-q', '-m', 'greet');
  return { dir, g, head: () => g('rev-parse', 'HEAD').stdout.trim() };
}

// 既存のテストは自己点検を主題にしないので、review を呼ぶ前に欠けた check 行を書く。点検の欠けを調べるテストは reviewRaw を使う。
export const review = (dir, args, env = {}) => {
  attest(dir, env, args);
  return reviewRaw(dir, args, env);
};
export const reviewRaw = (dir, args, env = {}) => {
  const r = spawnSync(process.execPath, [REVIEW, '--task', ID, ...args], { cwd: dir, encoding: 'utf8', env: cleanEnv(env) });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
};

// 偽のレビュアー。stream-json の init 行に init のセッション ID を出し、作業ツリーの場所を記録し、モードに応じてレビュー結果を記録する。
// record: verdict record を実行するときのセッション ID（既定は init と同じ）。raw: verdict record を通さず受け取り口に直接置くレビュー結果の書き換え。
export function fakeClaude(mode, { init = 'judge-fake', record = init, raw = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'gori-fake-'));
  const bin = join(dir, 'claude');
  const note = join(dir, 'note.json');
  writeFileSync(bin, `#!${process.execPath}
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const prompt = readFileSync(0, 'utf8');
const sha = /--sha ([0-9a-f]{40})/.exec(prompt)[1];
const outbox = process.env.GORI_VERDICT_OUTBOX;
const init = ${JSON.stringify(init)};
if (init) console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: init }));
writeFileSync(${JSON.stringify(note)}, JSON.stringify({ cwd: process.cwd(), e2eLogs: existsSync('.gori-e2e') ? readdirSync('.gori-e2e').map((n) => [n, readFileSync('.gori-e2e/' + n, 'utf8')]) : [], args: process.argv.slice(2), prompt, workRepo: process.env.GORI_WORK_REPO, outbox, outboxExists: existsSync(outbox), reviewing: process.env.GORI_REVIEWING ?? null, parentSession: process.env.CLAUDE_CODE_SESSION_ID ?? null }));
const mode = ${JSON.stringify(mode)};
const raw = ${JSON.stringify(raw)};
if (raw) {
  const body = { task: ${JSON.stringify(ID)}, sha, judge: 'session:' + init, result: 'pass', evidence: ['e'], findings: [], time: 't', model: null, ...raw };
  writeFileSync(join(outbox, '20261104T000000000Z-raw.json'), JSON.stringify(body));
} else if (mode !== 'silent') {
  const a = mode === 'pass' ? ['--result', 'pass', '--evidence', 'e'] : ['--result', 'fail', '--finding', 'f'];
  const r = spawnSync(${JSON.stringify(VERDICT)}, ['record', '--task', ${JSON.stringify(ID)}, '--sha', sha, ...a], { env: { ...process.env, CLAUDE_CODE_SESSION_ID: ${JSON.stringify(record)} }, encoding: 'utf8' });
  if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
}
console.log(JSON.stringify({ type: 'result', result: 'レビュアーの\\n最後の文' }));
`);
  chmodSync(bin, 0o755);
  return { bin, note: () => JSON.parse(readFileSync(note, 'utf8')) };
}
export const verdictsIn = (dir, sha) => {
  const d = join(recordsDir(dir), 'verdicts', sha);
  return existsSync(d) ? readdirSync(d).filter((f) => f.endsWith('.json')) : [];
};
export const auditRows = (dir) => readFileSync(join(recordsDir(dir), 'audit', `${ID}.tsv`), 'utf8').trimEnd().split('\n').map((l) => l.split('\t'));


// 作業のリポジトリ（本体のチェックアウト）のプールに一件を置き、その ID を返す。
export function poolItem(gori, repoDir, criteria, { id = '20261108-090000-greet' } = {}) {
  const dir = join(gori, '.git', 'gori', 'repos', basename(realpathSync(repoDir)), 'pool');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${id}.md`);
  const put = (c) => writeFileSync(file, `---\nid: ${id}\ntitle: 挨拶する\nkind: improvement\nstatus: todo\ncreated: 2026-11-08T09:00:00+09:00\nupdated: 2026-11-08T09:00:00+09:00\n---\n## 現状\nx\n## 問題\nx\n## 期待する結果\nx\n## 確認したこと\nx\n## 受け入れ条件\n${c}\n`);
  put(criteria);
  return { id, put, dir };
}
