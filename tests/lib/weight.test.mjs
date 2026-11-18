import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reviewWeight } from '../../tools/lib/weight.mjs';

test('振る舞いに効かない文書だけなら light、ほかは normal', () => {
  assert.equal(reviewWeight(['docs/design.md', 'README.md', 'notes/a.MD']).weight, 'light');
  for (const files of [
    [],
    ['tools/records/log'],
    ['docs/a.md', 'tools/lib/x.mjs'],
    ['knowledge/criteria/done.md'],
    ['agents/reviewer.md'],
    ['CLAUDE.md'],
    ['sub/AGENTS.md'],
    ['.claude/skills/x/SKILL.md'],
    ['pkg/.claude/commands/y.md'],
    ['tests/fixtures/a.md'],
    ['hooks/README.md'],
    ['.claude-plugin/x.md'],
    ['pkg/.claude-plugin/x.md'],
    ['sub/knowledge/a.md'],
  ]) assert.equal(reviewWeight(files).weight, 'normal', files.join());
  assert.equal(reviewWeight(['docs/a.md'], { e2e: true }).weight, 'normal');
  assert.match(reviewWeight(['docs/a.md', 'tools/x']).reason, /tools\/x/);
});
