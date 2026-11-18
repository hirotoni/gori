import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readFrontmatter } from './frontmatter.mjs';
import { treeLearningDir } from './learning.mjs';

const FLAT = [
  { dir: 'knowledge/procedures', kind: 'procedure', prefix: 'procedures' },
  { dir: 'knowledge/criteria', kind: 'criterion', prefix: 'criteria' },
  { dir: 'knowledge/agents', kind: 'role', prefix: 'agents' },
  { dir: 'knowledge/config', kind: 'config', prefix: 'config' },
];

function mdFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md') && statSync(join(dir, f)).isFile())
    .sort();
}

export function discoverUnits(root) {
  const units = [];
  for (const { dir, kind, prefix } of FLAT) {
    for (const f of mdFiles(join(root, dir))) {
      const id = f.slice(0, -3);
      units.push({ kind, id, key: `${prefix}/${id}`, path: `${dir}/${f}` });
    }
  }
  const skillsDir = join(root, 'knowledge', 'skills');
  if (existsSync(skillsDir)) {
    for (const id of readdirSync(skillsDir).sort()) {
      const rel = `knowledge/skills/${id}/SKILL.md`;
      if (existsSync(join(root, rel))) units.push({ kind: 'capability', id, key: `skills/${id}`, path: rel });
    }
  }
  return units.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

// 事例はツリーの外（git の共通ディレクトリの下の gori/learning/cases/）にある。--root が git の作業ツリーの最上位でなければ事例は無い。
function casesOf(root) {
  const dir = treeLearningDir(root);
  return dir ? join(dir, 'cases') : null;
}
export function caseKeys(root) {
  const dir = casesOf(root);
  return new Set(dir ? mdFiles(dir).map((f) => `cases/${f.slice(0, -3)}`) : []);
}

export function loadUnit(root, unit) {
  return { ...unit, ...readFrontmatter(readFileSync(join(root, unit.path), 'utf8')) };
}

export function parseRootArg(argv) {
  const i = argv.indexOf('--root');
  if (i < 0) return null;
  return argv[i + 1] ?? null;
}

// 前後が参照キーの文字なら別の名前の一部（criteria/done と criteria/done-check）なので、一致に数えない。
export function mentions(text, key) {
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![A-Za-z0-9_/-])${esc}(?![A-Za-z0-9_-])`).test(text);
}

export function unitPath(root, key) {
  const u = discoverUnits(root).find((x) => x.key === key);
  if (u) return u.path;
  const m = /^cases\/(.+)$/.exec(key);
  // 事例はツリーの外にあるので、root からの相対でなく絶対パスを返す。
  if (m && caseKeys(root).has(key)) return join(casesOf(root), `${m[1]}.md`);
  return null;
}
