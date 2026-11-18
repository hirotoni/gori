#!/usr/bin/env bash
# モデルを呼ぶので tests/run.sh には入れない。手動か review --e2e で実行する。
# EnterWorktree が拒否される条件で feature の作業を走らせ、止まらずに作業 ID の worktree を指して続けることを確かめる。
# 確かめること: 本体のチェックアウトの git status と HEAD が作業の前後で変わらない。Edit と Write が worktree の下だけを指す。
# pause 行の sha と branch が、作業の worktree の HEAD とブランチになる。
# EnterWorktree は allowedTools に入れず、--permission-mode dontAsk で走らせる。許可を求めずに拒否するので、呼ぶと必ず拒否される。
# cd を使わせないのは、Bash の cwd が worktree に移ると、記録の道具が作業 ID の worktree を自分で探す経路を通らずに pause の検査が通ってしまうためである。
# プロンプトでシェル変数を使わないよう伝えるのは、変数を含む Bash のコマンドも許可を求める扱いになり拒否されるためである。
# acceptEdits だと、許可を求める呼び出しが PermissionRequest の hook（端末の多重化ツールなど）に回され、答えが来るまで止まることがある。
# プロンプトで拒否されることを予告しない。予告すると、モデルが EnterWorktree を呼ばずに進むことがある。
# ただし、cd を使わず git -C を使うよう伝えると、入る必要が無いと見て EnterWorktree を省くことがあったので、呼ぶこと自体はプロンプトで求める。
# 確かめたいのは拒否された後の振る舞いであり、モデルが EnterWorktree を呼ぶかではないためである。
# EnterWorktree は deferred tool で、ToolSearch でスキーマを読んでから呼ぶので、ToolSearch は許す。
# 「EnterWorktree を呼び、すべて拒否された」が FAIL で呼び出しが 0 回なら、モデルが手順 2 で EnterWorktree を呼ばず、確かめたい場面に届かなかった。
# 使い方: tests/e2e/enterworktree-denied.sh
set -u
gori="$(cd "$(dirname "$0")/../.." && pwd)"
out="${E2E_OUT:-$(mktemp -d "${TMPDIR:-/tmp}/gori-e2e-denied.XXXXXX")}"
dir="$out/repo"
mkdir -p "$dir" && cd "$dir" || exit 1
# pre-commit などから GIT_DIR や GIT_INDEX_FILE を引き継ぐと、一時リポジトリでなく gori 本体の .git を操作するので消す（tests/run.sh と同じ）。
while IFS='=' read -r name _; do
  case "$name" in GIT_*) unset "$name" ;; esac
done <<EOF_ENV
$(env)
EOF_ENV
# 呼び出し元のセッションやレビュアーの指定を引き継ぐと、記録が別の場所を指す。
unset CLAUDE_CODE_SESSION_ID CLAUDE_SESSION_ID GORI_WORK_REPO GORI_VERDICT_OUTBOX GORI_REVIEWING
# 記録は gori のチェックアウトの .git/gori/repos/<名前>/ に置く。一時の gori を GORI_ROOT で渡し、本物の gori の記録に書かない。
# shellcheck source=../lib/fake-gori.sh
. "$gori/tests/lib/fake-gori.sh"
use_fake_gori "$out/gori" || exit 1
git -c init.defaultBranch=main init -q
git config user.name e2e
git config user.email e2e@example.invalid
printf '#!/bin/sh\necho "Hello, world"\n' > greet.sh && chmod +x greet.sh
git add -A && git commit -q -m init
head0="$(git rev-parse HEAD)"
status0="$(git status --porcelain --untracked-files=all)"

allowed="Read,Glob,Grep,Skill,ToolSearch,Edit,Write,Bash(git:*),Bash($gori/tools/records/log:*),Bash($gori/tools/repo/worktree:*),Bash(cat:*),Bash(ls:*),Bash(head:*),Bash(tail:*),Bash(sh:*),Bash(./greet.sh:*)"
prompt="次の要望を、gori の procedures/feature の手順で実装して。
要望: greet.sh に引数を渡せるようにする。
受け入れ条件: greet.sh は、引数があれば Hello, <引数> を、無ければ Hello, world を標準出力に出す。
手順 2 では、worktree を作ったら EnterWorktree ツールで入ろうとする（省かない）。
手順 3 で受け入れ条件を確かめて commit したら、手順 4 のレビューには進まず、gori の pause の能力で中断して終える。
Bash のコマンドではシェル変数を使わない（変数を含むコマンドは確かめられずに拒否される）。gori の道具は絶対パスで、git、sh、cat、ls は /usr/bin などを付けずにコマンド名のまま書く。cd は使わず、git は git -C で worktree を指す。"
echo "出力: $out"
claude --plugin-dir "$gori" -p --model sonnet --strict-mcp-config --output-format stream-json --verbose \
  --permission-mode dontAsk --allowedTools "$allowed" \
  -- "$prompt" > "$out/stream.jsonl" 2> "$out/stream.err"

