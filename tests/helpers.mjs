import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const fixture = (name) => join(repoRoot, 'tests', 'knowledge', 'fixtures', name);

export function run(bin, args) {
  const r = spawnSync(process.execPath, [join(repoRoot, 'tools', bin), ...args], { encoding: 'utf8' });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

export function tempTree(files) {
  const dir = mkdtempSync(join(tmpdir(), 'gori-test-'));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
  return dir;
}

export function copyFixture(name) {
  const dir = mkdtempSync(join(tmpdir(), 'gori-test-'));
  cpSync(fixture(name), dir, { recursive: true });
  return dir;
}

// 学び（事例と取り消し）は作業ツリーでなく、git の共通ディレクトリの下の gori/learning/ に置く。
// 一時ツリーを git init し、ツリーの learning/ をその場所へ移す。files や fixture の learning/... は、移す前の置き場所を表す。
function asGoriRepo(dir) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
  const r = spawnSync('git', ['init', '-q', dir], { encoding: 'utf8', env });
  if (r.status !== 0) throw new Error(`git init に失敗した: ${r.stderr}`);
  if (existsSync(join(dir, 'learning'))) {
    mkdirSync(join(dir, '.git', 'gori'), { recursive: true });
    renameSync(join(dir, 'learning'), join(dir, '.git', 'gori', 'learning'));
  }
  return dir;
}
export const gitTree = (files) => asGoriRepo(tempTree(files));
export const gitFixture = (name) => asGoriRepo(copyFixture(name));

// 記録（判断の記録、レビュー結果、レビューの出力）は gori のチェックアウトの .git/gori/repos/<名前>/ に置く（docs/design.md）。
// テストは一時の gori のチェックアウト（git init と .claude-plugin/plugin.json の name が gori）を作り、GORI_ROOT で道具に渡す。
// GORI_ROOT を渡し忘れると、道具は本物の gori のチェックアウトに書くので、記録の道具を呼ぶテストは必ず渡す。
export function fakeGori(prefix = 'gori-fake-') {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
  const r = spawnSync('git', ['init', '-q', dir], { encoding: 'utf8', env });
  if (r.status !== 0) throw new Error(`git init に失敗した: ${r.stderr}`);
  mkdirSync(join(dir, '.claude-plugin'), { recursive: true });
  writeFileSync(join(dir, '.claude-plugin', 'plugin.json'), '{"name":"gori"}\n');
  return dir;
}

// テストのプロセスで共有する一時の gori。一時リポジトリは mkdtemp の名前で互いに違うので、記録の場所も重ならない。
let shared = null;
export const testGori = () => (shared ??= fakeGori());

// 本体のチェックアウト main の記録の場所。名前は本体のチェックアウトのディレクトリ名である（worktree から書いても同じ）。
export const recordsDir = (main, gori = testGori()) => join(gori, '.git', 'gori', 'repos', basename(main));
