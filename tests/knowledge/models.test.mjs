import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { modelFor, parseModels } from '../../tools/lib/models.mjs';
import { readFrontmatter } from '../../tools/lib/frontmatter.mjs';
import { repoRoot, tempTree } from '../helpers.mjs';

test('models.md は implementer と reviewer の行を持ち、二つは別のモデルである', () => {
  const impl = modelFor(repoRoot, 'implementer');
  const rev = modelFor(repoRoot, 'reviewer');
  assert.ok(impl && rev);
  assert.notEqual(impl, rev);
});

test('models.md の表の行は | <役割> | <モデル名> | の形で読める', () => {
  const t = parseModels('| 役割 | モデル |\n| --- | --- |\n| reviewer | opus |\n| implementer | sonnet |\n');
  assert.equal(t.get('reviewer'), 'opus');
  assert.equal(t.get('implementer'), 'sonnet');
  assert.equal(t.size, 2);
});

test('reviewer の行が無い、またはファイルが無ければ推測せず失敗する', () => {
  const noRow = tempTree({ 'knowledge/config/models.md': '| implementer | sonnet |\n' });
  assert.throws(() => modelFor(noRow, 'reviewer'), /reviewer/);
  const noFile = tempTree({ 'x': '' });
  assert.throws(() => modelFor(noFile, 'reviewer'), /読めない/);
  const loose = tempTree({ 'knowledge/config/models.md': 'reviewer は opus である\n' });
  assert.throws(() => modelFor(loose, 'reviewer'));
});

const toolsOf = (name) => {
  const fm = readFrontmatter(readFileSync(join(repoRoot, 'knowledge', 'agents', `${name}.md`), 'utf8'));
  assert.ok(!fm.error, fm.error?.message);
  return fm.fields.tools.value.split(',').map((s) => s.trim());
};

test('reviewer は読むことと Bash だけを持ち、編集の道具を持たない', () => {
  assert.deepEqual(toolsOf('reviewer').sort(), ['Bash', 'Glob', 'Grep', 'Read']);
});

test('implementer は編集の道具を持つ', () => {
  const t = toolsOf('implementer');
  assert.ok(t.includes('Edit') && t.includes('Write'));
});

test('extract-reader は読むことと Bash だけを持ち、編集の道具を持たない', () => {
  assert.deepEqual(toolsOf('extract-reader').sort(), ['Bash', 'Glob', 'Grep', 'Read']);
});