# 作業 ID はモデルの log start で道具が発行するので、一時の gori の記録の audit から拾う（pause-resume.sh と同じ）。
audits="$(ls "$(gori_records "$GORI_ROOT" "$(basename "$dir")")"/audit/*.tsv 2>/dev/null)"
count="$(printf '%s' "$audits" | grep -c .)"
if [ "$count" -eq 0 ]; then
  echo "FAIL 判断の記録が一つだけある: 判断の記録が無く、作業 ID が見つからない"
  echo "出力: $out"
  exit 1
elif [ "$count" -gt 1 ]; then
  echo "FAIL 判断の記録が一つだけある: ${count} 件あり、どれを検査するか決まらない"
  printf '%s\n' "$audits"
  echo "出力: $out"
  exit 1
fi
task="$(basename "$audits" .tsv)"
echo "ok   判断の記録が一つだけある（作業 ID: ${task}）"

GORI="$gori" FAKE_GORI="$GORI_ROOT" OUT="$out" DIR="$dir" HEAD0="$head0" STATUS0="$status0" TASK="$task" node --input-type=module <<'JS'
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, join, relative, isAbsolute } from 'node:path';
const { GORI, OUT, DIR, HEAD0, STATUS0, TASK } = process.env;
const evs = readFileSync(join(OUT, 'stream.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const uses = evs.filter((e) => e.type === 'assistant').flatMap((e) => e.message?.content ?? []).filter((b) => b.type === 'tool_use');
const toolResults = evs.filter((e) => e.type === 'user').flatMap((e) => (Array.isArray(e.message?.content) ? e.message.content : [])).filter((b) => b.type === 'tool_result');
const result = evs.filter((e) => e.type === 'result').pop();
const git = (d, ...a) => (spawnSync('git', ['-C', d, ...a], { encoding: 'utf8' }).stdout ?? '').trim();

// 作業 ID のブランチを checkout した worktree を、本体の git worktree list から探す。
const entries = git(DIR, 'worktree', 'list', '--porcelain').split('\n\n').map((e) => e.split('\n'));
const own = entries.find((e) => e.includes(`branch refs/heads/${TASK}`));
const wt = own?.find((l) => l.startsWith('worktree '))?.slice('worktree '.length);
// まだ無いファイルは親ディレクトリを解決する。macOS の /tmp と /private/tmp のような symlink の違いで外と誤らないためである。
const real = (p) => { try { return realpathSync(p); } catch { return p === dirname(p) ? p : join(real(dirname(p)), basename(p)); } };
const under = (p, root) => { if (!p || !root || !isAbsolute(p)) return false; const r = relative(real(root), real(p)); return r !== '' && !r.startsWith('..') && !isAbsolute(r); };

const enters = uses.filter((u) => u.name === 'EnterWorktree');
// 許可の拒否だけを数える。パスの誤りなど、ほかのエラーで失敗した呼び出しは拒否の経路を通っていない。
const denied = enters.filter((u) => (result?.permission_denials ?? []).some((d) => d.tool_name === 'EnterWorktree' && d.tool_use_id === u.id)
  || toolResults.some((r) => r.tool_use_id === u.id && r.is_error && /Permission to use EnterWorktree has been denied/.test(JSON.stringify(r.content))));
// Bash のコマンドから引用符の中身を除き、文に分けて見る。--what の文字列に --repo や cd と書いてあるだけの呼び出しを、指定と数えない。
const unquote = (c) => c.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '""');
const statements = uses.filter((u) => u.name === 'Bash').flatMap((u) => unquote(u.input?.command ?? '').split(/;|&&|\|\||\n/).map((st) => st.trim()));
// 記録の道具に --repo や GORI_WORK_REPO を渡すか、cwd を worktree に移すと、道具が作業 ID の worktree を自分で指す経路を通らない。
const logCalls = statements.filter((st) => /(^|\s|\/)tools\/records\/log(\s|$)/.test(st));
// GORI_WORK_REPO は、log の呼び出しの前に置いたものも、export や env で別の文に置いたものも数える。
const explicitRepo = statements.filter((st) => /(^|\s)GORI_WORK_REPO=/.test(st)).concat(logCalls.filter((st) => /\s--repo(=|\s|$)/.test(st)));
// サブシェルや sh -c、eval の中は引用符を除くと見えないので、cwd を変えうる書き方として cd と同じに数える。
const cds = statements.filter((st) => /^\(?\s*(cd|pushd)(\s|$)|^(sh|bash|zsh)\s+(-\S*\s+)*-c(\s|$)|^eval(\s|$)/.test(st));
const edits = uses.filter((u) => u.name === 'Edit' || u.name === 'Write');
const outside = edits.filter((u) => !under(u.input?.file_path, wt));

const file = join(process.env.FAKE_GORI, '.git', 'gori', 'repos', basename(DIR), 'audit', `${TASK}.tsv`);
const rows = existsSync(file) ? readFileSync(file, 'utf8').trimEnd().split('\n').slice(1).map((l) => l.split('\t')) : [];
const pause = rows.findLast((r) => r[2] === 'pause');
// log が evidence の末尾に足す sha= branch= を読む（書式は tools/records/log の pause の処理に合わせる）。モデルが自分の evidence に sha= と書いても取り違えないよう、最後の組を使う。
const head = [...(pause?.[6] ?? '').matchAll(/(?:^| )sha=(\S+) branch=(\S+)/g)].pop();
const [pSha, pBranch] = [head?.[1], head?.[2]];
const wtHead = wt ? git(wt, 'rev-parse', 'HEAD') : '';
const wtBranch = wt ? git(wt, 'rev-parse', '--abbrev-ref', 'HEAD') : '';
const chk = spawnSync(join(GORI, 'tools/records/log'), ['check', file], { cwd: DIR, encoding: 'utf8' });
// git status が失敗して空を返すと、作業前の空の status と一致して誤って通るので、失敗は別の値にする。
const st = spawnSync('git', ['-C', DIR, 'status', '--porcelain', '--untracked-files=all'], { encoding: 'utf8' });
// シェルの $(...) と同じく末尾の改行だけを除く。
const statusNow = st.status === 0 ? st.stdout.replace(/\n+$/, '') : `(git status が失敗した: ${st.stderr})`;

const checks = [
  ['セッションが結果を返した', result && !result.is_error, JSON.stringify(result?.result ?? '').slice(0, 300)],
  // 一度でも入れたら cwd が worktree に移り、確かめたい場面が崩れるので、すべての呼び出しが拒否されたことを求める。
  ['EnterWorktree を呼び、すべて拒否された', enters.length > 0 && denied.length === enters.length, `呼び出し ${enters.length} 回、拒否 ${denied.length} 件`],
  ['本体のチェックアウトの git status が作業の前後で変わらない', statusNow === STATUS0, `前=${JSON.stringify(STATUS0)} 後=${JSON.stringify(statusNow)}`],
  ['本体のチェックアウトの HEAD とブランチが変わらない', git(DIR, 'rev-parse', 'HEAD') === HEAD0 && git(DIR, 'rev-parse', '--abbrev-ref', 'HEAD') === 'main', git(DIR, 'log', '--oneline', '-3')],
  ['作業 ID のブランチの worktree がある', !!wt && existsSync(wt), git(DIR, 'worktree', 'list')],
  ['worktree のブランチに作業の commit がある', !!wtHead && wtHead !== HEAD0 && spawnSync('git', ['-C', wt, 'merge-base', '--is-ancestor', HEAD0, 'HEAD']).status === 0, wt ? git(wt, 'log', '--oneline', '-3') : '(worktree 無し)'],
  ['Edit と Write を一度以上呼び、すべて worktree の下を指す', edits.length > 0 && outside.length === 0, `${edits.length} 回中、外: ${outside.map((u) => u.input?.file_path).join(', ')}`],
  ['記録の道具に --repo も GORI_WORK_REPO も渡さない', logCalls.length > 0 && explicitRepo.length === 0, `log の呼び出し ${logCalls.length} 回、指定あり: ${explicitRepo.map((st) => st.slice(0, 200)).join(' / ')}`],
  ['Bash で cd、サブシェル、sh -c、eval を使わない（記録の道具の cwd が本体のチェックアウトのまま）', cds.length === 0, cds.join(' / ')],
  ['log check が通る', chk.status === 0, chk.stdout + chk.stderr],
  // プロンプトは commit の直後に中断させるので、pause の後に commit は無く、pause の sha は worktree の最後の HEAD と同じになる。
  ['pause 行の sha が worktree の HEAD', !!pSha && pSha === wtHead, `記録=${pSha} worktree=${wtHead}`],
  ['pause 行の branch が worktree のブランチ', !!pBranch && pBranch === wtBranch && wtBranch === TASK, `記録=${pBranch} worktree=${wtBranch}`],
];
console.log(`道具の呼び出し: ${uses.map((u) => u.name).join(' / ')}`);
console.log(`worktree: ${wt ?? '(無し)'}`);
console.log(`pause 行: ${pause?.join(' | ') ?? '(無し)'}`);
console.log(`最後の応答:\n${result?.result ?? '(無し)'}`);
let ok = true;
for (const [label, pass, detail] of checks) {
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${label}${pass ? '' : `: ${detail}`}`);
  ok &&= !!pass;
}
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
JS
status=$?
echo "出力: $out"
exit $status
