import assert from 'node:assert/strict';
import { test } from 'node:test';
import { run, tempTree } from '../helpers.mjs';

const unit = (kind, id) => `---\nid: ${id}\nkind: ${kind}\n---\n`;
const root = () =>
  tempTree({
    'knowledge/procedures/bug-fix.md': unit('procedure', 'bug-fix'),
    'knowledge/procedures/research.md': unit('procedure', 'research'),
    'knowledge/criteria/done-check.md': unit('criterion', 'done-check'),
    'knowledge/skills/reproduce/SKILL.md': unit('capability', 'reproduce'),
    'knowledge/skills/unused/SKILL.md': unit('capability', 'unused'),
  });

const line = (o) => JSON.stringify(o);
const use = (ts, name, input) => line({ type: 'assistant', timestamp: ts, message: { content: [{ type: 'tool_use', id: 't', name, input }] } });
const result = (ts, text) => line({ type: 'user', timestamp: ts, message: { content: [{ type: 'tool_result', tool_use_id: 't', content: text }] } });
const blob = (text) => line({ type: 'api-request-blob', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: text } }] } });

const projects = (sessions) => tempTree(Object.fromEntries(Object.entries(sessions).map(([n, ls]) => [`p/${n}.jsonl`, `${ls.join('\n')}\n`])));

const table = (r) => Object.fromEntries(r.out.trim().split('\n').filter((l) => !l.startsWith('#')).slice(1).map((l) => l.split('\t')).map(([k, i, rd]) => [k, [Number(i), Number(rd)]]));

const OLD = '2026-01-01T00:00:00.000Z';
const NEW = '2026-11-01T00:00:00.000Z';

test('呼び出しと読み込みをセッション単位で数える', () => {
  const p = projects({
    a: [
      use(OLD, 'Skill', { skill: 'gori:reproduce' }),
      use(OLD, 'Skill', { skill: 'gori:reproduce' }),
      use(OLD, 'Read', { file_path: '/x/gori/knowledge/procedures/bug-fix.md' }),
      use(OLD, 'Bash', { command: 'cat /x/gori/knowledge/skills/reproduce/SKILL.md' }),
    ],
    b: [use(OLD, 'Skill', { skill: 'gori:reproduce' }), use(OLD, 'Read', { file_path: '/x/gori/knowledge/procedures/bug-fix.md' })],
  });
  const t = table(run('records/usage', ['--root', root(), '--projects', p]));
  assert.deepEqual(t['skills/reproduce'], [2, 1]);
  assert.deepEqual(t['procedures/bug-fix'], [0, 2]);
});

test('他のプラグインの Skill や、ツールの結果と記録の写しに出たパスは数えない', () => {
  const p = projects({
    a: [
      use(OLD, 'Skill', { skill: 'core:reproduce' }),
      result(OLD, 'knowledge/procedures/research.md gori:done-check'),
      blob('knowledge/procedures/research.md'),
      use(OLD, 'Read', { file_path: '/x/knowledge/procedures/research.md.bak' }),
    ],
  });
  const t = table(run('records/usage', ['--root', root(), '--projects', p]));
  assert.deepEqual(t['skills/reproduce'], [0, 0]);
  assert.deepEqual(t['procedures/research'], [0, 0]);
});

test('0 回の知識ファイルも出し、合計の少ない順に並べる', () => {
  const p = projects({ a: [use(OLD, 'Skill', { skill: 'gori:reproduce' }), use(OLD, 'Read', { file_path: 'knowledge/procedures/bug-fix.md' }), use(OLD, 'Skill', { skill: 'gori:bug-fix' })] });
  const r = run('records/usage', ['--root', root(), '--projects', p]);
  const rows = r.out.trim().split('\n').filter((l) => !l.startsWith('# '));
  assert.equal(rows[0], 'key\tinvoked\tread');
  assert.equal(rows.length, 1 + 5);
  assert.deepEqual(rows.slice(1, 4).map((l) => l.split('\t')[0]), ['criteria/done-check', 'procedures/research', 'skills/unused']);
  assert.equal(rows.at(-1).split('\t')[0], 'procedures/bug-fix');
});

test('--since より前の呼び出しは数えない', () => {
  const p = projects({ a: [use(OLD, 'Skill', { skill: 'gori:reproduce' })], b: [use(NEW, 'Skill', { skill: 'gori:reproduce' })] });
  const t = table(run('records/usage', ['--root', root(), '--projects', p, '--since', '2026-06-01']));
  assert.deepEqual(t['skills/reproduce'], [1, 0]);
});

test('壊れた行と、会話の記録が無いディレクトリを許す', () => {
  const p = projects({ a: ['{broken', use(OLD, 'Skill', { skill: 'gori:reproduce' })] });
  assert.deepEqual(table(run('records/usage', ['--root', root(), '--projects', p]))['skills/reproduce'], [1, 0]);
  assert.equal(run('records/usage', ['--root', root(), '--projects', '/nonexistent/dir']).status, 0);
});

test('先頭に集計できた期間を # window で出し、--since がそれより古ければ stderr に知らせる', () => {
  const p = projects({ a: [use(OLD, 'Skill', { skill: 'gori:reproduce' })], b: [use(NEW, 'Skill', { skill: 'gori:reproduce' })] });
  const r = run('records/usage', ['--root', root(), '--projects', p]);
  assert.equal(r.out.split('\n')[0], '# window: 2026-01-01 .. 2026-11-01');
  const early = run('records/usage', ['--root', root(), '--projects', p, '--since', '2025-01-01']);
  assert.equal(early.status, 0);
  assert.match(early.out, /2025-01-01 より前の会話の記録は残っていない（最も古いのは 2026-01-01）/);
});
