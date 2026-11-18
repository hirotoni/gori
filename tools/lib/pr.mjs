import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// GitHub の PR のレビューを扱う道具（tools/pr/）の共有部品。
// GitHub への呼び出しは gh api に任せ、トークンには触らない（認証は人間の gh auth login）。
// レビューを作る口は pending review だけにする。event を送る口、submit、削除の口は作らない。submit は人間が行う。

export class PrError extends Error {
  constructor(message, code = 2) {
    super(message);
    this.code = code;
  }
}

export function runMain(fn) {
  try {
    process.exit(fn() ?? 0);
  } catch (e) {
    if (!(e instanceof PrError)) throw e;
    console.error(e.message);
    process.exit(e.code);
  }
}

// PR の URL（https://github.com/<owner>/<repo>/pull/<n>）か番号を受け取る。
// 番号なら {owner}/{repo} を gh がカレントのリポジトリ（または GH_REPO）から埋める。
export function prTarget(arg) {
  if (!arg) throw new PrError('PR の番号か URL（https://github.com/<owner>/<repo>/pull/<番号>）を渡す');
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:[/?#].*)?$/.exec(arg);
  if (m) return { base: `repos/${m[1]}/${m[2]}/pulls/${m[3]}`, repo: `repos/${m[1]}/${m[2]}`, number: Number(m[3]) };
  if (/^\d+$/.test(arg)) return { base: `repos/{owner}/{repo}/pulls/${arg}`, repo: 'repos/{owner}/{repo}', number: Number(arg) };
  throw new PrError(`PR の番号か URL ではない: ${arg}`);
}

// gh api を一回呼ぶ。paginate なら --paginate --slurp で、ページの配列を返す。
export function ghApi(endpoint, { method = 'GET', body = null, paginate = false } = {}) {
  const args = ['api', '--method', method];
  if (paginate) args.push('--paginate', '--slurp');
  if (body !== null) args.push('--input', '-');
  args.push(endpoint);
  const r = spawnSync('gh', args, {
    encoding: 'utf8',
    input: body === null ? undefined : JSON.stringify(body),
    maxBuffer: 256 * 1024 * 1024,
  });
  if (r.error) {
    if (r.error.code === 'ENOENT') throw new PrError('gh が見つからない。GitHub CLI を入れて gh auth login する');
    throw new PrError(`gh を起動できない: ${r.error.message}`);
  }
  // gh api の HTTP エラー時の終了コードはマニュアルに無いので、0 以外はすべて失敗とし、応答も JSON であることを確かめる。
  if (r.status !== 0) throw new PrError(`gh api ${method} ${endpoint} が失敗した（終了コード ${r.status}）: ${(r.stderr || r.stdout).trim()}`);
  try {
    return JSON.parse(r.stdout);
  } catch {
    throw new PrError(`gh api ${method} ${endpoint} の応答が JSON でない`);
  }
}

export function readDrafts(path) {
  if (!path) throw new PrError('drafts.json のパスを渡す');
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new PrError(`${path} を JSON として読めない: ${e.message}`);
  }
}

const list = (endpoint) => ghApi(endpoint, { paginate: true }).flat();

// check と pending が要るもの。
export function fetchReviewState(target) {
  const pr = ghApi(target.base);
  return {
    pr,
    files: list(`${target.base}/files?per_page=100`),
    reviews: list(`${target.base}/reviews?per_page=100`),
    reviewComments: list(`${target.base}/comments?per_page=100`),
    me: ghApi('user').login,
  };
}

// collect がまとめるもの。
export function collect(target) {
  const { pr, files, reviews, reviewComments } = fetchReviewState(target);
  const issueComments = list(`${target.repo}/issues/${target.number}/comments?per_page=100`);
  const checkRuns = ghApi(`${target.repo}/commits/${pr.head.sha}/check-runs?per_page=100`, { paginate: true }).flatMap((p) => p.check_runs ?? []);
  const who = (u) => u?.login ?? null;
  return {
    pr: {
      number: pr.number,
      url: pr.html_url,
      title: pr.title,
      body: pr.body,
      author: who(pr.user),
      base: pr.base?.ref,
      head: pr.head?.ref,
      headSha: pr.head?.sha,
    },
    files: files.map((f) => ({ path: f.filename, status: f.status, additions: f.additions, deletions: f.deletions, patch: f.patch ?? null })),
    reviews: reviews.map((r) => ({ id: r.id, author: who(r.user), state: r.state, body: r.body })),
    reviewComments: reviewComments.map((c) => ({ id: c.id, author: who(c.user), path: c.path, line: c.line, side: c.side, startLine: c.start_line ?? null, body: c.body, url: c.html_url })),
    issueComments: issueComments.map((c) => ({ id: c.id, author: who(c.user), body: c.body, url: c.html_url })),
    checkRuns: checkRuns.map((c) => ({ name: c.name, status: c.status, conclusion: c.conclusion })),
  };
}

// patch の hunk ごとに、コメントを付けられる行を side ごとに返す。
// RIGHT は新しい側の行（追加と文脈）、LEFT は古い側の行（削除と文脈）である。
export function commentableLines(patch) {
  const lines = patch.split('\n');
  if (lines.at(-1) === '') lines.pop();
  const hunks = [];
  let cur = null;
  let oldLn = 0;
  let newLn = 0;
  for (const line of lines) {
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (h) {
      oldLn = Number(h[1]);
      newLn = Number(h[2]);
      cur = { LEFT: new Set(), RIGHT: new Set() };
      hunks.push(cur);
      continue;
    }
    if (!cur || line.startsWith('\\')) continue;
    if (line.startsWith('+')) cur.RIGHT.add(newLn++);
    else if (line.startsWith('-')) cur.LEFT.add(oldLn++);
    else {
      cur.RIGHT.add(newLn++);
      cur.LEFT.add(oldLn++);
    }
  }
  return hunks;
}

