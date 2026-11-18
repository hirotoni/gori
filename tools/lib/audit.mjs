import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PoolError, goriCheckout, resolvePool } from './pool.mjs';

export const COLUMNS = ['time', 'session', 'type', 'step', 'what', 'why', 'evidence', 'result'];
// fix 行の what は「行 N を訂正: <正しい内容>」か「行 N を取り下げ: <理由>」で始まる。取り下げた accept 行は、レビュアーに基準として渡さない（tools/records/review）。
export const FIX_TARGET = /行\s*(\d+)\s*を(訂正|取り下げ)/;

export const TYPES = ['start', 'decision', 'accept', 'approval', 'check', 'fix', 'pause', 'resume', 'done', 'step', 'step-done', 'step-skip'];
// 作業 ID は <YYYYMMDD>-<hhmmss>-<slug>（作業を始めたときのローカル時刻）。記録や worktree が着手した順に並ぶ。道具（log start --slug）が発行する。
// 既存の記録・ブランチ・レビュー結果は古い形 <YYYY-MM-DD>-<slug> なので、TASK_ID は両方に当たる。新しく始める作業だけ NEW_TASK_ID で検査する。
export const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const NEW_TASK_ID = /^\d{8}-\d{6}-[a-z0-9]+(-[a-z0-9]+)*$/;
const OLD_TASK_ID = /^\d{4}-\d{2}-\d{2}-[a-z0-9]+(-[a-z0-9]+)*$/;
export const TASK_ID = new RegExp(`(?:${NEW_TASK_ID.source})|(?:${OLD_TASK_ID.source})`);
export const TASK_ID_FORM = '<YYYYMMDD>-<hhmmss>-<slug>（古い形 <YYYY-MM-DD>-<slug> も受け付ける。slug は小文字英数字とハイフン）';

export function newTaskId(slug, date = new Date()) {
  if (!SLUG.test(slug ?? '')) throw new Error(`slug は小文字英数字とハイフンで書く（${slug}）`);
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}-${slug}`;
}
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/;

export const sanitize = (v) => String(v ?? '').replace(/[\t\r\n]+/g, ' ').trim();

export function nowIso(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const off = -date.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}${sign}${p(Math.floor(a / 60))}:${p(a % 60)}`;
}

