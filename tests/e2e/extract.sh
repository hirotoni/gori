#!/usr/bin/env bash
# モデルを呼ぶので tests/run.sh には入れない。手動で実行する。
# gori の写しを一時ディレクトリに作り、合成の会話の記録六つから本物の抽出を走らせる。
# 一つ目は同じ種類の訂正が二か所、二つ目は別の種類の訂正が一か所と、エージェントが示した案から人間が選んだだけの発言と、提案を承認しただけの発言がある。
# 三つ目は、依頼どおりの振る舞いと、承認なしに進めない既定の振る舞いの後に、人間が新しい依頼を出しただけの会話である。
# 四つ目は、commit という同じ話題で、防ぐ規則の違う二つの訂正がある。
# 五つ目は、一つ目と同じ形の訂正を持つが、SessionEnd フックが抽出待ちに積まなかった会話（gori を読み込んでいない会話など）である。
# 六つ目は、同じ種類の誤りが三回起き、人間が一つの発言でまとめて指摘した会話である。
# 一つ目から事例が二件、二つ目から訂正の一件だけ、三つ目と五つ目からは無し、四つ目から別の pattern の二件、六つ目から一件が書かれ、学びが一件だけ proposed で写しのプールに起票されることを確かめる。
# 六つ目の事例は本文に出来事が三つあっても一件と数えられ、起票されない。六つ目が確かめるのは、一つの発言から事例が一件だけ書かれることである。
# 件数が 2 に満たない pattern を起票しない判定（case count --min）の回帰は、tests/learning/case.test.mjs が終了コードで確かめる。
# 五つ目以外は抽出待ちに積んでおき、抽出の後に抽出待ちから消えていることを確かめる。
# もう一度走らせて、事例も起票も増えないことを確かめる。判定は学び（.git/gori/learning/）のファイルと写しのプール（tools/records/pool の出力）から行う。
# 使い方: tests/e2e/extract.sh
set -u
while IFS='=' read -r name _; do
  case "$name" in GIT_*) unset "$name" ;; esac
done <<EOF_ENV
$(env)
EOF_ENV
# 写しの gori が、抽出の書き込み先であり、記録とプールを置く gori のチェックアウトでもある。GORI_ROOT を引き継ぐと別の gori を指すので消す。
unset CLAUDE_CODE_SESSION_ID CLAUDE_SESSION_ID GORI_WORK_REPO GORI_PROJECTS_DIR GORI_ROOT

src="$(cd "$(dirname "$0")/../.." && pwd)"
out="${E2E_OUT:-$(mktemp -d "${TMPDIR:-/tmp}/gori-e2e-extract.XXXXXX")}"
gori="$out/gori"
projects="$out/projects"
work="$out/work"
mkdir -p "$gori" "$projects/-e2e-work" "$work"
echo "出力: $out"

# gori の写し。追跡中と未追跡のファイルを写す。学び（.git/gori/learning/）とプール（.git/gori/repos/）は git init した写しの .git の下なので空から始まる。
(cd "$src" && git ls-files -co --exclude-standard -z) | (cd "$src" && xargs -0 tar cf -) | (cd "$gori" && tar xf -)
git -C "$gori" init -q -b main
git -C "$gori" config user.name e2e
git -C "$gori" config user.email e2e@example.invalid
git -C "$gori" add -A && git -C "$gori" commit -q -m init

