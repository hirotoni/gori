// レビューする範囲（base..sha）で消したか名前を変えたファイルの名前が、sha の時点のファイルに残っていないかを探す。
// 消した仕組みの名前がコメントや README に残ったまま判定に出て、レビューが不合格にした事例が続いたため、review がレビュアーを起動する前に走らせる。
// 探す名前は、旧いパス、知識ファイルの参照キー（skills/<id>、procedures/<id> など）、ファイル名の拡張子を除いた部分である。
// ファイル名は、- か _ を含むときだけ探す。log や run のような短い一般の語は、別の意味の一致ばかりになるためである。
// 消した経緯として残す行は、行の中の印 keep-name で外す。
import { spawnSync } from 'node:child_process';
import { basename, dirname, extname } from 'node:path';

export const KEEP_MARK = 'keep-name';
// ファイル名がこれらのときは、置き場所のフォルダの名前をそのファイルの名前とみなす（knowledge/skills/<id>/SKILL.md など）。
const GENERIC = new Set(['SKILL', 'README', 'index']);

const git = (repo, args) => {
  const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : null;
};

// 旧いパスから探す名前を作る。newPath は名前を変えたときの新しいパスで、ファイル名が同じなら移しただけなのでファイル名は探さない。
export function namesOf(oldPath, newPath = null) {
  const names = new Set([oldPath]);
  const stem = (p) => {
    const b = basename(p, extname(p));
    return GENERIC.has(b) ? basename(dirname(p)) : b;
  };
  const k = /^knowledge\/(skills)\/([^/]+)\/SKILL\.md$/.exec(oldPath) ?? /^knowledge\/([^/]+)\/([^/]+)\.md$/.exec(oldPath);
  if (k && k[2] !== 'index') names.add(`${k[1]}/${k[2]}`);
  const s = stem(oldPath);
  if (/[-_]/.test(s) && (!newPath || stem(newPath) !== s)) names.add(s);
  return [...names];
}

// 範囲で消したか名前を変えたファイルの、探す名前の一覧。
function removedNames(repo, base, sha) {
  const out = git(repo, ['diff', '--name-status', '-M', base, sha]) ?? '';
  const names = [];
  for (const line of out.split('\n').filter(Boolean)) {
    const [st, from, to] = line.split('\t');
    if (st === 'D') names.push(...namesOf(from).map((name) => ({ name, from })));
    else if (st.startsWith('R')) names.push(...namesOf(from, to).map((name) => ({ name, from })));
  }
  return names;
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// sha の時点のファイルで、名前が語として現れ、印の無い行を返す。名前の前後に英数字、-、_ が続く一致は、別の名前の一部なので数えない。
// 一つの行は一件にまとめ、names にその行に残った消したファイルごとの名前を並べる。同じファイルの名前（パス、参照キー、ファイル名）は、最初に当たった一つだけを示す。
export function staleNames(repo, base, sha) {
  const byLine = new Map();
  for (const { name, from } of removedNames(repo, base, sha)) {
    const out = git(repo, ['grep', '-n', '-I', '-F', '-e', name, sha]) ?? '';
    const re = new RegExp(`(?<![A-Za-z0-9_-])${escape(name)}(?![A-Za-z0-9_-])`);
    for (const l of out.split('\n').filter(Boolean)) {
      const m = /^[^:]+:(.+?):(\d+):(.*)$/.exec(l);
      if (!m) continue;
      const [, file, lineNo, text] = m;
      if (!re.test(text) || text.includes(KEEP_MARK)) continue;
      const key = `${file}:${lineNo}`;
      if (!byLine.has(key)) byLine.set(key, { file, line: Number(lineNo), text: text.trim(), names: [] });
      const hit = byLine.get(key);
      if (!hit.names.some((n) => n.from === from)) hit.names.push({ name, from });
    }
  }
  return [...byLine.values()];
}