const SIDES = new Set(['LEFT', 'RIGHT']);
const DRAFT_KEYS = new Set(['body', 'comments']);
const COMMENT_KEYS = new Set(['path', 'line', 'side', 'start_line', 'start_side', 'body']);

// 指摘の下書き（drafts）を検査し、違反を一件一行の文の配列で返す。空なら合格。
// drafts の形: { "body"?: string, "comments": [{ "path", "line", "side", "start_line"?, "start_side"?, "body" }] }
export function checkDrafts(drafts, { files, reviews, reviewComments, me }) {
  const problems = [];
  const ng = (where, reason) => problems.push(`${where}: ${reason}`);
  if (drafts === null || typeof drafts !== 'object' || Array.isArray(drafts)) {
    ng('drafts', 'JSON のオブジェクトでない');
    return problems;
  }
  for (const k of Object.keys(drafts)) {
    if (k === 'event') ng('event', 'event は渡せない。submit は人間が GitHub で行う');
    else if (!DRAFT_KEYS.has(k)) ng(k, '知らない項目');
  }
  if (drafts.body !== undefined && typeof drafts.body !== 'string') ng('body', '文字列でない');
  if (!Array.isArray(drafts.comments) || drafts.comments.length === 0) {
    ng('comments', '一件以上の配列でない');
    return problems;
  }
  const byPath = new Map(files.map((f) => [f.filename, f]));
  drafts.comments.forEach((c, i) => {
    const w = `comments[${i}]`;
    if (c === null || typeof c !== 'object' || Array.isArray(c)) return ng(w, 'オブジェクトでない');
    for (const k of Object.keys(c)) if (!COMMENT_KEYS.has(k)) ng(w, `知らない項目 ${k}`);
    if (typeof c.body !== 'string' || !c.body.trim()) ng(w, 'body が空');
    if (!SIDES.has(c.side)) ng(w, 'side は LEFT か RIGHT');
    if (!Number.isInteger(c.line) || c.line < 1) ng(w, 'line は 1 以上の整数');
    const startSide = c.start_side ?? c.side;
    if (c.start_side !== undefined && c.start_line === undefined) ng(w, 'start_side は start_line と一緒に渡す');
    if (c.start_line !== undefined) {
      if (!Number.isInteger(c.start_line) || c.start_line < 1 || !(c.start_line < c.line)) ng(w, 'start_line は line より小さい 1 以上の整数');
      if (!SIDES.has(startSide)) ng(w, 'start_side は LEFT か RIGHT');
    }
    const f = byPath.get(c.path);
    if (!f) return ng(w, `path ${c.path} はこの PR の変更ファイルに無い`);
    if (typeof f.patch !== 'string') return ng(w, `${c.path} の patch が無い（大きな差分か binary）。行を指してコメントできない`);
    if (!Number.isInteger(c.line) || !SIDES.has(c.side)) return;
    const hunk = commentableLines(f.patch).find((h) => h[c.side].has(c.line));
    if (!hunk) return ng(w, `${c.path}:${c.line}（${c.side}）は差分の hunk の範囲外`);
    if (Number.isInteger(c.start_line) && SIDES.has(startSide) && !hunk[startSide].has(c.start_line)) {
      ng(w, `start_line ${c.start_line}（${startSide}）が line と同じ hunk に無い`);
    }
    const dup = reviewComments.find((rc) => rc.path === c.path && rc.line === c.line && rc.side === c.side);
    if (dup) ng(w, `既存のコメント（${dup.user?.login ?? '?'}、${dup.html_url ?? dup.id}）と同じ位置。重なる指摘でないか確かめ、まとめるか位置を変える`);
  });
  for (const r of reviews.filter((r) => r.state === 'PENDING' && r.user?.login === me)) {
    ng('review', `自分の PENDING のレビュー（id ${r.id}）が既にある。GitHub で submit するか消してから作り直す`);
  }
  return problems;
}

// pending review に送る本文。event は入れない（PENDING のまま残る）。
export function pendingPayload(drafts, headSha) {
  const comments = drafts.comments.map((c) => {
    const o = { path: c.path, line: c.line, side: c.side, body: c.body };
    if (c.start_line !== undefined) {
      o.start_line = c.start_line;
      o.start_side = c.start_side ?? c.side;
    }
    return o;
  });
  const payload = { commit_id: headSha, comments };
  if (drafts.body) payload.body = drafts.body;
  return payload;
}

// 送った指摘と、作られたレビューから取り直したコメントが一致するかを確かめ、食い違いを返す。
export function compareComments(sent, got) {
  const key = (c) => [c.path, c.line, c.side, c.start_line ?? '', (c.body ?? '').replace(/\r\n/g, '\n').trim()].join('\u0000');
  const count = (arr) => arr.reduce((m, c) => m.set(key(c), (m.get(key(c)) ?? 0) + 1), new Map());
  const a = count(sent);
  const b = count(got);
  const diffs = [];
  for (const [k, n] of a) if ((b.get(k) ?? 0) !== n) diffs.push(`送った指摘が ${n} 件に対し、レビューには ${b.get(k) ?? 0} 件: ${k.split('\u0000').slice(0, 3).join(':')}`);
  for (const [k, n] of b) if (!a.has(k)) diffs.push(`送っていないコメントが ${n} 件ある: ${k.split('\u0000').slice(0, 3).join(':')}`);
  return diffs;
}
