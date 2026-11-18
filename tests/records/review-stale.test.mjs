import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { recordsDir, repoRoot } from '../helpers.mjs';
import { modelFor } from '../../tools/lib/models.mjs';
import { attest, workRepo, review, reviewRaw, fakeClaude, verdictsIn, auditRows } from './review-helpers.mjs';

// main が進んだ後の古い位置から分かれた commit。topic は greet の上に一つ積み、main は greet の上に別の一つを積む。
function staleRepo(branch = 'main') {
  const r = workRepo();
  r.g('branch', '-M', branch);
  r.g('checkout', '-q', '-b', 'topic');
  writeFileSync(join(r.dir, 'greet.sh'), 'echo "Hello, $1"\n');
  r.g('commit', '-q', '-am', 'topic');
  r.g('checkout', '-q', branch);
  writeFileSync(join(r.dir, 'other.txt'), 'other\n');
  r.g('add', 'other.txt');
  r.g('commit', '-q', '-m', 'other');
  r.g('checkout', '-q', 'topic');
  return r;
}
const launched = (f) => existsSync(join(dirname(f.bin), 'note.json'));

test('main の先端を含まない commit は、レビュアーを起動せず 2 で止まり、載せ直すよう示す', () => {
  const r = staleRepo();
  const tip = r.g('rev-parse', 'main').stdout.trim();
  const f = fakeClaude('pass');
  const res = review(r.dir, [], { GORI_CLAUDE_BIN: f.bin });
  assert.equal(res.status, 2, res.out);
  assert.ok(res.out.includes(`main の先端 ${tip} を含まない`), res.out);
  assert.match(res.out, /tools\/repo\/sync-main --task \S+ で main の最新を取り込み/);
  assert.match(res.out, /--base main で依頼し直す/);
  assert.match(res.out, /レビューを受けた commit を手で書き換えない/);
  assert.doesNotMatch(res.out, /git rebase/);
  assert.ok(!launched(f), 'レビュアーが起動された');
  assert.deepEqual(verdictsIn(r.dir, r.head()), []);
  assert.equal(r.g('worktree', 'list').stdout.trim().split('\n').length, 1);
  const dry = review(r.dir, ['--dry-run']);
  assert.equal(dry.status, 2, dry.out);
  assert.ok(!dry.out.includes('# 依頼文'), dry.out);
});

test('HEAD をレビューするとき、未追跡のファイルがあればレビュアーを起動せず 2 で止まり、そのファイルを示す', () => {
  const r = workRepo();
  writeFileSync(join(r.dir, 'scratch.txt'), 'x\n');
  const f = fakeClaude('pass');
  const res = review(r.dir, [], { GORI_CLAUDE_BIN: f.bin });
  assert.equal(res.status, 2, res.out);
  assert.match(res.out, /未コミットの変更か未追跡のファイルがある（1 件）/);
  assert.ok(res.out.includes('?? scratch.txt'), res.out);
  assert.match(res.out, /review --task \S+ で依頼し直す/);
  assert.ok(!launched(f), 'レビュアーが起動された');
  assert.deepEqual(verdictsIn(r.dir, r.head()), []);
  assert.equal(r.g('worktree', 'list').stdout.trim().split('\n').length, 1);
  const dry = review(r.dir, ['--dry-run']);
  assert.equal(dry.status, 2, dry.out);
  assert.ok(!dry.out.includes('# 依頼文'), dry.out);
});

test('未コミットの変更でも止まり、示すのは 10 件までで残りは件数を出す', () => {
  const r = workRepo();
  writeFileSync(join(r.dir, 'greet.sh'), 'echo changed\n');
  for (let i = 0; i < 11; i++) writeFileSync(join(r.dir, `u${String(i).padStart(2, '0')}.txt`), 'x\n');
  const f = fakeClaude('pass');
  const res = review(r.dir, [], { GORI_CLAUDE_BIN: f.bin });
  assert.equal(res.status, 2, res.out);
  assert.match(res.out, /（12 件）/);
  assert.ok(res.out.includes(' M greet.sh'), res.out);
  assert.match(res.out, /ほか 2 件/);
  assert.ok(!launched(f), 'レビュアーが起動された');
});

