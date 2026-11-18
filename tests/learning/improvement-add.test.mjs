import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { repoRoot } from '../helpers.mjs';

const skillDir = join(repoRoot, 'knowledge', 'skills', 'improvement-add');
const skill = join(skillDir, 'SKILL.md');

test('SKILL.md が指す ${CLAUDE_PLUGIN_ROOT} の参照は実在するファイルに届き、起票は tools/records/pool で行う', () => {
  const text = readFileSync(skill, 'utf8');
  const rooted = [...text.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([^`)\s]+)/g)].map((m) => m[1]);
  assert.ok(rooted.includes('tools/records/pool'), 'tools/records/pool への参照が無い');
  for (const p of rooted) assert.ok(existsSync(join(repoRoot, p)), `${p} が無い`);
});

test('スキルのディレクトリに SKILL.md 以外の補助ファイルを持たない', () => {
  assert.deepEqual(readdirSync(skillDir), ['SKILL.md']);
});
