// 改善候補、学び、手順書の候補のプール（gori の git の共通ディレクトリの下の gori/repos/<名前>/）を読み書きする部品。
// 道具 tools/records/pool が使う。設計は docs/design.md にある。
// 名前と gori/repos/<名前>/ の決め方（goriCheckout、resolvePool）は、記録の場所（tools/lib/audit.mjs）も使う（docs/design.md）。
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { readFrontmatter, parseFrontmatterLines } from './frontmatter.mjs';

// 失敗は終了コードを付けて投げ、道具の側でまとめて出す。
export class PoolError extends Error {
  constructor(message, code = 2) {
    super(message);
    this.code = code;
  }
}
const fail = (msg, code = 2) => {
  throw new PoolError(msg, code);
};

export const KINDS = ['learning', 'improvement', 'procedure'];
export const STATUSES = ['proposed', 'todo', 'rejected', 'done'];
export const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const POOL_ID = /^\d{8}-\d{6}-[a-z0-9]+(-[a-z0-9]+)*$/;
// 手順書の候補の根拠の作業。<リポジトリの名前>/<作業 ID>（新しい形か古い形）。
export const TASK_REF = /^[^/\\\s]+\/(\d{8}-\d{6}|\d{4}-\d{2}-\d{2})-[a-z0-9]+(-[a-z0-9]+)*$/;
const HEADINGS = ['## 現状', '## 問題', '## 期待する結果', '## 確認したこと', '## 受け入れ条件'];

