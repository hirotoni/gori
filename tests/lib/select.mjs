#!/usr/bin/env node
// tests/run.sh --changed が使う、変えたファイルに関わるテストの選び方。
// テストの依存は静的に辿る。テストと道具の相対 import（推移）、テストと道具の中に書かれた道具のパス、
// fixture の呼び出し（tests/knowledge/fixtures/ の全体）である。道具は手順書や config を実行時に読み、
// 別の道具をパスの文字列で起動するので、辿れないものは全体に倒す。
// 選び漏れは、引数なしの tests/run.sh（全体）で拾う。
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// 変えると、どのテストの結果も変わりうるので全体を走らせるファイル。
const FULL_FILES = ['tests/helpers.mjs', 'tests/run.sh', 'tools/package.json'];
const FULL_DIRS = ['knowledge/', 'tests/lib/'];

// テストの単位。tests/run.sh が走らせるものと同じである。
export function testUnits(root) {
  const units = [];
  for (const d of readdirSync(join(root, 'tests'), { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    for (const f of readdirSync(join(root, 'tests', d.name))) {
      if (f.endsWith('.test.mjs') || (d.name === 'repo' && /^test_.*\.sh$/.test(f))) units.push(`tests/${d.name}/${f}`);
    }
  }
  return units.sort();
}

// 一つのファイルが直接指すファイル（リポジトリからの相対パス）。ディレクトリを指せば、その下のファイルをすべて含める。
// 辿るのはコード（.mjs、.js、.sh と、拡張子の無い道具）だけで、fixture の文書やデータの中の名前は辿らない。
// 行の頭からの注釈（// と #）に書いた名前も辿らない。
const isCode = (file) => /\.(mjs|js|sh)$/.test(file) || (/^(tools|tests)\//.test(file) && !/\.[^/]+$/.test(file.split('/').pop()));
function directDeps(root, file) {
  if (!isCode(file)) return [];
  let text;
  try {
    text = readFileSync(join(root, file), 'utf8');
  } catch {
    return [];
  }
  text = text.split('\n').filter((l) => !/^\s*(\/\/|#(?!!))/.test(l)).join('\n');
  const here = dirname(join(root, file));
  const out = new Set();
  // ディレクトリは tools/ か tests/ の下に限る（join(here, '..', '..') のようなリポジトリの根を拾わない）。
  const add = (abs) => {
    const rel = relative(root, normalize(abs));
    if (!rel || rel.startsWith('..') || !existsSync(abs)) return;
    if (statSync(abs).isDirectory()) {
      if (!/^(tools|tests)\/./.test(rel)) return;
      for (const f of filesUnder(root, rel)) out.add(f);
    } else out.add(rel);
  };
  // 相対の import（静的と動的）。
  for (const m of text.matchAll(/(?:\bfrom|\bimport\(?)\s*['"](\.{1,2}\/[^'"]+)['"]/g)) add(resolve(here, m[1]));
  // join(…, 'tools', 'x', 'y') と、ファイルの場所からの join(here, '..', 'x', 'y')。
  for (const m of text.matchAll(/'(?:tools|\.\.)'(?:\s*,\s*'[\w.-]+')+/g)) {
    const parts = [...m[0].matchAll(/'([\w.-]+)'/g)].map((p) => p[1]);
    add(parts[0] === 'tools' ? join(root, ...parts) : resolve(here, ...parts));
  }
  // 文字列やシェルに書いた tools/x/y。
  for (const m of text.matchAll(/(?<![\w.-])tools\/([\w-]+)\/([\w.-]+)/g)) add(join(root, 'tools', m[1], m[2]));
  // tests/helpers.mjs の run('x/y', …) は tools/x/y を起動する。
  for (const m of text.matchAll(/\brun\('([\w-]+\/[\w.-]+)'/g)) add(join(root, 'tools', m[1]));
  // シェルの "$(dirname "$0")/name" は同じディレクトリの道具を指す。
  for (const m of text.matchAll(/dirname "\$0"\)\/([\w.-]+)/g)) add(join(here, m[1]));
  // fixture の名前は変数で渡すことがあるので、fixture を使うテストは fixtures の全体に依存するとみなす。
  if (file !== 'tests/helpers.mjs' && /\b(?:copyFixture|gitFixture|fixture)\(/.test(text)) add(join(root, 'tests', 'knowledge', 'fixtures'));
  return [...out];
}

function filesUnder(root, rel) {
  const out = [];
  for (const d of readdirSync(join(root, rel), { withFileTypes: true })) {
    const p = `${rel}/${d.name}`;
    if (d.isDirectory()) out.push(...filesUnder(root, p));
    else out.push(p);
  }
  return out;
}

// テストの単位ごとの、推移的な依存の集合（単位そのものを含む）。
export function dependencyMap(root, units = testUnits(root)) {
  const memo = new Map();
  const closure = (unit) => {
    const seen = new Set([unit]);
    const stack = [unit];
    while (stack.length) {
      const f = stack.pop();
      if (!memo.has(f)) memo.set(f, directDeps(root, f));
      for (const d of memo.get(f)) {
        if (!seen.has(d)) {
          seen.add(d);
          stack.push(d);
        }
      }
    }
    return seen;
  };
  return new Map(units.map((u) => [u, closure(u)]));
}

// リポジトリ全体を読むテスト。git ls-files で本物のリポジトリのファイルを並べる。文書だけの変更でも走らせる。
const readsWholeRepo = (root, unit) => {
  try {
    return /ls-files/.test(readFileSync(join(root, unit), 'utf8'));
  } catch {
    return false;
  }
};

// 変えたファイルから、走らせるテストを選ぶ。
// 返り値は { all: true, because: [{ file, why }] } か { all: false, tests: [{ unit, because: [file] }] }。
export function selectTests(root, changed) {
  const units = testUnits(root);
  const deps = dependencyMap(root, units);
  const full = [];
  const picked = new Map();
  const pick = (unit, file) => {
    if (!picked.has(unit)) picked.set(unit, []);
    picked.get(unit).push(file);
  };
  const docs = [];
  for (const file of changed) {
    if (FULL_FILES.includes(file) || FULL_DIRS.some((d) => file.startsWith(d))) {
      full.push({ file, why: file.startsWith('knowledge/') ? '道具が実行時に読む知識ファイルは、依存を静的に辿れない' : 'テストの全体が使う' });
      continue;
    }
    const users = units.filter((u) => deps.get(u).has(file));
    if (users.length) {
      for (const u of users) pick(u, file);
      continue;
    }
    if (file.startsWith('tools/') || file.startsWith('tests/')) {
      full.push({ file, why: 'どのテストの依存にも見つからない' });
      continue;
    }
    if (/\.md$/i.test(file)) {
      docs.push(file);
      continue;
    }
    full.push({ file, why: '文書でも道具でもテストでもない' });
  }
  if (full.length) return { all: true, because: full };
  if (docs.length) for (const u of units.filter((u) => readsWholeRepo(root, u))) for (const f of docs) pick(u, f);
  const tests = [...picked].map(([unit, because]) => ({ unit, because })).sort((a, b) => a.unit.localeCompare(b.unit));
  return { all: false, tests };
}

// main（無ければ master）との分岐点から作業ツリーまでに変えたファイル。未追跡のファイルを含む。分岐点が無ければ null。
export function changedFiles(root) {
  const git = (...a) => spawnSync('git', ['-C', root, ...a], { encoding: 'utf8' });
  let base = null;
  for (const b of ['main', 'master']) {
    const r = git('merge-base', 'HEAD', b);
    if (r.status === 0) {
      base = r.stdout.trim();
      break;
    }
  }
  if (!base) return null;
  const diff = git('diff', '--name-only', '--no-renames', base);
  const untracked = git('ls-files', '--others', '--exclude-standard');
  if (diff.status !== 0 || untracked.status !== 0) return null;
  const files = new Set([...diff.stdout.split('\n'), ...untracked.stdout.split('\n')].filter(Boolean));
  return [...files].sort();
}

// tests/run.sh に渡す中身。out は標準出力の行（全体なら ALL、選んだなら走らせる単位）、explain は標準エラーに出す理由である。
export function plan(root) {
  const changed = changedFiles(root);
  if (changed === null) return { out: ['ALL'], explain: ['--changed: main とも master とも分岐点が見つからないので、全体を走らせる'] };
  const s = selectTests(root, changed);
  if (s.all) return { out: ['ALL'], explain: ['--changed: 次のファイルのために全体を走らせる', ...s.because.map((b) => `  ${b.file}（${b.why}）`)] };
  return {
    out: s.tests.map((t) => t.unit),
    explain: [`--changed: 変えたファイル ${changed.length} 件から、${s.tests.length} 件のテストを選んだ（lint と索引の検査はいつも走らせる）`, ...s.tests.map((t) => `  ${t.unit} ← ${t.because.join(', ')}`)],
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const p = plan(resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'));
  for (const l of p.explain) console.error(l);
  for (const l of p.out) console.log(l);
}