S1=6a1e0c1e-0000-4000-8000-000000000001
S2=6a1e0c1e-0000-4000-8000-000000000002
S3=6a1e0c1e-0000-4000-8000-000000000003
S4=6a1e0c1e-0000-4000-8000-000000000004
S5=6a1e0c1e-0000-4000-8000-000000000005
S6=6a1e0c1e-0000-4000-8000-000000000006
WORK="$work" PROJ="$projects/-e2e-work" S1=$S1 S2=$S2 S3=$S3 S4=$S4 S5=$S5 S6=$S6 node --input-type=module <<'JS'
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
const { WORK, PROJ, S1, S2, S3, S4, S5, S6 } = process.env;
const lines = (sid, msgs) => {
  let t = Date.parse('2026-11-02T01:00:00Z');
  let parent = null;
  return msgs.map(([role, text], i) => {
    const uuid = `${sid.slice(0, 8)}-0000-4000-8000-${String(i + 1).padStart(12, '0')}`;
    t += 60_000;
    const base = { parentUuid: parent, isSidechain: false, cwd: WORK, sessionId: sid, uuid, timestamp: new Date(t).toISOString() };
    parent = uuid;
    return JSON.stringify(role === 'user'
      ? { ...base, type: 'user', message: { role: 'user', content: text } }
      : { ...base, type: 'assistant', message: { role: 'assistant', model: 'claude', content: [{ type: 'text', text }] } });
  }).join('\n') + '\n';
};
writeFileSync(join(PROJ, `${S1}.jsonl`), lines(S1, [
  ['user', 'README に使い方の節を足して'],
  ['assistant', 'README に使い方の節を足しました。完了です。'],
  ['user', '確かめずに完了と言わないで。リンクが切れていないか実際に開いて確かめてから報告して'],
  ['assistant', 'リンクを開いて確かめました。切れていませんでした。'],
  ['user', '次は CHANGELOG に今回の変更を書いて'],
  ['assistant', 'CHANGELOG を更新しました。完了です。'],
  ['user', 'また確かめずに完了と言っている。差分を見て日付が正しいか確かめてから完了と言って'],
  ['assistant', '差分を確かめました。日付は正しいです。'],
]));
writeFileSync(join(PROJ, `${S2}.jsonl`), lines(S2, [
  ['user', '設定ファイルを読み込む処理を新しいファイルに分けて'],
  ['assistant', '新しいファイルの関数の主語を二案考えました。A) 呼び出し側を主語にし、呼び出し側が開いたファイルを渡す（推奨）。B) 読み込みの関数を主語にし、関数がパスを受け取って自分で開く。どちらにしますか'],
  ['user', '主語は関数に'],
  ['assistant', 'config_loader.py を作り、パスを受け取って自分で開く関数に処理を移しました。'],
  ['user', 'このリポジトリのファイル名は kebab-case の決まりなので、config-loader.py という名前にして'],
  ['assistant', 'config-loader.py に名前を変えました。読み込みの処理が三層に分かれていて複雑なので、一つの関数にまとめる簡素化を提案します。進めてよいですか'],
  ['user', '簡素化を進めて良い'],
  ['assistant', '一つの関数にまとめました。'],
  ['user', 'ありがとう、それでいい'],
]));
writeFileSync(join(PROJ, `${S3}.jsonl`), lines(S3, [
  ['user', 'acme-cli の機能ごとの要件を抜き出して requirements.md に書いて'],
  ['assistant', 'acme-cli の機能ごとの要件を、機能の名前を見出しにして requirements.md に書きました。'],
  ['user', '次は、それを特定の道具に依らない形に一段抽象化して、別の文書 harness-requirements.md に書いて'],
  ['assistant', 'requirements.md は残し、道具の名前を使わない要件として harness-requirements.md を新しく書きました。'],
  ['user', 'コミットしといて'],
  ['assistant', '私が書いた harness-requirements.md だけをコミットしました。作業ツリーには README.md と Makefile の変更も残っていますが、私の変更ではないので含めていません。'],
  ['user', '残りの変更もまとめてコミットして'],
  ['assistant', 'README.md と Makefile の変更もコミットしました。'],
  ['user', 'ありがとう'],
]));
writeFileSync(join(PROJ, `${S4}.jsonl`), lines(S4, [
  ['user', 'ビルドの設定を直してコミットして'],
  ['assistant', 'build.config.js を直し、ビルドして出来た dist/ も含めてコミットしました。'],
  ['user', 'dist/ はビルドの生成物なので、コミットに含めないで外して'],
  ['assistant', 'dist/ をコミットから外しました。続けて、前のコミットに git commit --amend でまとめ、git push --force で push し直しました。'],
  ['user', 'push 済みのコミットを amend して force push しないで。他の人が取り込んでいるので、書き換えずに新しいコミットを積んで'],
  ['assistant', '以後は push 済みのコミットを書き換えず、新しいコミットを積みます。'],
]));
writeFileSync(join(PROJ, `${S5}.jsonl`), lines(S5, [
  ['user', 'LICENSE の年を直して'],
  ['assistant', 'LICENSE の年を直しました。完了です。'],
  ['user', '確かめずに完了と言わないで。差分を見て年が正しいか確かめてから報告して'],
  ['assistant', '差分を確かめました。年は正しいです。'],
]));
writeFileSync(join(PROJ, `${S6}.jsonl`), lines(S6, [
  ['user', 'config の a.yml、b.yml、c.yml の timeout を 30 にして'],
  ['assistant', '三つのファイルの中身を読まずに、それぞれの末尾に timeout: 30 の行を足しました。'],
  ['user', 'a.yml にも b.yml にも c.yml にも timeout の行が二つになっている。三つとも既にある行を読まずに足している。書き換える前にファイルを読んで、既にある行を直して'],
  ['assistant', '三つのファイルを読み、既にある timeout の行を 30 に直して、足した行を消しました。'],
  ['user', 'ありがとう'],
]));
JS
# SessionEnd フックが積むのと同じ形で、五つ目以外を抽出待ちに積む（tools/lib/learning.mjs の enqueue）。
mkdir -p "$gori/.git/gori/learning/pending"
for sid in $S1 $S2 $S3 $S4 $S6; do echo "$projects/-e2e-work/$sid.jsonl" > "$gori/.git/gori/learning/pending/$sid"; done

