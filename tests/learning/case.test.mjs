import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { readFrontmatter } from '../../tools/lib/frontmatter.mjs';
import { repoRoot } from '../helpers.mjs';

// 会話の記録も gori の置き場所も一時ディレクトリに作り、本物の ~/.claude/projects と本体の学び（gori/learning/）に触れない。
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_') && !k.startsWith('CLAUDE') && !k.startsWith('GORI_')));
const put = (dir, rel, text) => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), text);
};
const goriTree = () => {
  const dir = mkdtempSync(join(tmpdir(), 'gori-case-'));
  put(dir, '.claude-plugin/plugin.json', JSON.stringify({ name: 'gori' }));
  spawnSync('git', ['init', '-q', dir], { env: cleanEnv() });
  return dir;
};
// 学びは gori のチェックアウトの git の共通ディレクトリの下の gori/learning/ に置く。
const L = (root, ...p) => join(root, '.git', 'gori', 'learning', ...p);

const SID = '11111111-2222-3333-4444-555555555555';
const J = (o) => JSON.stringify(o);
function projects() {
  const dir = mkdtempSync(join(tmpdir(), 'gori-case-proj-'));
  const lines = [
    J({ type: 'user', uuid: 'u-1', sessionId: SID, timestamp: '2026-11-03T01:00:00.000Z', message: { role: 'user', content: 'テストを走らせていないのに\n完了と言わないで' } }),
    J({ type: 'assistant', uuid: 'a-1', sessionId: SID, timestamp: '2026-11-03T01:01:00.000Z', message: { content: [{ type: 'text', text: 'アシスタントが完了と言った' }] } }),
    J({ type: 'user', uuid: 'r-1', sessionId: SID, timestamp: '2026-11-03T01:02:00.000Z', message: { content: [{ type: 'tool_result', tool_use_id: 't', content: 'ツールの結果の文字列' }] } }),
  ];
  put(dir, `-proj/${SID}.jsonl`, `${lines.join('\n')}\n`);
  return dir;
}

const run = (args, opts = {}) => {
  const r = spawnSync(process.execPath, [join(repoRoot, 'tools', 'learning', 'case'), ...args], { encoding: 'utf8', env: cleanEnv(), cwd: opts.cwd ?? tmpdir() });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
};
const base = (root, proj, extra = {}) => {
  const f = { id: '2026-11-03-unverified-done', type: 'correction', pattern: 'unverified-done', session: SID, message: 'u-1', quote: '完了と言わないで', body: 'テストを走らせずに完了と報告した。テストの出力を確かめてから報告するのが正しい。', ...extra };
  const args = ['add', '--root', root, '--projects', proj];
  for (const [k, v] of Object.entries(f)) if (v !== null) args.push(`--${k}`, v);
  return args;
};

test('C1: 正しい入力で gori/learning/cases/<id>.md を書き、frontmatter が読み戻せる', () => {
  const root = goriTree();
  const r = run(base(root, projects()));
  assert.equal(r.status, 0, r.out);
  const file = L(root, 'cases', '2026-11-03-unverified-done.md');
  const fm = readFrontmatter(readFileSync(file, 'utf8'));
  assert.ok(!fm.error, fm.error?.message);
  const v = (k) => fm.fields[k].value;
  assert.deepEqual(['id', 'type', 'pattern', 'session', 'message', 'quote'].map(v), ['2026-11-03-unverified-done', 'correction', 'unverified-done', SID, 'u-1', '完了と言わないで']);
  assert.match(fm.bodyLines.join('\n'), /テストの出力を確かめてから報告する/);
});

test('C1: 改行をまたぐ引用は、空白を詰めて照合する', () => {
  const r = run(base(goriTree(), projects(), { quote: 'テストを走らせていないのに 完了と言わないで' }));
  assert.equal(r.status, 0, r.out);
});

