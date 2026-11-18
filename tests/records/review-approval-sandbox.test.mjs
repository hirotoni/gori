import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { recordsDir, testGori } from '../helpers.mjs';
import { cleanEnv, LOG, ID, approve, textApproval, workRepo, review, fakeClaude } from './review-helpers.mjs';

// レビュアーが承認の中身を確かめられるよう、承認の引用に、その発言の直前に作業者が示したメッセージを添えて渡す。
test('依頼文の人間の承認の節は、承認の引用と、その発言の直前のメッセージ（作業の通知をまたいでつなぐ）を持ち、引けなければそう書く', () => {
  const r = workRepo({ accept: false });
  const add = (args, env = {}) => spawnSync(process.execPath, [LOG, 'add', '--task', ID, ...args], { cwd: r.dir, encoding: 'utf8', env: cleanEnv(env) });
  assert.equal(add(['--type', 'accept', '--what', '引数があれば Hello, <引数> を出す']).status, 0);
  const projects = mkdtempSync(join(tmpdir(), 'gori-review-projects-'));
  mkdirSync(join(projects, '-demo'));
  const rows = [
    { type: 'user', uuid: 'u-1', message: { role: 'user', content: '挨拶を足して' } },
    { type: 'assistant', uuid: 'a-1', message: { role: 'assistant', content: [{ type: 'text', text: '案を示します。名前は greet でよいですか。' }] } },
    { type: 'user', uuid: 'n-1', message: { role: 'user', content: '<task-notification>\n<task-id>x</task-id>\n</task-notification>' } },
    { type: 'assistant', uuid: 'a-2', message: { role: 'assistant', content: [{ type: 'text', text: 'この案で進めてよいですか。' }] } },
    { type: 'user', uuid: 'u-2', message: { role: 'user', content: 'よい' } },
  ];
  writeFileSync(join(projects, '-demo', 's-9.jsonl'), rows.map((o) => JSON.stringify(o)).join('\n') + '\n');
  textApproval(r.dir, '挨拶の案の承認', 's-9', 'u-2', 'よい');
  const section = (env) => /## 人間の承認\n([\s\S]*?)\n## /.exec(review(r.dir, ['--dry-run'], env).out)[1];
  const seen = section({ GORI_PROJECTS_DIR: projects });
  assert.match(seen, /挨拶の案の承認（発言 u-2 「よい」）/);
  assert.match(seen, /直前に作業者が示したメッセージ:\n  > 案を示します。名前は greet でよいですか。 この案で進めてよいですか。/);
  assert.match(section({ GORI_PROJECTS_DIR: mkdtempSync(join(tmpdir(), 'gori-review-noprojects-')) }), /会話の記録を引けないので、直前のメッセージは確かめられない/);
  approve(r.dir);
  assert.match(section({ GORI_PROJECTS_DIR: projects }), /端末の人間が書いた承認で、直前のメッセージは無い/);
});

