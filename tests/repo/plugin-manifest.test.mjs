import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot, tempTree } from '../helpers.mjs';

// Claude Code reads only the plugin root's skills/ and agents/ unless plugin.json names other paths,
// so a unit under knowledge/ that plugin.json does not name is silently never loaded.
function undeclared(root) {
  const manifest = JSON.parse(readFileSync(join(root, '.claude-plugin', 'plugin.json'), 'utf8'));
  const missing = [];
  const skillsDir = join(root, 'knowledge', 'skills');
  if (existsSync(skillsDir) && readdirSync(skillsDir).length > 0 && !(manifest.skills ?? []).includes('./knowledge/skills/')) {
    missing.push('./knowledge/skills/');
  }
  const agentsDir = join(root, 'knowledge', 'agents');
  if (existsSync(agentsDir)) {
    for (const f of readdirSync(agentsDir).filter((f) => f.endsWith('.md'))) {
      const path = `./knowledge/agents/${f}`;
      if (!(manifest.agents ?? []).includes(path)) missing.push(path);
    }
  }
  return missing;
}

const manifest = (extra) => JSON.stringify({ name: 'gori', ...extra });

test('リポジトリの plugin.json が knowledge/ の能力と役割をすべて宣言している', () => {
  assert.deepEqual(undeclared(repoRoot), []);
});

test('宣言の無い能力と役割を名指しする', () => {
  const root = tempTree({
    '.claude-plugin/plugin.json': manifest({}),
    'knowledge/skills/reproduce/SKILL.md': 'x',
    'knowledge/agents/reviewer.md': 'x',
  });
  assert.deepEqual(undeclared(root), ['./knowledge/skills/', './knowledge/agents/reviewer.md']);
});

test('宣言があれば通る', () => {
  const root = tempTree({
    '.claude-plugin/plugin.json': manifest({ skills: ['./knowledge/skills/'], agents: ['./knowledge/agents/reviewer.md'] }),
    'knowledge/skills/reproduce/SKILL.md': 'x',
    'knowledge/agents/reviewer.md': 'x',
  });
  assert.deepEqual(undeclared(root), []);
});

test('plugin.json の hooks が指すファイルが実在し、SessionStart が実在するスクリプトを呼ぶ', () => {
  const manifest = JSON.parse(readFileSync(join(repoRoot, '.claude-plugin', 'plugin.json'), 'utf8'));
  const hooks = JSON.parse(readFileSync(join(repoRoot, manifest.hooks), 'utf8'));
  const entry = hooks.hooks.SessionStart[0];
  assert.equal(entry.matcher, 'startup|resume|clear|compact');
  const script = entry.hooks[0].command.replace('${CLAUDE_PLUGIN_ROOT}', repoRoot).replaceAll('"', '');
  assert.ok(existsSync(script));
});
