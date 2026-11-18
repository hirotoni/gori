// 無人の作業の今の状態（docs/design.md の「自律起動」の「知らせ」）。実行の記録と判断の記録から読む。モデルは使わない。
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { FIX_TARGET, parseAudit } from './audit.mjs';
import { reposDir } from './pool.mjs';

export const autoDir = (gori) => join(dirname(reposDir(gori)), 'auto');

export const alive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
};

// 着手済みの一件。pool:<ID> の受け入れ条件の行（取り下げていないもの）を持ち、done の行が無い作業があれば、その一件は選ばない。
// 人間が会話で進めている作業も、止まって人間を待っている無人の作業も、この判定で避ける。
export function takenIds(auditDir) {
  const taken = new Map();
  if (!existsSync(auditDir)) return taken;
  for (const f of readdirSync(auditDir).filter((x) => x.endsWith('.tsv')).sort()) {
    let rows;
    try {
      rows = parseAudit(readFileSync(join(auditDir, f), 'utf8')).slice(1);
    } catch {
      continue;
    }
    if (rows.some((r) => r.row.type === 'done')) continue;
    const withdrawn = new Set(rows.filter((r) => r.row.type === 'fix').map((r) => FIX_TARGET.exec(r.row.what)).filter((m) => m && m[2] === '取り下げ').map((m) => Number(m[1])));
    for (const r of rows) {
      const m = r.row.type === 'accept' && !withdrawn.has(r.line) ? /^pool:(\S+)$/.exec(r.row.what.trim()) : null;
      if (m) taken.set(m[1], f.slice(0, -4));
    }
  }
  return taken;
}

// セッション sid が start の行を書いた作業のうち、最後に始めたもの。無ければ null。
// 担当が受け入れ条件の行を書く前に止まった無人の作業を、その実行と結び付けるために使う。
// since（<YYYYMMDD>-<hhmmss>）を渡すと、作業 ID がそれより前の記録は読まない。作業 ID は始めた時刻から付くので、実行より前に始めた作業を飛ばせる。
export function sessionTask(auditDir, sid, since = '') {
  if (!sid || !existsSync(auditDir)) return null;
  let found = null;
  for (const f of readdirSync(auditDir).filter((x) => x.endsWith('.tsv') && x >= since).sort()) {
    try {
      if (parseAudit(readFileSync(join(auditDir, f), 'utf8')).slice(1).some((r) => r.row.type === 'start' && r.row.session === sid)) found = f.slice(0, -4);
    } catch {
      // 読めない記録は飛ばす。
    }
  }
  return found;
}

// 実行の記録が作業と結び付けた一件のうち、その作業に done の行が無いもの（リポジトリ name の一件の ID）。
// 受け入れ条件の行を持たない作業も含むので、takenIds と合わせて、止まって人間を待っている一件を選び直さない。
// 複数のリポジトリで呼ぶときは、一度だけ読んだ実行の記録を runs に渡す。
export function heldIds(gori, name, runs = loadRuns(gori)) {
  const held = new Set();
  const auditDir = join(reposDir(gori), name, 'audit');
  for (const r of runs) {
    if (r.unreadable || typeof r.task !== 'string' || typeof r.pool !== 'string' || !r.pool.startsWith(`${name}/`)) continue;
    let rows;
    try {
      rows = parseAudit(readFileSync(join(auditDir, `${r.task}.tsv`), 'utf8')).slice(1);
    } catch {
      continue;
    }
    if (!rows.some((x) => x.row.type === 'done')) held.add(r.pool.slice(name.length + 1));
  }
  return held;
}

// 実行の記録を古い順に読む。読めないファイルは unreadable として残す（一日の回数では、起動した一回に数える）。
export function loadRuns(gori) {
  const dir = join(autoDir(gori), 'runs');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => {
    const file = join(dir, f);
    try {
      return { ...JSON.parse(readFileSync(file, 'utf8')), file, name: f };
    } catch {
      return { file, name: f, unreadable: true };
    }
  });
}