test('--sha で HEAD 以外の commit を渡したときは、作業ツリーが汚れていても止まらない', () => {
  const r = workRepo();
  const back = r.g('rev-parse', '--abbrev-ref', 'HEAD').stdout.trim();
  r.g('checkout', '-q', '-b', 'topic');
  writeFileSync(join(r.dir, 'more.txt'), 'more\n');
  r.g('add', 'more.txt');
  r.g('commit', '-q', '-m', 'more');
  // 点検の行は作業ツリーの HEAD の SHA で書かれるので、レビューする commit を checkout して点検してから戻る。
  attest(r.dir);
  r.g('checkout', '-q', back);
  writeFileSync(join(r.dir, 'scratch.txt'), 'x\n');
  const res = reviewRaw(r.dir, ['--sha', 'topic', '--dry-run']);
  assert.equal(res.status, 0, res.out);
  assert.ok(!res.out.includes('未追跡のファイルがある'), res.out);
});

test('--sha で main より古い commit を指定しても断る。master しか無ければ master と比べる', () => {
  const r = staleRepo('master');
  const f = fakeClaude('pass');
  const res = review(r.dir, [], { GORI_CLAUDE_BIN: f.bin });
  assert.equal(res.status, 2, res.out);
  assert.match(res.out, /master の先端 [0-9a-f]{40} を含まない/);
  const old = review(r.dir, ['--sha', 'master~1'], { GORI_CLAUDE_BIN: f.bin });
  assert.equal(old.status, 2, old.out);
  assert.match(old.out, /master の先端 [0-9a-f]{40} を含まない/);
  assert.ok(!launched(f), 'レビュアーが起動された');
});

test('main の上に載せ直した commit と main の先端そのものは、これまでどおりレビュアーを起動する', () => {
  const r = staleRepo();
  assert.equal(r.g('rebase', '-q', 'main').status, 0);
  const f = fakeClaude('pass');
  const res = review(r.dir, [], { GORI_CLAUDE_BIN: f.bin });
  assert.equal(res.status, 0, res.out);
  assert.ok(launched(f), 'レビュアーが起動されていない');
  assert.equal(verdictsIn(r.dir, r.head()).length, 1);
  const g = fakeClaude('pass');
  r.g('checkout', '-q', 'main');
  attest(r.dir);
  r.g('checkout', '-q', '-');
  const tip = reviewRaw(r.dir, ['--sha', 'main'], { GORI_CLAUDE_BIN: g.bin });
  assert.equal(tip.status, 0, tip.out);
  assert.ok(launched(g), 'main の先端でレビュアーが起動されていない');
});

test('main も master も無いリポジトリでは、位置を確かめずにこれまでどおりレビュアーを起動する', () => {
  const r = workRepo();
  r.g('branch', '-M', 'trunk');
  const f = fakeClaude('pass');
  const res = review(r.dir, [], { GORI_CLAUDE_BIN: f.bin });
  assert.equal(res.status, 0, res.out);
  assert.ok(launched(f), 'レビュアーが起動されていない');
});

test('合格に添えた勧める指摘は、取り込んだレビュー結果に残り、review の出力に出る', () => {
  const r = workRepo();
  const res = review(r.dir, [], { GORI_CLAUDE_BIN: fakeClaude('pass', { raw: { suggestions: ['注釈を短くする'] } }).bin });
  assert.equal(res.status, 0, res.out);
  assert.match(res.out, /直すことを勧める指摘: 注釈を短くする/);
  const [f] = verdictsIn(r.dir, r.head());
  assert.deepEqual(JSON.parse(readFileSync(join(recordsDir(r.dir), 'verdicts', r.head(), f), 'utf8')).suggestions, ['注釈を短くする']);
});