export function git(repo, args) {
  const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

// 作業の commit の範囲の起点。
// start 行に記録した base=<sha>、無ければ start より前の最後の commit、それも無ければ sha の親、親も無ければ空の木。
export function workBase(repo, start, sha) {
  const recorded = /^base=([0-9a-f]{40})$/.exec(start?.result ?? '')?.[1];
  if (recorded && recorded !== sha && spawnSync('git', ['-C', repo, 'merge-base', '--is-ancestor', recorded, sha]).status === 0) {
    return { base: recorded, how: 'start 行に記録した、作業を始めた時点の HEAD' };
  }
  const before = start?.time ? git(repo, ['rev-list', '-1', '--first-parent', `--before=${start.time}`, sha]) : null;
  if (before && before !== sha) return { base: before, how: `start 行（${start.time}）より前の最後の commit` };
  const parent = git(repo, ['rev-parse', '--verify', '-q', `${sha}~1`]);
  if (parent) return { base: parent, how: `親 commit（start 行より前の commit が分からないため）` };
  return { base: EMPTY_TREE, how: '空の木（親 commit が無いため）' };
}

// 行番号はファイルの物理行（ヘッダが 1 行目）。fix の「行 N」も同じ数え方を使う。
export function parseAudit(text) {
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines.map((raw, i) => {
    const cells = raw.split('\t');
    return { line: i + 1, raw, cells, row: Object.fromEntries(COLUMNS.map((c, j) => [c, cells[j]])) };
  });
}

// accept 行と、それを訂正するか取り下げる fix 行から、今も有効な受け入れ条件を求める（skills/decision-log）。
// numbered は parseAudit の結果から列名の行を除いたもの。review と draft-pr が同じ求め方を使う。
export function acceptState(numbered) {
  const accepts = numbered.filter((r) => r.row.type === 'accept');
  const acceptLines = new Set(accepts.map((r) => r.line));
  const fixesOf = (kind) => numbered.filter((r) => {
    if (r.row.type !== 'fix') return false;
    const m = FIX_TARGET.exec(r.row.what);
    return m && m[2] === kind && acceptLines.has(Number(m[1]));
  }).map((r) => ({ ...r, target: Number(FIX_TARGET.exec(r.row.what)[1]) }));
  const withdrawals = fixesOf('取り下げ');
  const withdrawnLines = new Set(withdrawals.map((r) => r.target));
  const corrections = fixesOf('訂正').filter((r) => !withdrawnLines.has(r.target));
  const active = accepts.filter((r) => !withdrawnLines.has(r.line));
  return { accepts, fixesOf, withdrawals, corrections, active };
}

// time の単調増加は秒の分解能のため同時刻を許す。
export function checkAudit(text) {
  const out = [];
  const bad = (line, rule, message) => out.push({ line, rule, message });
  const rows = parseAudit(text);
  if (rows.length === 0) return [{ line: 1, rule: 'bad-header', message: 'ファイルが空である' }];
  if (rows[0].raw !== COLUMNS.join('\t')) bad(1, 'bad-header', `一行目が列名の行（${COLUMNS.join('、')}）でない`);
  let doneLine = null;
  let lastTime = null;
  let starts = 0;
  let stepsOpen = false;
  const stepNums = new Set();
  const settled = new Set();
  rows.slice(1).forEach((r, idx) => {
    const n = r.line;
    if (r.cells.length !== COLUMNS.length) return bad(n, 'column-count', `列数が ${r.cells.length} である（${COLUMNS.length} 列でなければならない）`);
    const empty = COLUMNS.filter((c) => r.row[c].trim() === '');
    if (empty.length) bad(n, 'empty-field', `空の列がある: ${empty.join('、')}（値が無いときは - を書く）`);
    if (doneLine !== null) bad(n, 'after-done', `done 行（${doneLine} 行目）の後に行がある`);
    if (!TYPES.includes(r.row.type)) bad(n, 'bad-type', `type「${r.row.type}」は ${TYPES.join(' | ')} のいずれかでなければならない`);
    if (r.row.type === 'start') {
      starts++;
      if (idx !== 0) bad(n, 'start-position', 'start 行は最初のデータ行に一つだけ置ける');
    } else if (idx === 0) {
      bad(n, 'start-position', '最初のデータ行が start 行でない');
    }
    if (!TIME.test(r.row.time)) {
      bad(n, 'bad-time', `time「${r.row.time}」が秒までのタイムゾーン付き ISO 8601 でない`);
    } else {
      const t = Date.parse(r.row.time);
      if (Number.isNaN(t)) bad(n, 'bad-time', `time「${r.row.time}」が実在の日時でない`);
      else {
        if (lastTime !== null && t < lastTime) bad(n, 'time-order', 'time が前の行より前である');
        lastTime = t;
      }
    }
    if (r.row.type === 'step') {
      if (!stepsOpen) bad(n, 'step-position', 'step 行は start 行の直後に連続してだけ置ける');
      stepNums.add(r.row.step);
    } else {
      stepsOpen = r.row.type === 'start';
    }
    if (r.row.type === 'step-done' || r.row.type === 'step-skip') {
      if (!stepNums.has(r.row.step)) bad(n, 'step-unknown', `step「${r.row.step}」は start の直後に写した step 行の番号にない`);
      else settled.add(r.row.step);
    }
    if (r.row.type === 'step-skip' && r.row.why.trim() === '-') bad(n, 'skip-reason', 'step-skip の why（飛ばす理由）が - である');
    if (r.row.type === 'done' && doneLine === null) {
      const left = [...stepNums].filter((s) => !settled.has(s));
      if (left.length) bad(n, 'step-unfinished', `step ${left.join('、')} が step-done でも step-skip でもないまま done にしている`);
    }
    if (r.row.type === 'fix') {
      const m = FIX_TARGET.exec(r.row.what);
      if (!m) bad(n, 'fix-target', 'what に「行 N を訂正」か「行 N を取り下げ」の形で対象の行番号がない');
      else {
        const target = Number(m[1]);
        if (target < 2 || target >= n) bad(n, 'fix-target', `${m[2]}の対象 ${target} 行目が、この行より前のデータ行でない`);
      }
    }
    if (r.row.type === 'done' && doneLine === null) doneLine = n;
  });
  return out;
}

// レビュアーのセッションを環境変数から取る。引数での自己申告は受けない。
export function envSessionId() {
  return sanitize(process.env.CLAUDE_CODE_SESSION_ID || process.env.CLAUDE_SESSION_ID || '');
}

// GORI_WORK_REPO は、作業リポジトリの外（レビュアーの worktree）から元の作業リポジトリを指すための指定である（レビュアーは読むだけで、書かない）。
// 作業 ID を渡され、--repo も GORI_WORK_REPO も無いときは、作業 ID のブランチを checkout した別の worktree があれば、それを作業ツリーとする。
// EnterWorktree に入れず cwd が本体のチェックアウトのままでも、pause の sha と branch やレビューする commit が、作業の worktree を指すようにするためである。
const warnedMissing = new Set();
export function resolveRepoDir(flagRepo, task) {
  const explicit = flagRepo ?? process.env.GORI_WORK_REPO;
  const base = resolve(explicit ?? process.cwd());
  const top = git(base, ['rev-parse', '--show-toplevel']) ?? base;
  if (explicit !== undefined || !task || !TASK_ID.test(task)) return top;
  const entries = (git(top, ['worktree', 'list', '--porcelain']) ?? '').split('\n\n').map((e) => e.split('\n'));
  const own = entries.find((e) => e.includes(`branch refs/heads/${task}`));
  const dir = own?.find((l) => l.startsWith('worktree '))?.slice('worktree '.length);
  if (!dir) return top;
  if (existsSync(dir)) return dir;
  if (!warnedMissing.has(dir)) {
    warnedMissing.add(dir);
    console.error(`警告: 作業 ID ${task} のブランチの worktree ${dir} が無い。${top} を作業ツリーとする（git worktree prune で登録を片付けられる）`);
  }
  return top;
}

// 記録（判断の記録、レビュー結果、レビュアーの出力）は、gori のチェックアウトの git の共通ディレクトリの下の gori/repos/<名前>/ に置く（docs/design.md）。
// 名前は作業リポジトリの本体のチェックアウトのディレクトリ名で、プールと同じ決め方を使う（tools/lib/pool.mjs の resolvePool）。
// どの worktree から呼んでも同じ場所になるので、課題の worktree を片付けた後も、作業リポジトリのクローンを消した後も記録が残る。
// gori のチェックアウトは道具の置き場所から決める（環境変数 GORI_ROOT はテスト用の差し替え口）。
// gori が見つからないか repo.yml が食い違えば RecordsError を投げ、道具は何も書かずに 2 で止まる。作業リポジトリの古い置き場所には書かない。
// write が真なら、repo.yml が無いときに作る。書く道（log start、log add、レビュー結果の保存、レビューの出力の保存）だけが真にする。
// commit や作業ツリーの状態を見るときは、これまでどおり resolveRepoDir の作業ツリーを使う。
// git を何度も起動しないよう、作業ツリーごとに結果を覚える。
const toolGori = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export class RecordsError extends Error {}
const FIX = 'クローンのディレクトリ名を変えるか、repo.yml の path を直す';
const goriDirs = new Map();
export function goriDir(repo, { write = false } = {}) {
  const key = `${write}\0${repo}`;
  if (!goriDirs.has(key)) {
    let dir;
    try {
      dir = resolvePool(recordsGori(), repo, undefined, { write, fix: FIX, notRepo: '作業するリポジトリの中で実行するか --repo を渡す' }).dir;
    } catch (e) {
      if (!(e instanceof PoolError)) throw e;
      throw new RecordsError(`記録の場所（gori のチェックアウトの .git/gori/repos/<名前>/）を決められないので、何も書かずに止める: ${e.message}`);
    }
    goriDirs.set(key, dir);
  }
  return goriDirs.get(key);
}

// 記録を置く gori のチェックアウト。見つからなければ RecordsError を投げる。
export function recordsGori() {
  try {
    return goriCheckout(toolGori);
  } catch (e) {
    if (!(e instanceof PoolError)) throw e;
    throw new RecordsError(`記録の場所を決められないので、何も書かずに止める: ${e.message}。gori を clone したチェックアウトの tools/ から道具を呼ぶ`);
  }
}

// git の共通ディレクトリ（絶対パス）。求められなければ null を返す。
export const gitCommonDir = (dir) => git(dir, ['rev-parse', '--path-format=absolute', '--git-common-dir']);

export function auditPath(repo, task, opts) {
  return join(goriDir(repo, opts), 'audit', `${task}.tsv`);
}

export function rowText(type, f, time, session) {
  const cell = (v) => sanitize(v) || '-';
  return [time, session, type, cell(f.step), cell(f.what), cell(f.why), cell(f.evidence), cell(f.result)].join('\t');
}

// 判断の記録への追記は、道具ごとに規則を持たず、ここだけを通す。
export function appendAuditRow(file, type, fields, session) {
  const text = readFileSync(file, 'utf8');
  const rows = parseAudit(text);
  let time = nowIso();
  const last = rows.at(-1)?.row.time;
  if (last && Date.parse(time) < Date.parse(last)) time = last;
  const line = rowText(type, fields, time, session);
  const violations = checkAudit(text + line + '\n');
  if (violations.length) return { violations };
  appendFileSync(file, line + '\n');
  return { violations: [], line: rows.length + 1 };
}

// レビュー結果の行の evidence のレビュー結果のパス。gori/repos/<名前>/verdicts/ のほか、移す前の記録に残る gori/verdicts/ の形もレビュー結果の行と見る。
const VERDICT_EVIDENCE = /gori\/(?:repos\/[^/\s]+\/)?verdicts\//;

// レビュー結果の行はレビュアーのセッションを持つが、レビュアーは作業者ではないので、作業者の集合から除く。
export function workerSessions(text) {
  const out = new Set();
  for (const { row } of parseAudit(text).slice(1)) {
    if (row.session === '-' || row.session === '') continue;
    // 言い換える前の記録は「評決 pass」の形で書かれているので、両方の形をレビュー結果の行と見る。
    if (row.type === 'decision' && /^(レビュー結果|評決) (pass|fail|unverified)$/.test(row.what) && VERDICT_EVIDENCE.test(row.evidence)) continue;
    out.add(row.session);
  }
  return out;
}

// レビュー結果のファイル名。時刻を先に置き、名前の順が記録の順になるようにする。
export function verdictFileName(judge) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('.', '');
  return `${stamp}-${judge.replace(/[^A-Za-z0-9._-]/g, '-')}.json`;
}

