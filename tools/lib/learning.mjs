// 学び（gori の git の共通ディレクトリの下の gori/learning/）を読み書きする道具が共有する部品。
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { readFrontmatter } from './frontmatter.mjs';

// 書き込み先は gori のリポジトリに限る。プラグインの導入先（キャッシュ）や作業中の別リポジトリに事例を書かないためである。
// --root が無ければ、現在のディレクトリの git の最上位を使い、それが gori でなければ推測せず失敗する。
export function goriRoot(flag) {
  let root = flag ? resolve(flag) : null;
  if (!root) {
    const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
    root = r.status === 0 ? r.stdout.trim() : resolve('.');
  }
  const manifest = join(root, '.claude-plugin', 'plugin.json');
  let name = null;
  try {
    name = JSON.parse(readFileSync(manifest, 'utf8')).name;
  } catch {
    // 下で失敗にする。
  }
  if (name !== 'gori') throw new Error(`${root} は gori のリポジトリでない（${manifest} の name が gori でない）。gori のチェックアウトで実行するか --root を渡す`);
  return root;
}

// 学びは、gori のチェックアウトの git の共通ディレクトリ（git rev-parse --git-common-dir）の下の gori/learning/ に置く。
// 共通ディレクトリはどの worktree から見ても同じなので、本体のチェックアウトでも課題の worktree でも同じ学びを読み書きする。
// 導入は git の clone が前提（tools/repo/install）なので、git のリポジトリでない root は失敗にする。
const learningDirs = new Map();
export function learningDir(root) {
  if (!learningDirs.has(root)) {
    const r = spawnSync('git', ['-C', root, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`${root} は git のリポジトリでないので、学びの場所（git の共通ディレクトリの下の gori/learning/）を決められない`);
    learningDirs.set(root, join(r.stdout.trim(), 'gori', 'learning'));
  }
  return learningDirs.get(root);
}
// 知識ファイルの道具（lint、show）が --root のツリーの学びを引く場所。
// --root が git の作業ツリーの最上位でなければ（git の外のツリー、リポジトリの中のフィクスチャ）、そのツリーの学びは無いものとして null を返す。
// リポジトリの中のフィクスチャから、それを含むリポジトリの学びを読まないためである。
export function treeLearningDir(root) {
  const r = spawnSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  if (r.status !== 0 || realpathSync(r.stdout.trim()) !== realpathSync(root)) return null;
  return learningDir(root);
}
export const casesDir = (root) => join(learningDir(root), 'cases');
export const retractionsDir = (root) => join(learningDir(root), 'retractions');
// 抽出待ちの会話。gori の SessionEnd フックが、終わった会話を一会話一ファイルで積み、抽出が処理を終えたら消す。
// フックは gori が読み込まれた会話でしか動かないので、ここにある会話は gori の会話で、かつ終わった会話である。
// ファイル名は会話の記録のファイル名（セッション ID）、中身は会話の記録のパスだけで、会話の中身は書かない。
export const pendingDir = (root) => join(learningDir(root), 'pending');

// 取り消しの id の一覧。形の崩れた取り消しも取り消しとして扱い、件数を多く見積もる側に倒さない。
// ただし黙って事例を隠さないよう、warn のときは崩れた取り消しを標準エラーに出す。
// case の list と count、metrics の件数は、この一つの規則で取り消しを除く。
export function loadRetractions(root, { warn = false } = {}) {
  const dir = casesDir(root);
  const rdir = retractionsDir(root);
  if (!existsSync(rdir)) return new Map();
  const out = new Map();
  for (const f of readdirSync(rdir).filter((n) => n.endsWith('.md')).sort()) {
    const id = f.slice(0, -3);
    const fm = readFrontmatter(readFileSync(join(rdir, f), 'utf8'));
    let error = fm.error?.message ?? null;
    if (!error && fm.fields?.id?.value !== id) error = `frontmatter の id がファイル名 ${id} と違う`;
    if (!error && !existsSync(join(dir, f))) error = `取り消す事例 ${id} が無い`;
    if (error && warn) console.error(`注意: 取り消し ${join(rdir, f)} の形が崩れている（${error}）。取り消しとして扱う`);
    out.set(id, { date: fm.fields?.retracted?.value ?? '', reason: (fm.bodyLines ?? []).join(' ').trim(), error });
  }
  return out;
}

// 事例の一覧。取り消した事例も retracted を付けて返す（重複の検査は取り消した事例も見るため）。
export function loadCases(root) {
  const dir = casesDir(root);
  if (!existsSync(dir)) return [];
  const retracted = loadRetractions(root, { warn: true });
  const out = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.md')).sort()) {
    const fm = readFrontmatter(readFileSync(join(dir, f), 'utf8'));
    const v = (k) => (fm.fields?.[k]?.type === 'scalar' ? fm.fields[k].value : '');
    out.push({ file: f, id: f.slice(0, -3), type: v('type'), pattern: v('pattern'), session: v('session'), message: v('message'), verdict: v('verdict'), retracted: retracted.has(f.slice(0, -3)), error: fm.error?.message ?? null });
  }
  return out;
}