settings='{"enabledPlugins":{"gori@gori":false}}'
# 待ち合わせが残ってプロセスが終わらないことがあるので、E2E_TIMEOUT 秒（既定 900）で止めて失敗にする。
limit="${E2E_TIMEOUT:-900}"
run_extract() {
  local n=$1 t0=$SECONDS pid watchdog code
  (cd "$gori" && GORI_EXTRACTING=1 GORI_HOME="$out/home" GORI_PROJECTS_DIR="$projects" exec claude -p '/gori:extract' \
    --plugin-dir "$gori" --settings "$settings" \
    --allowedTools 'Bash,Read,Grep,Glob,Agent,Task,Skill,Write' \
    --output-format stream-json --verbose > "$out/run$n.jsonl" 2> "$out/run$n.err") &
  pid=$!
  # 見張りの標準出力を閉じておく。止めた見張りの sleep が残っても、このスクリプトの出力を読む側を待たせないためである。
  (sleep "$limit" && kill "$pid" 2> /dev/null && echo "timeout: ${limit} 秒で止めた" >> "$out/run$n.err") > /dev/null 2>&1 &
  watchdog=$!
  wait "$pid"
  code=$?
  { kill "$watchdog" && wait "$watchdog"; } 2> /dev/null
  echo $code > "$out/run$n.code"
  echo $((SECONDS - t0)) > "$out/run$n.seconds"
}
snapshot() {
  local n=$1
  (cd "$gori" && ls .git/gori/learning/cases 2>/dev/null) > "$out/cases$n.txt"
  (cd "$gori" && tools/records/pool list --status proposed --status todo --status rejected --status done 2>&1) > "$out/pool$n.txt"
  (cd "$gori" && ls .git/gori/learning/pending 2>/dev/null) > "$out/pending$n.txt"
}

run_extract 1
snapshot 1
run_extract 2
snapshot 2

GORI="$gori" OUT="$out" S1=$S1 S2=$S2 S3=$S3 S4=$S4 S5=$S5 S6=$S6 node --input-type=module <<'JS'
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const { GORI, OUT, S1, S2, S3, S4, S5, S6 } = process.env;
const { readFrontmatter } = await import(join(GORI, 'tools', 'lib', 'frontmatter.mjs'));
const read = (f) => (existsSync(f) ? readFileSync(f, 'utf8') : '');
const dir = join(GORI, '.git', 'gori', 'learning', 'cases');
const cases = (existsSync(dir) ? readdirSync(dir) : []).filter((f) => f.endsWith('.md')).map((f) => {
  const fm = readFrontmatter(readFileSync(join(dir, f), 'utf8'));
  const v = (k) => fm.fields?.[k]?.value ?? null;
  return { id: f.slice(0, -3), type: v('type'), pattern: v('pattern'), session: v('session'), message: v('message'), quote: v('quote') };
});
const s1 = cases.filter((c) => c.session === S1);
const s2 = cases.filter((c) => c.session === S2);
const s3 = cases.filter((c) => c.session === S3);
const s4 = cases.filter((c) => c.session === S4);
const s5 = cases.filter((c) => c.session === S5);
const s6 = cases.filter((c) => c.session === S6);
// 合成の会話の uuid は、セッション ID の先頭 8 文字と、発言の位置（1 から）で決まる。先頭 8 文字は二つのセッションで同じなので、session と合わせて比べる。
const uuidAt = (sid, n) => `${sid.slice(0, 8)}-0000-4000-8000-${String(n).padStart(12, '0')}`;
const choice = uuidAt(S2, 3);
const approval = uuidAt(S2, 7);
const correction = uuidAt(S2, 5);
// pool list の一行は、ID、状態、種類、題のタブ区切りである。
const pool = read(join(OUT, 'pool1.txt'));
const items = pool.split('\n').filter((l) => l.trim()).map((l) => l.split('\t'));
const proposed = items.filter(([, status, kind]) => status === 'proposed' && kind === 'learning');
const itemId = proposed[0]?.[0];
const view = itemId ? (await import('node:child_process')).spawnSync(join(GORI, 'tools', 'records', 'pool'), ['show', itemId], { cwd: GORI, encoding: 'utf8' }).stdout : '';
const pendingDir = join(GORI, '.git', 'gori', 'learning', 'pending');
const left = existsSync(pendingDir) ? readdirSync(pendingDir) : [];