// 記録の場所の verdicts/<sha>/ にレビュー結果を置き、done でなければ判断の記録にレビュー結果の decision 行を足す。
// 書くのは、端末の人間の verdict record と、レビュアーの受け取り口を確かめた後の review だけである。
export function storeVerdict(repo, audit, body) {
  const dir = join(goriDir(repo, { write: true }), 'verdicts', body.sha);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, verdictFileName(body.judge));
  writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`, { flag: 'wx' });
  const done = readFileSync(audit, 'utf8').split('\n').some((l) => l.split('\t')[2] === 'done');
  if (done) return { file, violations: [] };
  const session = body.judge.startsWith('session:') ? body.judge.slice('session:'.length) : '-';
  const res = appendAuditRow(audit, 'decision', { what: `レビュー結果 ${body.result}`, why: `レビュアー ${body.judge}${body.weight ? ` 重さ ${body.weight}` : ''}`, evidence: `sha=${body.sha} ${file}` }, session);
  return { file, violations: res.violations };
}

// レビュー結果の result。unverified（確認できず）は、満たしていない基準が無く、確かめる手段の無い基準が残るときの結果である（docs/design.md）。
export const RESULTS = ['pass', 'fail', 'unverified'];

// verdict check の結果の決め方。verdict check と、commit を伴う作業の log add --type done が、この一つの定義を使う。
// code は 0 合格、1 不合格、2 状態不明、3 未レビュー、4 確認できずである。
// 合格した commit に main を取り込んだだけの merge commit は、前の合格を引き継ぐ（docs/design.md の「main の取り込みと合格の引き継ぎ」）。
// 引き継ぐのは、次をすべて満たすときに限る。一つでも外れれば null を返し、呼び出し側は未レビューとして扱う。
// 親が二つで、一つ目の親がこの作業で合格している（引き継いだ合格でもよい）。二つ目の親が main か master に含まれる。
// HEAD の木が git の自動の merge の結果と同じ（衝突を手で解いた、merge commit に変更を足したものは外れる）。
// 作業の変えたファイルと、取り込んだ main の変えたファイルが重ならない（どちらも二つの親の merge-base から数える）。
function carriedState(repo, task, sha, audit) {
  const parents = (git(repo, ['rev-list', '--parents', '-n', '1', sha]) ?? '').split(' ').slice(1);
  if (parents.length !== 2) return null;
  const [mine, theirs] = parents;
  const mainName = ['main', 'master'].find((b) => git(repo, ['rev-parse', '--verify', '-q', `refs/heads/${b}^{commit}`]));
  if (!mainName || spawnSync('git', ['-C', repo, 'merge-base', '--is-ancestor', theirs, `refs/heads/${mainName}`]).status !== 0) return null;
  const merged = spawnSync('git', ['-C', repo, 'merge-tree', '--write-tree', mine, theirs], { encoding: 'utf8' });
  if (merged.status !== 0 || merged.stdout.split('\n')[0] !== git(repo, ['rev-parse', `${sha}^{tree}`])) return null;
  const mb = git(repo, ['merge-base', mine, theirs]);
  if (!mb) return null;
  const names = (to) => new Set((git(repo, ['diff', '--name-only', '--no-renames', mb, to]) ?? '').split('\n').filter(Boolean));
  const ours = names(mine);
  if ([...names(theirs)].some((f) => ours.has(f))) return null;
  const prior = verdictState(repo, task, mine, audit);
  if (prior.code !== 0) return null;
  return {
    code: 0,
    state: '合格',
    reason: `${sha.slice(0, 12)} は合格した ${mine.slice(0, 12)} に ${mainName} の ${theirs.slice(0, 12)} を取り込んだだけの merge で、変えたファイルが重ならないので、前の合格を引き継ぐ（${prior.reason}）`,
    extra: { ...prior.extra, carriedFrom: mine },
  };
}

export function verdictState(repo, task, sha, audit) {
  if (!existsSync(audit)) return { code: 2, state: '不明', reason: `${audit} が無く、作業者を判別できない` };
  const dir = join(goriDir(repo), 'verdicts', sha);
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : [];
  const verdicts = [];
  for (const f of files) {
    try {
      const v = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      if (v.task === task) verdicts.push({ ...v, file: join(dir, f) });
    } catch {
      return { code: 2, state: '不明', reason: `${join(dir, f)} を読めない` };
    }
  }
  const latest = verdicts.at(-1);
  if (!latest) return carriedState(repo, task, sha, audit) ?? { code: 3, state: '未レビュー', reason: `${sha.slice(0, 12)} のレビュー結果が無い（古い commit のレビュー結果は数えない）` };
  const extra = { judge: latest.judge, file: latest.file };
  const m = /^session:(.+)$/.exec(latest.judge);
  if (m && workerSessions(readFileSync(audit, 'utf8')).has(m[1])) return { code: 1, state: '不合格', reason: `最新のレビュー結果のレビュアー ${latest.judge} は作業者である。レビューし直す`, extra };
  if (latest.result === 'pass') {
    // 合格に添えた、直すことを勧める指摘。担当は人間への報告に載せる（criteria/done）。
    const suggestions = Array.isArray(latest.suggestions) ? latest.suggestions : [];
    const tail = suggestions.length ? `。直すことを勧める指摘: ${suggestions.join(' / ')}` : '';
    return { code: 0, state: '合格', reason: `${sha.slice(0, 12)} は ${latest.judge} がレビューで合格とした（${latest.time}）${tail}`, extra: { ...extra, ...(suggestions.length ? { suggestions } : {}) } };
  }
  if (latest.result === 'unverified') return { code: 4, state: '確認できず', reason: `${sha.slice(0, 12)} は ${latest.judge} が確かめる手段の無い基準があるとした。成果を直さず、次の材料を足してレビューを依頼し直す: ${(latest.findings ?? []).join(' / ')}`, extra };
  return { code: 1, state: '不合格', reason: `${sha.slice(0, 12)} は ${latest.judge} がレビューで不合格とした: ${(latest.findings ?? []).join(' / ')}`, extra };
}

export const validTime = (t) => typeof t === 'string' && !Number.isNaN(Date.parse(t));

// 判断の記録の、列数と time が読める行だけから、最初の start と done の時刻と、行を書いたセッションを取る。
export function auditSpan(parsed) {
  let startTime = null;
  let doneTime = null;
  const sessions = new Set();
  for (const { cells, row } of parsed.slice(1)) {
    if (cells.length !== COLUMNS.length || !validTime(row.time)) continue;
    if (row.type === 'start') startTime ??= row.time;
    if (row.type === 'done') doneTime ??= row.time;
    if (row.session && row.session !== '-') sessions.add(row.session);
  }
  return { startTime, doneTime, sessions };
}

// 作業 task の trace が、セッション sid の人間の発言として読む期間（両端を含むミリ秒）を返す。trace が sid を読まなければ null を返す。
// 期間は start から done まで、done の後は同じセッションで次に始まった別の作業の start の 1 ミリ秒前までである。
// 次の作業が無いか done が無ければ、会話の記録の終わりまでとする（実行した時刻より後の時刻の発言も含む）。start が無ければ会話の記録の始めからとする。
// trace と sessions human --outside-tasks がこの一つの定義を使うので、作業の期間の中の発言は --outside-tasks に出ず、外の発言は落ちない。
// ただし、同じセッション ID の会話の記録が projects の下の一か所にだけあることを前提とする。
// done の無い作業の期間は終わりまで続くので、同じセッションで後に始めた作業の trace とは重なる。
export function humanWindow(repo, task, sid) {
  const dir = join(goriDir(repo), 'audit');
  const file = join(dir, `${task}.tsv`);
  if (!existsSync(file)) return null;
  const { startTime, doneTime, sessions } = auditSpan(parseAudit(readFileSync(file, 'utf8')));
  if (!sessions.has(sid)) return null;
  const from = startTime ? Date.parse(startTime) : -Infinity;
  if (!doneTime) return { from, to: Infinity, doneMs: Infinity };
  const doneMs = Date.parse(doneTime);
  let end = Infinity;
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.tsv') && n !== `${task}.tsv`)) {
    for (const { cells, row } of parseAudit(readFileSync(join(dir, name), 'utf8')).slice(1)) {
      if (cells.length !== COLUMNS.length || row.type !== 'start' || row.session !== sid || !validTime(row.time)) continue;
      const t = Date.parse(row.time);
      if (t >= doneMs && t < end) end = t;
    }
  }
  return { from, to: end - 1, doneMs };
}