export const CASE_ID = /^\d{4}-\d{2}-\d{2}-[a-z0-9]+(-[a-z0-9]+)*$/;
export const PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
export const CASE_TYPES = ['correction', 'skipped-step', 'verdict-fail', 'verdict-unverified', 'blocked'];
// レビュー結果から書く事例の種類。不合格（fail）と確認できず（unverified）を分け、成果の不備と確かめる手段の不足を別の事例にする（docs/design.md）。
export const VERDICT_CASE_TYPES = { fail: 'verdict-fail', unverified: 'verdict-unverified' };

// 会話の記録のパスを積み、積んだセッション ID を返す。同じ会話を二度積んでも一件のままである。
// パスが会話の記録の形でなければ積まず null を返す。
export function enqueue(root, transcriptPath) {
  if (typeof transcriptPath !== 'string' || !isAbsolute(transcriptPath) || !transcriptPath.endsWith('.jsonl')) return null;
  const id = basename(transcriptPath, '.jsonl');
  if (!SESSION_ID.test(id)) return null;
  mkdirSync(pendingDir(root), { recursive: true });
  writeFileSync(join(pendingDir(root), id), `${transcriptPath}\n`);
  return id;
}

// 抽出待ちの会話の、セッション ID から会話の記録のパスへの対応。
export function readPending(root) {
  const dir = pendingDir(root);
  const out = new Map();
  if (!existsSync(dir)) return out;
  for (const id of readdirSync(dir).sort()) {
    if (!SESSION_ID.test(id)) continue;
    const file = readFileSync(join(dir, id), 'utf8').trim();
    if (file) out.set(id, file);
  }
  return out;
}

// 処理を終えた会話を一覧から消す。一覧にあれば true を返す。
export function dequeue(root, id) {
  const file = join(pendingDir(root), id);
  if (!existsSync(file)) return false;
  rmSync(file, { force: true });
  return true;
}

// 抽出の書き込み先は、プラグインのルート（環境変数 GORI_ROOT があればそれ。テスト用の差し替え口）一か所だけである。
// そこが gori の git のチェックアウトでなければ { root: null, reason } を返す。マーケットプレイスから導入されたキャッシュは git でないので、決まらない。
export function resolveRoot(pluginRoot) {
  const dir = resolve(process.env.GORI_ROOT || pluginRoot);
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
  const r = spawnSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', env });
  const no = (why) => ({ root: null, reason: `${dir} は ${why}ので、抽出を起動しない` });
  if (r.status !== 0) return no('git のチェックアウトでない');
  const top = r.stdout.trim();
  try {
    if (realpathSync(top) !== realpathSync(dir)) return no('git のチェックアウトの最上位でない');
    if (JSON.parse(readFileSync(join(top, '.claude-plugin', 'plugin.json'), 'utf8')).name === 'gori') return { root: top };
  } catch {
    // 下で理由にする。
  }
  return no('gori のチェックアウトでない');
}

// 起動しなかった理由を、会話の中身を含めずに一行だけログに残す。
export function logSkip(home, reason) {
  const dir = join(home, 'logs');
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  writeFileSync(join(dir, `extract-${stamp}.log`), `skipped=${reason}\n`);
}

// 状態とログの置き場所。GORI_HOME が無ければ XDG Base Directory の状態の場所（$XDG_STATE_HOME/gori、既定 ~/.local/state/gori）に置き、ホームの直下を散らかさない。
// XDG の決まりに従い、XDG_STATE_HOME が絶対パスでなければ無視する。
// 既定の場所を組み立てるのはこの関数だけにする。
export function goriHome() {
  if (process.env.GORI_HOME) return resolve(process.env.GORI_HOME);
  const xdg = process.env.XDG_STATE_HOME;
  return join(xdg && isAbsolute(xdg) ? xdg : join(homedir(), '.local', 'state'), 'gori');
}
