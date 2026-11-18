import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { copyFixture, repoRoot, run } from '../helpers.mjs';

test('procedure と criterion だけが並び、手順書の行は参照キー、適用場面、パスの三列、判断基準の行は規則を加えた四列になる', () => {
  const dir = copyFixture('ok');
  assert.equal(run('knowledge/build-index', ['--root', dir]).status, 0);
  assert.equal(
    readFileSync(join(dir, 'knowledge', 'index.md'), 'utf8'),
    '# 索引\n\ncriteria/verification\t完了を宣言する前\t実物を動かして確かめるまでは、完了と言わない。\t${CLAUDE_PLUGIN_ROOT}/knowledge/criteria/verification.md\nprocedures/bug-fix\tbug-fix の依頼を受けたとき\t${CLAUDE_PLUGIN_ROOT}/knowledge/procedures/bug-fix.md\n',
  );
});

test('何度実行しても同じ出力', () => {
  const dir = copyFixture('ok');
  run('knowledge/build-index', ['--root', dir]);
  const first = readFileSync(join(dir, 'knowledge', 'index.md'), 'utf8');
  run('knowledge/build-index', ['--root', dir]);
  assert.equal(readFileSync(join(dir, 'knowledge', 'index.md'), 'utf8'), first);
});

test('--check は生成直後に通り、手で変えると失敗する', () => {
  const dir = copyFixture('ok');
  run('knowledge/build-index', ['--root', dir]);
  assert.equal(run('knowledge/build-index', ['--root', dir, '--check']).status, 0);
  writeFileSync(join(dir, 'knowledge', 'index.md'), '手で書いた\n');
  const r = run('knowledge/build-index', ['--root', dir, '--check']);
  assert.equal(r.status, 1);
  assert.match(r.out, /index\.md/);
});

test('--check は index.md が無ければ失敗する', () => {
  assert.equal(run('knowledge/build-index', ['--root', copyFixture('ok'), '--check']).status, 1);
});

test('frontmatter が壊れた知識ファイルがあれば索引を作らず失敗する', () => {
  const dir = copyFixture('bad-frontmatter');
  const r = run('knowledge/build-index', ['--root', dir]);
  assert.equal(r.status, 1);
  assert.match(r.out, /knowledge\/procedures\/research\.md/);
});

test('リポジトリの index.md が最新', () => {
  const r = run('knowledge/build-index', ['--root', repoRoot, '--check']);
  assert.equal(r.status, 0, r.out);
});

test('rule の無い判断基準があると、索引を作らずに失敗する', () => {
  const dir = copyFixture('ok');
  const f = join(dir, 'knowledge', 'criteria', 'verification.md');
  writeFileSync(f, readFileSync(f, 'utf8').replace(/^rule: .*\n/m, ''));
  const r = run('knowledge/build-index', ['--root', dir]);
  assert.equal(r.status, 1);
  assert.match(r.out, /verification\.md: 索引を作れない（rule が不正/);
});