// 選択式の回答で書いた承認は、問いの文と選択肢と選んだ答えを添え、端末の承認と取り違えない。
test('依頼文の人間の承認の節は、選択式の回答の承認なら、直前のメッセージと問いと選択肢と選んだ答えを持つ', () => {
  const r = workRepo({ accept: false });
  const add = (args, env = {}) => spawnSync(process.execPath, [LOG, 'add', '--task', ID, ...args], { cwd: r.dir, encoding: 'utf8', env: cleanEnv(env) });
  assert.equal(add(['--type', 'accept', '--what', '引数があれば Hello, <引数> を出す']).status, 0);
  const projects = mkdtempSync(join(tmpdir(), 'gori-review-projects-'));
  mkdirSync(join(projects, '-demo'));
  const question = '受け入れ条件を一つにします。これで進めてよいですか？';
  const rows = [
    { type: 'user', uuid: 'u-1', message: { role: 'user', content: '挨拶を足して' } },
    { type: 'assistant', uuid: 'a-1', message: { role: 'assistant', content: [{ type: 'text', text: '受け入れ条件を書きました。' }] } },
    {
      type: 'user',
      uuid: 'c-1',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't-1', content: `Your questions have been answered: "${question}"="この条件で進めてよい".` }] },
      toolUseResult: { questions: [{ question, options: [{ label: 'この条件で進めてよい' }, { label: '条件を直す' }] }], answers: { [question]: 'この条件で進めてよい' } },
    },
  ];
  writeFileSync(join(projects, '-demo', 's-c.jsonl'), rows.map((o) => JSON.stringify(o)).join('\n') + '\n');
  // 選択式の回答で書く承認は、今の log は書かない。古い記録に残るこの形を review が読めることを、端末から書いた行の evidence を書き換えて確かめる。
  const ap = add(['--type', 'approval', '--what', '条件の承認', '--quote', 'この条件で進めてよい']);
  assert.equal(ap.status, 0, ap.stderr);
  const af = join(recordsDir(r.dir), 'audit', `${ID}.tsv`);
  writeFileSync(af, readFileSync(af, 'utf8').split('\n').map((l) => {
    if (!l.includes('端末の人間 「この条件で進めてよい」')) return l;
    const cols = l.split('\t');
    cols[1] = 's-c';
    return cols.join('\t').replace('端末の人間 「この条件で進めてよい」', `回答 c-1 問い「${question}」 答え「この条件で進めてよい」 引用「この条件で進めてよい」`);
  }).join('\n'));
  const seen = /## 人間の承認\n([\s\S]*?)\n## /.exec(review(r.dir, ['--dry-run'], { GORI_PROJECTS_DIR: projects }).out)[1];
  assert.match(seen, /条件の承認（回答 c-1 問い「/);
  assert.match(seen, /選択式の質問への回答で書いた承認である/);
  assert.match(seen, /- 問い「受け入れ条件を一つにします。これで進めてよいですか？」 選択肢: 「この条件で進めてよい」、「条件を直す」 選んだ答え「この条件で進めてよい」/);
  assert.match(seen, /この回答の直前に作業者が示したメッセージ:\n  > 受け入れ条件を書きました。/);
  assert.doesNotMatch(seen, /端末の人間が書いた承認/);

  // 文章の発言の承認は、間に選択式の回答があっても、一つ前の文章の発言から後のメッセージをすべて示す。
  const r2 = workRepo({ accept: false });
  const add2 = (args, env = {}) => spawnSync(process.execPath, [LOG, 'add', '--task', ID, ...args], { cwd: r2.dir, encoding: 'utf8', env: cleanEnv(env) });
  assert.equal(add2(['--type', 'accept', '--what', '引数があれば Hello, <引数> を出す']).status, 0);
  const more = [
    ...rows,
    { type: 'assistant', uuid: 'a-2', message: { role: 'assistant', content: [{ type: 'text', text: 'この案で進めてよいですか。' }] } },
    { type: 'user', uuid: 'u-2', message: { role: 'user', content: 'よい' } },
  ];
  writeFileSync(join(projects, '-demo', 's-t.jsonl'), more.map((o) => JSON.stringify(o)).join('\n') + '\n');
  textApproval(r2.dir, '案の承認', 's-t', 'u-2', 'よい');
  const text = /## 人間の承認\n([\s\S]*?)\n## /.exec(review(r2.dir, ['--dry-run'], { GORI_PROJECTS_DIR: projects }).out)[1];
  assert.match(text, /直前に作業者が示したメッセージ:\n  > 受け入れ条件を書きました。 この案で進めてよいですか。/);
  assert.doesNotMatch(text, /選択式の質問への回答で書いた承認/);
});

for (const dry of [true, false]) {
  test(`accept 行が無ければ、レビュアーを起動せず worktree も作らず終了コード 2 で止まる（dry-run ${dry}）`, () => {
    const r = workRepo({ accept: false });
    const f = fakeClaude('pass');
    const res = review(r.dir, dry ? ['--dry-run'] : [], { GORI_CLAUDE_BIN: f.bin });
    assert.equal(res.status, 2, res.out);
    assert.match(res.out, /accept 行が無い/);
    assert.equal(res.out.trim().split('\n').length, 1, res.out);
    assert.ok(!existsSync(join(dirname(f.bin), 'note.json')), 'レビュアーが起動された');
    assert.equal(r.g('worktree', 'list').stdout.trim().split('\n').length, 1);
  });
}

// レビュアーの会話は GORI_REVIEWING で SessionEnd フックが抽出待ちに積まないので、review は学びに何も書かない。
test('D3: レビュアーに GORI_REVIEWING=1 を渡す', () => {
  const r = workRepo();
  const f = fakeClaude('pass');
  const res = review(r.dir, [], { GORI_CLAUDE_BIN: f.bin });
  assert.equal(res.status, 0, res.out);
  assert.equal(f.note().reviewing, '1');
});

test('レビュアーの --settings で Bash のサンドボックスが有効になり、書き込みは worktree と受け取り口に限られ、作業リポジトリとその git の共通ディレクトリ、gori のチェックアウトの作業ツリーと .git は denyWrite になる', () => {
  const r = workRepo();
  const f = fakeClaude('pass');
  const res = review(r.dir, [], { GORI_CLAUDE_BIN: f.bin });
  assert.equal(res.status, 0, res.out);
  const n = f.note();
  assert.equal(n.args.filter((a) => a === '--settings').length, 1);
  const s = JSON.parse(n.args[n.args.indexOf('--settings') + 1]).sandbox;
  assert.equal(s.enabled, true);
  assert.equal(s.failIfUnavailable, true);
  assert.equal(s.allowUnsandboxedCommands, false);
  const real = (p) => join(realpathSync(dirname(p)), p.split('/').at(-1));
  assert.deepEqual(s.filesystem.allowWrite, [real(n.cwd), real(n.outbox)]);
  // 本体の作業ツリー（共通ディレクトリの親）は作業リポジトリと同じなので、一つにまとまる。gori も同じである。
  const gori = realpathSync(testGori());
  assert.deepEqual(s.filesystem.denyWrite, [realpathSync(r.dir), join(realpathSync(r.dir), '.git'), gori, join(gori, '.git')]);
});