test('C1: 同じ id の二度目は失敗し、最初の事例を書き換えない', () => {
  const root = goriTree();
  const proj = projects();
  assert.equal(run(base(root, proj)).status, 0);
  const file = L(root, 'cases', '2026-11-03-unverified-done.md');
  const before = readFileSync(file, 'utf8');
  const r = run(base(root, proj, { pattern: 'other-pattern', body: '別の本文' }));
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /case-exists/);
  assert.equal(readFileSync(file, 'utf8'), before);
});

test('C1: 同じ発言、同じ pattern の事例を別の id で書き足せない', () => {
  const root = goriTree();
  const proj = projects();
  assert.equal(run(base(root, proj)).status, 0);
  const r = run(base(root, proj, { id: '2026-11-04-unverified-done' }));
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /case-duplicate/);
});

test('C1: 引用が会話の記録の発言に無ければ拒む', () => {
  const root = goriTree();
  const proj = projects();
  const cases = [
    { quote: '確かめてから完了と言って' }, // 発言に無い文字列
    { quote: 'アシスタントが完了と言った' }, // アシスタントの発言
    { message: 'r-1', quote: 'ツールの結果の文字列' }, // ツールの結果は人間の発言でない
    { message: 'u-404' }, // 無い uuid
  ];
  for (const c of cases) {
    const r = run(base(root, proj, c));
    assert.equal(r.status, 1, `${J(c)}: ${r.out}`);
    assert.match(r.out, /quote-unverified/);
  }
  assert.equal(existsSync(L(root, 'cases')), false);
});

test('C1: 会話の記録が無ければ照合を飛ばして書く', () => {
  const root = goriTree();
  const empty = mkdtempSync(join(tmpdir(), 'gori-case-empty-'));
  const r = run(base(root, empty, { quote: '会話の記録には無い言葉' }));
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /照合を飛ばした/);
  assert.ok(existsSync(L(root, 'cases', '2026-11-03-unverified-done.md')));
});