export function runGit(dir, args) {
  const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

// gori のチェックアウト。環境変数 GORI_ROOT があればそれ（テスト用の差し替え口）、無ければ道具の場所から求めた dir。
// そこが git のチェックアウトの最上位で、.claude-plugin/plugin.json の name が gori でなければ推測せず失敗する。
export function goriCheckout(defaultDir) {
  const dir = resolve(process.env.GORI_ROOT || defaultDir);
  const top = runGit(dir, ['rev-parse', '--show-toplevel']);
  let ok = false;
  try {
    ok = top !== null && realpathSync(top) === realpathSync(dir) && JSON.parse(readFileSync(join(dir, '.claude-plugin', 'plugin.json'), 'utf8')).name === 'gori';
  } catch {
    // 下で失敗にする。
  }
  if (!ok) fail(`${dir} は gori の git のチェックアウトでない（git の最上位で、.claude-plugin/plugin.json の name が gori であること）`);
  return dir;
}

// プールを並べる根。どの worktree から見ても同じ git の共通ディレクトリの下に置く。
export function reposDir(gori) {
  const common = runGit(gori, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  if (!common) fail(`${gori}: git の共通ディレクトリを求められない`);
  return join(common, 'gori', 'repos');
}

// 対象のリポジトリの本体のチェックアウト。worktree の中から呼んでも、git worktree list の先頭（本体）を返す。
function mainCheckout(cwd, hint = '対象のリポジトリの中で実行する（全リポジトリを見るなら list --all）') {
  if (runGit(cwd, ['rev-parse', '--show-toplevel']) === null) fail(`${cwd} は git のリポジトリでない。${hint}`);
  const list = runGit(cwd, ['worktree', 'list', '--porcelain']) ?? '';
  const first = list.split('\n').find((l) => l.startsWith('worktree '));
  if (!first) fail(`${cwd}: 本体のチェックアウトを git worktree list から求められない`);
  const main = first.slice('worktree '.length);
  try {
    return realpathSync(main);
  } catch {
    return fail(`${cwd}: 本体のチェックアウト ${main}（git worktree list の先頭）が無い`);
  }
}

const NAME = /^[^/\\\s]+$/;

// 名前と gori/repos/<名前>/ の場所を決める。repo.yml の path が本体のチェックアウトと違えば止まる（推測で混ぜない）。
// write が真なら、repo.yml が無いときに作る。fix は食い違いのときに示す直し方、notRepo は cwd が git のリポジトリでないときに示す直し方である
// （記録の道具は --name も list --all も持たない）。
export function resolvePool(gori, cwd, nameFlag, { write = false, fix = '--name で別の名前を渡すか、repo.yml を直す', notRepo } = {}) {
  const main = mainCheckout(cwd, notRepo);
  const name = nameFlag ?? basename(main);
  if (!NAME.test(name) || name === '.' || name === '..') fail(`名前 ${JSON.stringify(name)} は使えない（/ や空白を含まない一語）`);
  const dir = join(reposDir(gori), name);
  const yml = join(dir, 'repo.yml');
  if (existsSync(yml)) {
    let path = null;
    try {
      path = parseFrontmatterLines(readFileSync(yml, 'utf8').replace(/\r\n/g, '\n').split('\n'), 1).path?.value ?? null;
    } catch {
      // 下で失敗にする。
    }
    if (path === null) fail(`${yml}: path を読めない。repo.yml を直す`);
    let real = path;
    try {
      real = realpathSync(path);
    } catch {
      // 消えたパスはそのまま比べる（食い違いになる）。
    }
    if (real !== main) fail(`${yml} の path（${path}）が今のリポジトリ（${main}）と違う。${fix}`);
  } else if (write) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(yml, `path: ${yamlScalar(main)}\n`);
  }
  return { name, dir, poolDir: join(dir, 'pool'), main };
}

// frontmatter の値を、frontmatter.mjs の部分集合で読み戻せる形に書く。読み戻せない値は書かない。
function yamlScalar(v) {
  const s = String(v);
  if (/[\r\n]/.test(s)) fail(`値に改行は入れられない: ${JSON.stringify(s)}`);
  if (/^[A-Za-z0-9/][A-Za-z0-9._/:+-]*$/.test(s) && !s.endsWith(':')) return s;
  if (!s.includes('"') && !s.includes('\\')) return `"${s}"`;
  if (!s.includes("'") && !s.includes('\\')) return `'${s}'`;
  return fail(`値に " と ' の両方、または \\ を入れられない: ${JSON.stringify(s)}`);
}
const yamlValue = (v) => (Array.isArray(v) ? `[${v.map(yamlScalar).join(', ')}]` : yamlScalar(v));

// 一件を読む。fields は { キー: 文字列か文字列のリスト }、body は frontmatter の後ろの全文。
export function parseItem(text, file) {
  const fm = readFrontmatter(text);
  if (fm.error) fail(`${file}:${fm.error.line}: ${fm.error.message}`);
  const fields = {};
  for (const [k, node] of Object.entries(fm.fields)) {
    if (node.type === 'map') fail(`${file}:${node.line}: ${k} に入れ子は使わない`);
    fields[k] = node.value;
  }
  return { fields, body: fm.bodyLines.join('\n') };
}

export function serializeItem(fields, body) {
  const lines = Object.entries(fields).map(([k, v]) => `${k}: ${yamlValue(v)}`);
  return `---\n${lines.join('\n')}\n---\n${body}`;
}

export const itemPath = (poolDir, id) => join(poolDir, `${id}.md`);

export function readItem(poolDir, id) {
  if (!POOL_ID.test(id)) fail(`${id} は一件の ID（<YYYYMMDD>-<hhmmss>-<slug>）の形でない`);
  const file = itemPath(poolDir, id);
  if (!existsSync(file)) fail(`${id}: 一件が無い（${file}）`);
  const text = readFileSync(file, 'utf8');
  return { file, text, ...parseItem(text, file) };
}

// 書き換えは一時ファイルに書いてから置き換え、途中で切れたファイルを残さない。
export function writeItem(file, fields, body) {
  const text = serializeItem(fields, body);
  parseItem(text, file);
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

// プールの全件を ID 順（＝起票の順）で返す。形の崩れた一件は飛ばさず失敗にする（黙って隠さない）。
export function loadItems(poolDir) {
  if (!existsSync(poolDir)) return [];
  return readdirSync(poolDir)
    .filter((f) => f.endsWith('.md') && POOL_ID.test(f.slice(0, -3)))
    .sort()
    .map((f) => {
      const file = join(poolDir, f);
      const text = readFileSync(file, 'utf8');
      return { id: f.slice(0, -3), file, text, ...parseItem(text, file) };
    });
}

// 本文の「## 受け入れ条件」の下の、- で始まる行。
export function acceptanceItems(body) {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const at = lines.findIndex((l) => l.trimEnd() === '## 受け入れ条件');
  const section = at < 0 ? [] : lines.slice(at + 1);
  const next = section.findIndex((l) => /^## /.test(l));
  return (next < 0 ? section : section.slice(0, next)).map((l) => /^- (.+)$/.exec(l.trim())?.[1]?.trim()).filter(Boolean);
}

export function missingHeadings(body) {
  const lines = new Set(body.split('\n').map((l) => l.trimEnd()));
  return HEADINGS.filter((h) => !lines.has(h));
}

// 起票の時刻を ID の頭にする（ローカル時刻）。
export function idStamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

// 本文の ## 現状 の見出しの直後に一行を足す。
export function prependToCurrent(body, line) {
  const lines = body.split('\n');
  const i = lines.findIndex((l) => l.trimEnd() === HEADINGS[0]);
  const next = lines[i + 1];
  const insert = next !== undefined && next.trim() !== '' ? [line, ''] : [line];
  lines.splice(i + 1, 0, ...insert);
  return lines.join('\n');
}

const asList = (v) => (Array.isArray(v) ? v : v ? [v] : []);
export const listField = (fields, k) => asList(fields[k]);

// 行（列の配列）を、最後の列を除いて最長の値の幅に空白で埋め、空白二つで繋ぐ。端末で読むときの表示に使う。
// 幅は文字数で数える。埋める列（リポジトリの名前、ID、状態、種類）は ASCII だけで、全角を含みうる題は最後の列なので揃えに効かない。
export function alignRows(rows) {
  const widths = [];
  for (const r of rows) r.slice(0, -1).forEach((c, i) => (widths[i] = Math.max(widths[i] ?? 0, c.length)));
  return rows.map((r) => r.map((c, i) => (i < r.length - 1 ? c.padEnd(widths[i]) : c)).join('  '));
}

// 対象のリポジトリの main（無ければ master）。
export function mainBranch(repo) {
  for (const b of ['main', 'master']) if (runGit(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${b}`]) !== null) return b;
  return null;
}

// SHA をフルの commit に解決し、main に含まれることを確かめる。
export function commitOnMain(repo, sha) {
  const full = runGit(repo, ['rev-parse', '--verify', '--quiet', `${sha}^{commit}`]);
  if (!full) fail(`${sha} を ${repo} の commit に解決できない`);
  const branch = mainBranch(repo);
  if (!branch) fail(`${repo} に main も master も無い`);
  const r = spawnSync('git', ['-C', repo, 'merge-base', '--is-ancestor', full, `refs/heads/${branch}`], { encoding: 'utf8' });
  if (r.status !== 0) fail(`${full} は ${repo} の ${branch} に含まれない。main に入ってから done にする`);
  return full;
}