const pad = (n) => String(n).padStart(2, '0');
const whenOf = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// 取り込み待ちの作業（merge）、人間を待って止まった作業（stopped）、直近の失敗（failure）。
// 一件ごとに最新の実行の記録を見て、その作業の判断の記録に done があれば出さない。合否は今のレビュー結果で決める。
export function autoStatus(gori, toolRoot) {
  const runs = loadRuns(gori).filter((r) => !r.unreadable && typeof r.pool === 'string' && r.pool.includes('/'));
  const repos = reposDir(gori);
  let holder = NaN;
  try {
    holder = Number(readFileSync(join(autoDir(gori), 'run.lock'), 'utf8').trim());
  } catch {
    // ロックが無い。
  }
  const running = alive(holder);
  // レビュアーのセッションから呼ばれても、その作業の場所でなく、記録にある作業の場所でレビュー結果を確かめる。
  const checkEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'GORI_WORK_REPO' && k !== 'GORI_VERDICT_OUTBOX'));
  const latest = new Map();
  for (const r of runs) latest.set(r.pool, r);
  const merge = [];
  const stopped = [];
  const finished = new Set();
  for (const r of latest.values()) {
    // 最新の一回が今も動いていれば、終わるまで出さない。
    if (r.outcome === 'running' && running) continue;
    const [name, id] = [r.pool.slice(0, r.pool.indexOf('/')), r.pool.slice(r.pool.indexOf('/') + 1)];
    const auditDir = join(repos, name, 'audit');
    // 結果を書く前に切れた実行は作業 ID を持たないので、その一件を指す終わっていない作業を探す。
    const task = r.task ?? (r.outcome === 'running' ? takenIds(auditDir).get(id) ?? null : null);
    if (!task) continue;
    let rows;
    try {
      rows = parseAudit(readFileSync(join(auditDir, `${task}.tsv`), 'utf8')).slice(1);
    } catch {
      continue;
    }
    if (rows.some((x) => x.row.type === 'done')) {
      finished.add(r.pool);
      continue;
    }
    const pass = existsSync(r.repo ?? '')
      ? spawnSync(process.execPath, [join(toolRoot, 'tools', 'records', 'verdict'), 'check', '--task', task], { cwd: r.repo, encoding: 'utf8', env: checkEnv }).status === 0
      : r.verdict === 0;
    if (pass) merge.push({ pool: r.pool, task, repo: r.repo });
    else {
      const pause = rows.filter((x) => x.row.type === 'pause').at(-1)?.row.what;
      stopped.push({ pool: r.pool, task, repo: r.repo, reason: pause ?? r.reason ?? '結果を書く前に実行が切れた' });
    }
  }
  // 直近の失敗。最新の実行の記録が失敗か、結果を書かずに切れたときに出す。その作業が done になっていれば出さない。
  let failure = null;
  const last = runs.at(-1);
  if (last) {
    const cut = last.outcome === 'running' && !running;
    if ((last.outcome === 'failed' || cut) && !finished.has(last.pool)) failure = { when: whenOf(last.started), pool: last.pool, reason: cut ? '結果を書く前に実行が切れた' : last.reason ?? '理由の記録が無い', file: last.file };
  }
  return { merge, stopped, failure };
}

export function statusLines({ merge, stopped, failure }) {
  const out = [];
  if (merge.length) out.push(`取り込み待ち: ${merge.length} 件（レビューに合格した。人間が中身を確かめて取り込む）`, ...merge.map((m) => `  ${m.pool} 作業 ${m.task}（${m.repo}）`));
  if (stopped.length) out.push(`人間を待って止まった作業: ${stopped.length} 件`, ...stopped.map((s) => `  ${s.pool} 作業 ${s.task}（${s.repo}）: ${s.reason}`));
  if (failure) out.push(`直近の失敗: ${failure.when} ${failure.pool}: ${failure.reason}（記録: ${failure.file}）`);
  if (!out.length) out.push('無人の作業で、人間の対応が要るものは無い');
  return out;
}