const results = [];
const check = (label, ok, detail = '') => results.push({ label, ok, detail });
for (const n of [1, 2]) check(`${n} 回目の claude の終了コードが 0`, read(join(OUT, `run${n}.code`)).trim() === '0', read(join(OUT, `run${n}.err`)).slice(0, 500));
check('一つ目のセッションから事例が二件', s1.length === 2, JSON.stringify(s1));
check('一つ目の二件は同じ pattern で、別の発言を指す', s1.length === 2 && s1[0].pattern === s1[1].pattern && s1[0].message !== s1[1].message);
check('二つ目のセッションから事例が一件', s2.length === 1, JSON.stringify(s2));
check('案を選んだだけの発言は事例にならない', s2.every((c) => c.message !== choice), JSON.stringify(s2.filter((c) => c.message === choice)));
check('提案を承認しただけの発言は事例にならない', s2.every((c) => c.message !== approval), JSON.stringify(s2.filter((c) => c.message === approval)));
check('二つ目の事例は訂正の発言を指す', s2.length === 1 && s2[0].message === correction, JSON.stringify(s2));
check('二つ目の事例は一つ目と別の pattern', s2.length === 1 && s1.every((c) => c.pattern !== s2[0].pattern));
check('依頼どおりや安全な既定の振る舞いの後に新しい依頼が来ただけの会話から、事例を書かない', s3.length === 0, JSON.stringify(s3));
check('四つ目のセッションから事例が二件', s4.length === 2, JSON.stringify(s4));
check('四つ目の二件は、話題が同じでも種類が違うので別の pattern', s4.length === 2 && s4[0].pattern !== s4[1].pattern, JSON.stringify(s4));
check('四つ目の事例の pattern は、他のセッションの事例と重ならない', s4.every((c) => cases.every((d) => d.session === S4 || d.pattern !== c.pattern)), JSON.stringify(cases));
check('四つ目の事例の id は一件に書かれていない', s4.every((c) => !view.includes(c.id)));
check('抽出待ちに無い会話から、事例を書かない', s5.length === 0, JSON.stringify(s5));
check('一つの発言がまとめて指摘した三つの出来事から、事例が一件', s6.length === 1, JSON.stringify(s6));
check('六つ目の事例は、まとめて指摘した発言を指す', s6.length === 1 && s6[0].message === uuidAt(S6, 3), JSON.stringify(s6));
check('六つ目の事例の pattern は、他のセッションの事例と重ならない', s6.every((c) => cases.every((d) => d.session === S6 || d.pattern !== c.pattern)), JSON.stringify(cases));
check('六つ目の事例の id は一件に書かれていない', s6.every((c) => !view.includes(c.id)));
check('事例は一つ目、二つ目、四つ目、六つ目のセッションのものだけ', cases.length === s1.length + s2.length + s4.length + s6.length, JSON.stringify(cases));
check('proposed の学びが一件だけ', proposed.length === 1, pool.trim());
check('プールは全体でも一件だけ', items.length === 1, pool.trim());
check('一件に一つ目の事例の id が両方書かれている', s1.length === 2 && s1.every((c) => view.includes(c.id)), itemId ?? '(なし)');
check('一件に二つ目の事例の id は書かれていない', s2.length === 1 && !view.includes(s2[0].id));
check('抽出待ちに積んだセッションが、どれも抽出待ちから消えている', left.length === 0, left.join(' '));
check('二回目で事例が増えていない', read(join(OUT, 'cases1.txt')) === read(join(OUT, 'cases2.txt')));
check('二回目で起票が増えていない', read(join(OUT, 'pool1.txt')) === read(join(OUT, 'pool2.txt')));

console.log('\n=== 事例');
for (const c of cases) console.log(`${c.id}\t${c.type}\t${c.pattern}\t${c.session}/${c.message}\t${c.quote}`);
console.log('\n=== pool list（1 回目の後）');
console.log(pool.trim());
console.log('\n=== pool list（2 回目の後）');
console.log(read(join(OUT, 'pool2.txt')).trim());
if (view) console.log(`\n=== pool show ${itemId}\n${view.trim()}`);
console.log('\n=== .git/gori/learning/pending（1 回目の後）');
console.log(read(join(OUT, 'pending1.txt')).trim());
console.log(`\n=== 所要時間: 1 回目 ${read(join(OUT, 'run1.seconds')).trim()} 秒、2 回目 ${read(join(OUT, 'run2.seconds')).trim()} 秒`);
console.log('');
for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.label}${r.ok ? '' : `: ${r.detail}`}`);
const pass = results.every((r) => r.ok);
console.log(pass ? '\nALL PASS' : '\nSOME FAILED');
process.exit(pass ? 0 : 1);
JS
status=$?
echo "出力: $out"
exit $status