// --dry-run のコマンドの --settings の JSON を取り出す。
const drySandbox = (out) => {
  const line = out.split('\n').find((l) => l.includes('"--settings"'));
  const m = /"--settings" ("(?:[^"\\]|\\.)*")/.exec(line);
  return JSON.parse(JSON.parse(m[1])).sandbox;
};

test('課題の worktree から依頼しても、denyWrite に作業ツリー、本体の作業ツリーと .git、gori のチェックアウトの作業ツリーと .git が入る（--dry-run でも同じ）', () => {
  const r = workRepo();
  const wt = join(mkdtempSync(join(tmpdir(), 'gori-review-wt-')), 'wt');
  assert.equal(r.g('worktree', 'add', '-q', '-b', ID, wt).status, 0);
  const res = review(wt, ['--dry-run']);
  assert.equal(res.status, 0, res.out);
  const gori = realpathSync(testGori());
  const main = realpathSync(r.dir);
  assert.deepEqual(drySandbox(res.out).filesystem.denyWrite, [realpathSync(wt), join(main, '.git'), main, gori, join(gori, '.git')]);
});

test('gori のチェックアウトの worktree から道具を呼んでも、記録は同じ場所から読み、gori の本体の作業ツリーと .git まで denyWrite に入る', () => {
  const r = workRepo();
  const gori = testGori();
  const gwt = join(mkdtempSync(join(tmpdir(), 'gori-review-goriwt-')), 'gori-wt');
  if (spawnSync('git', ['-C', gori, 'rev-parse', '-q', '--verify', 'HEAD'], { env: cleanEnv() }).status !== 0) {
    assert.equal(spawnSync('git', ['-C', gori, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init'], { env: cleanEnv() }).status, 0);
  }
  assert.equal(spawnSync('git', ['-C', gori, 'worktree', 'add', '-q', '--detach', gwt], { env: cleanEnv() }).status, 0);
  mkdirSync(join(gwt, '.claude-plugin'), { recursive: true });
  writeFileSync(join(gwt, '.claude-plugin', 'plugin.json'), '{"name":"gori"}\n');
  const res = review(r.dir, ['--dry-run'], { GORI_ROOT: gwt });
  assert.equal(res.status, 0, res.out);
  const g = realpathSync(gori);
  const main = realpathSync(r.dir);
  assert.deepEqual(drySandbox(res.out).filesystem.denyWrite, [main, join(main, '.git'), realpathSync(gwt), join(g, '.git'), g]);
});

test('gori のチェックアウトが見つからなければ、レビュアーを起動せず worktree も作らず 2 で止まる', () => {
  const r = workRepo();
  const f = fakeClaude('pass');
  const res = review(r.dir, [], { GORI_CLAUDE_BIN: f.bin, GORI_ROOT: mkdtempSync(join(tmpdir(), 'gori-review-notgori-')) });
  assert.equal(res.status, 2, res.out);
  assert.match(res.out, /gori の git のチェックアウトでない/);
  assert.ok(!existsSync(join(dirname(f.bin), 'note.json')), 'レビュアーが起動された');
  assert.equal(r.g('worktree', 'list').stdout.trim().split('\n').length, 1);
});

test('--dry-run のコマンドにも sandbox の --settings が入る', () => {
  const r = workRepo();
  const res = review(r.dir, ['--dry-run']);
  assert.match(res.out, /failIfUnavailable/);
  assert.match(res.out, /allowUnsandboxedCommands/);
});

test('サンドボックスを起動できずレビュアーがレビュー結果なしで異常終了したら、未レビューで 3', () => {
  const r = workRepo();
  const dir = mkdtempSync(join(tmpdir(), 'gori-fake-'));
  const bin = join(dir, 'claude');
  writeFileSync(bin, `#!${process.execPath}\nconsole.error('sandbox unavailable');process.exit(1);\n`);
  chmodSync(bin, 0o755);
  const res = review(r.dir, [], { GORI_CLAUDE_BIN: bin });
  assert.equal(res.status, 3, res.out);
  assert.match(res.out, /終了コード 1/);
  assert.match(res.out, /未レビュー/);
});
