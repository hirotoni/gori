import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { namesOf, staleNames } from '../../tools/lib/stale-names.mjs';

const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
function repo(files) {
  const dir = mkdtempSync(join(tmpdir(), 'gori-stale-'));
  const g = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8', env });
  g('init', '-q');
  g('config', 'user.name', 't');
  g('config', 'user.email', 't@t');
  const write = (fs) => {
    for (const [f, text] of Object.entries(fs)) {
      if (text === null) { rmSync(join(dir, f)); continue; }
      mkdirSync(dirname(join(dir, f)), { recursive: true });
      writeFileSync(join(dir, f), text);
    }
    g('add', '-A');
    g('commit', '-q', '-m', 'c');
    return g('rev-parse', 'HEAD').stdout.trim();
  };
  return { dir, g, base: write(files), write };
}

test('探す名前: パス、参照キー、- か _ を含むファイル名。一般のファイル名はフォルダの名前で読む', () => {
  assert.deepEqual(namesOf('knowledge/skills/improvement-dispatch/SKILL.md'), ['knowledge/skills/improvement-dispatch/SKILL.md', 'skills/improvement-dispatch', 'improvement-dispatch']);
  assert.deepEqual(namesOf('knowledge/procedures/bug-fix.md'), ['knowledge/procedures/bug-fix.md', 'procedures/bug-fix', 'bug-fix']);
  assert.deepEqual(namesOf('tools/records/log'), ['tools/records/log']);
  assert.deepEqual(namesOf('tools/setup-improvement-loop'), ['tools/setup-improvement-loop', 'setup-improvement-loop']);
  // 移しただけ（ファイル名が同じ）なら、ファイル名は探さない。
  assert.deepEqual(namesOf('a/stale-x.sh', 'b/stale-x.sh'), ['a/stale-x.sh']);
  assert.deepEqual(namesOf('a/stale-x.sh', 'a/fresh-x.sh'), ['a/stale-x.sh', 'stale-x']);
});

test('事例: 消したスキルを正本として名指すコメントが残ると見つける。印 keep-name の行は数えない', () => {
  const r = repo({
    'knowledge/skills/improvement-dispatch/SKILL.md': '# dispatch\n',
    'tools/stale_threshold.sh': '# 根拠の説明の正本は knowledge/skills/improvement-dispatch/SKILL.md 手順 2。\necho ok\n',
    'docs/history.md': '- 11-05 に improvement-dispatch を消した（keep-name）\n',
  });
  const sha = r.write({ 'knowledge/skills/improvement-dispatch/SKILL.md': null });
  const hits = staleNames(r.dir, r.base, sha);
  assert.deepEqual(hits.map((h) => `${h.file}:${h.line}`), ['tools/stale_threshold.sh:1']);
  assert.deepEqual(hits[0].names, [{ name: 'knowledge/skills/improvement-dispatch/SKILL.md', from: 'knowledge/skills/improvement-dispatch/SKILL.md' }]);
});

test('事例: 消した道具を今あるものとして説明する README の文が残ると見つける', () => {
  const r = repo({
    'tools/setup-improvement-loop': '#!/bin/sh\n',
    'README.md': '改善ループの導入の道具（`setup-improvement-loop`）もここに置く。\n',
  });
  const sha = r.write({ 'tools/setup-improvement-loop': null });
  assert.deepEqual(staleNames(r.dir, r.base, sha).map((h) => `${h.file}:${h.line}:${h.names.map((n) => n.name).join(',')}`), ['README.md:1:setup-improvement-loop']);
});

test('別の名前の一部としての一致と、消しも名前変更も無い範囲は数えない', () => {
  const r = repo({ 'tools/old-tool': 'x\n', 'README.md': 'old-tool-v2 と my-old-tool を使う\n' });
  assert.deepEqual(staleNames(r.dir, r.base, r.write({ 'tools/old-tool': null })), []);
  const s = repo({ 'a.md': 'a\n' });
  assert.deepEqual(staleNames(s.dir, s.base, s.write({ 'b.md': 'b\n' })), []);
});

test('名前を変えたら旧い名前の残りを見つける', () => {
  const r = repo({ 'tools/old-name': 'x\n', 'README.md': 'tools/old-name を使う\n' });
  const sha = r.write({ 'tools/old-name': null, 'tools/new-name': 'x\n' });
  assert.deepEqual(staleNames(r.dir, r.base, sha).map((h) => `${h.file}:${h.line}`), ['README.md:1']);
});

test('一つの行に消したファイルの名前が二つ残れば、一件にまとめて両方を示す', () => {
  const r = repo({ 'tools/old-a': 'x\n', 'tools/old-b': 'x\n', 'README.md': 'tools/old-a と tools/old-b を使う\n' });
  const sha = r.write({ 'tools/old-a': null, 'tools/old-b': null });
  const hits = staleNames(r.dir, r.base, sha);
  assert.equal(hits.length, 1);
  assert.deepEqual(hits[0].names.map((n) => n.from).sort(), ['tools/old-a', 'tools/old-b']);
});