test('レビューの重さ: 振る舞いに効かない文書だけなら light で reviewer-light のモデルと絞った検証方法、それ以外は normal', () => {
  const light = workRepo({ files: { 'docs/guide.md': '# 手引き\n', 'README.md': '# x\n' } });
  const l = review(light.dir, ['--dry-run']);
  assert.equal(l.status, 0, l.out);
  assert.match(l.out, /レビューの重さ: light（振る舞いに効かない文書だけを変えた: /);
  assert.match(l.out, new RegExp(`モデル: ${modelFor(repoRoot, 'reviewer-light')}`));
  assert.match(l.out, /テストを全部は走らせない/);
  for (const files of [{ 'greet.sh': 'echo hi\n' }, { 'knowledge/x.md': 'x\n' }, { 'CLAUDE.md': 'x\n' }, { 'docs/a.md': 'a\n', 'tests/a.test.mjs': '' }]) {
    const n = review(workRepo({ files }).dir, ['--dry-run']);
    assert.equal(n.status, 0, n.out);
    assert.match(n.out, /レビューの重さ: normal/, Object.keys(files).join());
    assert.match(n.out, new RegExp(`モデル: ${modelFor(repoRoot, 'reviewer')}`));
    assert.doesNotMatch(n.out, /テストを全部は走らせない/);
  }
  // --model は重さに依らず優先する。
  assert.match(review(light.dir, ['--dry-run', '--model', 'haiku']).out, /モデル: haiku/);
});

test('軽いレビューの重さは、取り込んだレビュー結果と判断の記録の行に残る', () => {
  const r = workRepo({ files: { 'docs/guide.md': '# 手引き\n' } });
  const res = review(r.dir, [], { GORI_CLAUDE_BIN: fakeClaude('pass').bin });
  assert.equal(res.status, 0, res.out);
  const [f] = verdictsIn(r.dir, r.head());
  assert.equal(JSON.parse(readFileSync(join(recordsDir(r.dir), 'verdicts', r.head(), f), 'utf8')).weight, 'light');
  assert.equal(auditRows(r.dir).at(-1)[5], 'レビュアー session:judge-fake 重さ light');
});

test('範囲で消したファイルの名前が残っていれば、レビュアーを起動せず 2 で場所を示す。印 keep-name の行は数えない', () => {
  const r = workRepo({ files: {
    'knowledge/skills/improvement-dispatch/SKILL.md': '# dispatch\n',
    'tools/setup-improvement-loop': '#!/bin/sh\n',
    'tools/stale_threshold.sh': '# 根拠の説明の正本は knowledge/skills/improvement-dispatch/SKILL.md 手順 2。setup-improvement-loop も使う\n',
  } });
  const base = r.head();
  r.g('rm', '-q', 'knowledge/skills/improvement-dispatch/SKILL.md', 'tools/setup-improvement-loop');
  r.g('commit', '-q', '-m', 'rm');
  const res = review(r.dir, ['--dry-run', '--base', base]);
  assert.equal(res.status, 2, res.out);
  assert.match(res.out, /tools\/stale_threshold\.sh:1: knowledge\/skills\/improvement-dispatch\/SKILL\.md（knowledge\/skills\/improvement-dispatch\/SKILL\.md）、setup-improvement-loop（tools\/setup-improvement-loop）: /);
  assert.ok(!res.out.includes('"--model"'), res.out);
  writeFileSync(join(r.dir, 'tools/stale_threshold.sh'), '# 11-05 に improvement-dispatch と setup-improvement-loop を消した（keep-name）\n');
  r.g('commit', '-q', '-am', 'keep');
  const ok = review(r.dir, ['--dry-run', '--base', base]);
  assert.equal(ok.status, 0, ok.out);
});
