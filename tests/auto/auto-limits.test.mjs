import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { repoRoot } from '../helpers.mjs';
import { autoLimits, parseLimits } from '../../tools/lib/auto.mjs';

const root = (text) => {
  const dir = mkdtempSync(join(tmpdir(), 'gori-limits-'));
  mkdirSync(join(dir, 'knowledge', 'config'), { recursive: true });
  if (text !== null) writeFileSync(join(dir, 'knowledge', 'config', 'auto.md'), text);
  return dir;
};
const TABLE = '| 上限 | 値 |\n| --- | --- |\n| run-minutes | 60 |\n| worker-budget-usd | 10 |\n| reviewer-budget-usd | 5 |\n| runs-per-day | 3 |\n| watch-minutes | 30 |\n';

test('knowledge/config/auto.md の表は、決めた四つの上限と見回りの間隔を持つ', () => {
  assert.deepEqual(autoLimits(repoRoot), { 'run-minutes': 60, 'worker-budget-usd': 10, 'reviewer-budget-usd': 5, 'runs-per-day': 10, 'watch-minutes': 30 });
});

test('parseLimits は | 名前 | 数 | の行だけを読み、小数も読む', () => {
  const t = parseLimits('| 上限 | 値 |\n| --- | --- |\n| a-b | 1.5 |\n| c | x |\n| d | -1 |\n本文 | e | 2 |\n');
  assert.deepEqual([...t], [['a-b', 1.5]]);
});

test('autoLimits は、ファイルが無いか、行が欠けるか、0 か、runs-per-day が整数でなければ失敗する', () => {
  assert.throws(() => autoLimits(root(null)), /auto\.md を読めない/);
  assert.throws(() => autoLimits(root(TABLE.replace('| reviewer-budget-usd | 5 |\n', ''))), /reviewer-budget-usd \| <正の数> \|」の行がない/);
  assert.throws(() => autoLimits(root(TABLE.replace('| run-minutes | 60 |', '| run-minutes | 0 |'))), /run-minutes/);
  assert.throws(() => autoLimits(root(TABLE.replace('| watch-minutes | 30 |\n', ''))), /watch-minutes \| <正の数> \|」の行がない/);
  assert.throws(() => autoLimits(root(TABLE.replace('| runs-per-day | 3 |', '| runs-per-day | 2.5 |'))), /runs-per-day は整数/);
  assert.deepEqual(autoLimits(root(TABLE))['worker-budget-usd'], 10);
});