test('C1: 秘密情報らしい文字列を quote か body に含むなら拒む', () => {
  const root = goriTree();
  const empty = mkdtempSync(join(tmpdir(), 'gori-case-empty-'));
  const secrets = [
    { body: '-----BEGIN OPENSSH PRIVATE KEY----- を貼った' }, // check-public: allow-secret（検査のための偽の値）
    { body: `キーは AKIA${'A'.repeat(16)} だった` },
    { body: `ghp_${'a'.repeat(36)} を使った` },
    { quote: `sk-ant-${'x'.repeat(30)}` },
    { body: 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123' }, // check-public: allow-secret（検査のための偽の値）
    { body: 'password=hunter22 と書いた' }, // check-public: allow-secret（検査のための偽の値）
    { quote: 'API_KEY: abcd1234' }, // check-public: allow-secret（検査のための偽の値）
    { body: `xoxb-${'1'.repeat(12)}-abc` },
    { body: `eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sig` }, // check-public: allow-secret（検査のための偽の値）
    { body: `接続先は ${['postgres://user', 'pass@host/db'].join(':')} だった` },
    { quote: `Authorization: Basic ${'dXNlcjpwYXNz'}` },
  ];
  for (const s of secrets) {
    const r = run(base(root, empty, s));
    assert.equal(r.status, 1, `${J(s)}: ${r.out}`);
    assert.match(r.out, /secret-like/);
  }
  assert.equal(existsSync(L(root, 'cases')), false);
  // 秘密情報の語を説明するだけの文は通す。
  const ok = run(base(root, empty, { body: 'パスワードを確かめずに完了と言った。トークンの期限を見るのが正しい。' }));
  assert.equal(ok.status, 0, ok.out);
});

test('C1: 入力の形が誤っていれば書かない', () => {
  const root = goriTree();
  const empty = mkdtempSync(join(tmpdir(), 'gori-case-empty-'));
  for (const c of [{ id: 'unverified-done' }, { type: 'mistake' }, { pattern: 'Unverified Done' }, { body: null }, { quote: 'x'.repeat(201) }]) {
    const r = run(base(root, empty, c));
    assert.equal(r.status, 2, `${J(c)}: ${r.out}`);
  }
  assert.equal(existsSync(L(root, 'cases')), false);
});

test('gori でないディレクトリには書かない', () => {
  const notGori = mkdtempSync(join(tmpdir(), 'gori-case-x-'));
  const r = run(base(notGori, projects()));
  assert.equal(r.status, 2, r.out);
  assert.match(r.out, /gori のリポジトリでない/);
  assert.deepEqual(readdirSync(notGori), []);
});

test('レビュー結果の fail の findings から事例を書き、findings に無い引用は拒む', () => {
  const root = goriTree();
  // レビュー結果は gori のチェックアウトの .git/gori/repos/<名前>/verdicts/ にある。
  const work = join(root, '.git', 'gori', 'repos', 'demo');
  put(work, 'verdicts/abc/1.json', J({ task: '2026-11-03-demo', sha: 'abc', result: 'fail', findings: ['受け入れ基準 2 のテストが無い'], evidence: [] }));
  put(work, 'verdicts/def/1.json', J({ task: '2026-11-03-demo', sha: 'def', result: 'pass', findings: [], evidence: ['通った'] }));
  const v = (path, quote, id = '2026-11-03-missing-test') => ['add', '--root', root, '--id', id, '--type', 'verdict-fail', '--pattern', 'missing-test', '--verdict', path, '--quote', quote, '--body', '受け入れ基準のテストを書かずにレビューを依頼した。'];
  const bad = run(v(join(work, 'verdicts/abc/1.json'), 'テストが通らない'));
  assert.equal(bad.status, 1, bad.out);
  assert.match(bad.out, /quote-unverified/);
  const pass = run(v(join(work, 'verdicts/def/1.json'), '通った'));
  assert.equal(pass.status, 1, pass.out);
  const ok = run(v(join(work, 'verdicts/abc/1.json'), 'テストが無い'));
  assert.equal(ok.status, 0, ok.out);
  // 作業リポジトリの .git/gori/verdicts/ の形（移す前の置き場所）は受け付けない。
  const oldPlace = mkdtempSync(join(tmpdir(), 'gori-case-work-'));
  put(oldPlace, '.git/gori/verdicts/abc/1.json', readFileSync(join(work, 'verdicts/abc/1.json'), 'utf8'));
  const old = run(v(join(oldPlace, '.git/gori/verdicts/abc/1.json'), 'テストが無い', '2026-11-03-old-place'));
  assert.equal(old.status, 2, old.out);
  assert.match(old.out, /gori\/repos\/<名前>\/verdicts/);
  const fm = readFrontmatter(readFileSync(L(root, 'cases', '2026-11-03-missing-test.md'), 'utf8'));
  assert.equal(fm.fields.verdict.value, 'abc/1.json');
});

test('確認できずのレビュー結果からは verdict-unverified の事例を書き、結果と種類の組が合わなければ拒む', () => {
  const root = goriTree();
  const work = join(root, '.git', 'gori', 'repos', 'demo');
  put(work, 'verdicts/abc/1.json', J({ task: '2026-11-03-demo', sha: 'abc', result: 'unverified', findings: ['E2E が --e2e で渡っていない'], evidence: ['bash tests/e2e/x.sh: operation not permitted'] }));
  put(work, 'verdicts/def/1.json', J({ task: '2026-11-03-demo', sha: 'def', result: 'fail', findings: ['E2E が --e2e で渡っていない'], evidence: [] }));
  const v = (path, type, id) => ['add', '--root', root, '--id', id, '--type', type, '--pattern', 'e2e-not-passed', '--verdict', path, '--quote', 'E2E が --e2e で渡っていない', '--body', 'E2E を渡さずにレビューを依頼し、レビュアーが確かめられなかった。'];
  const wrong = run(v(join(work, 'verdicts/abc/1.json'), 'verdict-fail', '2026-11-03-e2e-a'));
  assert.equal(wrong.status, 1, wrong.out);
  assert.match(wrong.out, /unverified で、--type verdict-fail の事例にできない/);
  const wrong2 = run(v(join(work, 'verdicts/def/1.json'), 'verdict-unverified', '2026-11-03-e2e-b'));
  assert.equal(wrong2.status, 1, wrong2.out);
  const other = run(v(join(work, 'verdicts/abc/1.json'), 'correction', '2026-11-03-e2e-c'));
  assert.equal(other.status, 2, other.out);
  const ok = run(v(join(work, 'verdicts/abc/1.json'), 'verdict-unverified', '2026-11-03-e2e-d'));
  assert.equal(ok.status, 0, ok.out);
  const fm = readFrontmatter(readFileSync(L(root, 'cases', '2026-11-03-e2e-d.md'), 'utf8'));
  assert.equal(fm.fields.type.value, 'verdict-unverified');
});

test('list と count は pattern ごとに事例を数える', () => {
  const root = goriTree();
  const empty = mkdtempSync(join(tmpdir(), 'gori-case-empty-'));
  assert.equal(run(['count', '--root', root, '--pattern', 'unverified-done']).out.trim(), '0');
  assert.equal(run(base(root, empty)).status, 0);
  assert.equal(run(base(root, empty, { id: '2026-11-04-unverified-done', message: 'u-2' })).status, 0);
  assert.equal(run(base(root, empty, { id: '2026-11-04-naming', pattern: 'naming', message: 'u-3' })).status, 0);
  assert.equal(run(['count', '--root', root, '--pattern', 'unverified-done']).out.trim(), '2');
  assert.equal(run(['count', '--root', root, '--pattern', 'naming']).out.trim(), '1');
  const list = run(['list', '--root', root, '--pattern', 'unverified-done']).out.trim().split('\n');
  assert.deepEqual(list.map((l) => l.split('\t')[0]), ['2026-11-03-unverified-done', '2026-11-04-unverified-done']);
  assert.equal(run(['list', '--root', root]).out.trim().split('\n').length, 3);
});

// 抽出は count の出力で起票を決める（skills/extract 手順 5）。本文の出来事の数を件数に数えない。
test('本文に複数の出来事が書かれた事例も、count は一件と数え、同じ発言の二件目は書けない', () => {
  const root = goriTree();
  const proj = projects();
  const body = '一つのセッションで、テストを走らせずに完了と報告することが三回あった。一回目は README、二回目は CHANGELOG、三回目は設定ファイルの変更である。テストの出力を確かめてから報告するのが正しい。';
  assert.equal(run(base(root, proj, { body })).status, 0);
  assert.equal(run(['count', '--root', root, '--pattern', 'unverified-done']).out.trim(), '1');
  const dup = run(base(root, proj, { id: '2026-11-03-unverified-done-2', body }));
  assert.equal(dup.status, 1, dup.out);
  assert.match(dup.out, /case-duplicate/);
  assert.equal(run(['count', '--root', root, '--pattern', 'unverified-done']).out.trim(), '1');
  assert.equal(run(['count', '--root', root, '--pattern', 'unverified-done', '--min', '2']).status, 1);
});

test('count --min は、件数が満たなければ終了コード 1、満たせば 0 で終わる', () => {
  const root = goriTree();
  const empty = mkdtempSync(join(tmpdir(), 'gori-case-empty-'));
  const min2 = () => run(['count', '--root', root, '--pattern', 'unverified-done', '--min', '2']);
  assert.deepEqual([min2().status, min2().out.trim()], [1, '0']);
  assert.equal(run(base(root, empty)).status, 0);
  assert.deepEqual([min2().status, min2().out.trim()], [1, '1']);
  assert.equal(run(base(root, empty, { id: '2026-11-04-unverified-done', message: 'u-2' })).status, 0);
  assert.deepEqual([min2().status, min2().out.trim()], [0, '2']);
  assert.equal(run(['retract', '--root', root, '--id', '2026-11-04-unverified-done', '--reason', '新しい依頼だった']).status, 0);
  assert.equal(min2().status, 1);
  assert.equal(run(['count', '--root', root, '--pattern', 'unverified-done', '--min']).status, 2);
  for (const bad of ['0', '-1', 'two', '1.5']) assert.equal(run(['count', '--root', root, '--pattern', 'unverified-done', '--min', bad]).status, 2, bad);
});

test('retract は事例を書き換えずに取り消しを書き、list と count から外す', () => {
  const root = goriTree();
  const empty = mkdtempSync(join(tmpdir(), 'gori-case-empty-'));
  assert.equal(run(base(root, empty)).status, 0);
  assert.equal(run(base(root, empty, { id: '2026-11-04-unverified-done', message: 'u-2' })).status, 0);
  const file = L(root, 'cases', '2026-11-04-unverified-done.md');
  const before = readFileSync(file, 'utf8');
  const r = run(['retract', '--root', root, '--id', '2026-11-04-unverified-done', '--reason', '人間が示された案から一つを選んだだけで、誤りを正した発言でない。']);
  assert.equal(r.status, 0, r.out);
  assert.equal(readFileSync(file, 'utf8'), before);
  const rfile = L(root, 'retractions', '2026-11-04-unverified-done.md');
  const fm = readFrontmatter(readFileSync(rfile, 'utf8'));
  assert.ok(!fm.error, fm.error?.message);
  assert.equal(fm.fields.id.value, '2026-11-04-unverified-done');
  assert.match(fm.fields.retracted.value, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(fm.bodyLines.join('\n'), /案から一つを選んだだけ/);
  assert.equal(run(['count', '--root', root, '--pattern', 'unverified-done']).out.trim(), '1');
  assert.deepEqual(run(['list', '--root', root]).out.trim().split('\n').map((l) => l.split('\t')[0]), ['2026-11-03-unverified-done']);
  const listed = run(['retracted', '--root', root]).out.trim().split('\n');
  assert.equal(listed.length, 1);
  assert.deepEqual(listed[0].split('\t').filter((_, i) => i !== 1), ['2026-11-04-unverified-done', '人間が示された案から一つを選んだだけで、誤りを正した発言でない。']);
});

test('retract は二度目、無い事例、理由の無い入力、秘密情報らしい理由を拒む', () => {
  const root = goriTree();
  const empty = mkdtempSync(join(tmpdir(), 'gori-case-empty-'));
  assert.equal(run(base(root, empty)).status, 0);
  const args = (extra = {}) => {
    const f = { id: '2026-11-03-unverified-done', reason: '誤りを正した発言でない。', ...extra };
    return ['retract', '--root', root, ...Object.entries(f).filter(([, v]) => v !== null).flatMap(([k, v]) => [`--${k}`, v])];
  };
  const missing = run(args({ id: '2026-11-05-nothing' }));
  assert.equal(missing.status, 1, missing.out);
  assert.match(missing.out, /case-missing/);
  for (const c of [{ reason: null }, { reason: '  ' }, { id: '../cases/x' }]) assert.equal(run(args(c)).status, 2, J(c));
  const secret = run(args({ reason: 'password=hunter22 と書いた' })); // check-public: allow-secret（検査のための偽の値）
  assert.equal(secret.status, 1, secret.out);
  assert.match(secret.out, /secret-like/);
  assert.equal(existsSync(L(root, 'retractions')), false);
  assert.equal(run(args()).status, 0);
  const rfile = L(root, 'retractions', '2026-11-03-unverified-done.md');
  const before = readFileSync(rfile, 'utf8');
  const again = run(args({ reason: '別の理由' }));
  assert.equal(again.status, 1, again.out);
  assert.match(again.out, /retraction-exists/);
  assert.equal(readFileSync(rfile, 'utf8'), before);
});

test('取り消した事例と同じ発言、同じ pattern の事例は書き直せない', () => {
  const root = goriTree();
  const proj = projects();
  assert.equal(run(base(root, proj)).status, 0);
  assert.equal(run(['retract', '--root', root, '--id', '2026-11-03-unverified-done', '--reason', '誤りを正した発言でない。']).status, 0);
  const r = run(base(root, proj, { id: '2026-11-04-unverified-done' }));
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /case-duplicate.*取り消し済み/);
  assert.equal(run(['count', '--root', root, '--pattern', 'unverified-done']).out.trim(), '0');
});

test('形の崩れた取り消しは、取り消しとして扱いつつ標準エラーと retracted に出す', () => {
  const root = goriTree();
  const empty = mkdtempSync(join(tmpdir(), 'gori-case-empty-'));
  assert.equal(run(base(root, empty)).status, 0);
  put(root, '.git/gori/learning/retractions/2026-11-03-unverified-done.md', '---\nid: 2026-11-09-other\nretracted: 2026-11-04\n---\n\n手で置いた\n');
  put(root, '.git/gori/learning/retractions/2026-11-05-nothing.md', '---\nid: 2026-11-05-nothing\nretracted: 2026-11-04\n---\n\n事例が無い\n');
  const c = run(['count', '--root', root, '--pattern', 'unverified-done']);
  assert.equal(c.out.split('\n').filter((l) => /^\d+$/.test(l)).join(), '0');
  assert.match(c.out, /id がファイル名 2026-11-03-unverified-done と違う/);
  assert.match(c.out, /取り消す事例 2026-11-05-nothing が無い/);
  const listed = run(['retracted', '--root', root]).out.trim().split('\n').map((l) => l.split('\t').slice(0, 2));
  assert.deepEqual(listed, [['2026-11-03-unverified-done', 'unreadable'], ['2026-11-05-nothing', 'unreadable']]);
});

// 学びは git の共通ディレクトリの下にあるので、本体のチェックアウトから呼んでも課題の worktree から呼んでも同じ学びを読み書きする。
const goriRepoWithWorktree = () => {
  const main = goriTree();
  const g = (args) => spawnSync('git', ['-C', main, ...args], { env: cleanEnv(), encoding: 'utf8' });
  assert.equal(g(['add', '.claude-plugin']).status, 0);
  assert.equal(g(['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'init']).status, 0);
  const wt = join(main, '.worktree', 'task-1');
  assert.equal(g(['worktree', 'add', '-q', '-b', 'task-1', wt]).status, 0);
  const proj = mkdtempSync(join(tmpdir(), 'gori-case-empty-'));
  assert.equal(run(base(main, proj)).status, 0);
  assert.equal(run(base(main, proj, { id: '2026-11-04-unverified-done', message: 'u-2', quote: '別の誤り' })).status, 0);
  return { main, wt };
};

test('worktree から実行した retract、add、list、count は、本体のチェックアウトと同じ学びを使い、作業ツリーに learning/ を作らない', () => {
  const { main, wt } = goriRepoWithWorktree();
  const r = run(['retract', '--id', '2026-11-04-unverified-done', '--reason', '同じ出来事を二件に書いた。'], { cwd: wt });
  assert.equal(r.status, 0, r.out);
  assert.ok(existsSync(L(main, 'retractions', '2026-11-04-unverified-done.md')));
  assert.equal(existsSync(join(wt, 'learning')), false);
  for (const cwd of [wt, main]) {
    assert.deepEqual(run(['list'], { cwd }).out.trim().split('\n').map((l) => l.split('\t')[0]), ['2026-11-03-unverified-done']);
    assert.equal(run(['count', '--pattern', 'unverified-done'], { cwd }).out.trim(), '1');
  }
  const addArgs = base(main, mkdtempSync(join(tmpdir(), 'gori-case-empty-')), { id: '2026-11-05-unverified-done', message: 'u-3', quote: '三つ目' });
  addArgs.splice(addArgs.indexOf('--root'), 2);
  const added = run(addArgs, { cwd: wt });
  assert.equal(added.status, 0, added.out);
  assert.ok(existsSync(L(main, 'cases', '2026-11-05-unverified-done.md')));
  for (const tree of [wt, main]) assert.equal(existsSync(join(tree, 'learning')), false);
  // --root に worktree を渡しても、本体を渡しても、同じ事例を見る。
  for (const root of [wt, main]) {
    assert.deepEqual(run(['list', '--root', root]).out.trim().split('\n').map((l) => l.split('\t')[0]), ['2026-11-03-unverified-done', '2026-11-05-unverified-done']);
  }
});
