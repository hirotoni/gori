import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { gitTree, repoRoot, tempTree } from '../helpers.mjs';

const HOOK = join(repoRoot, 'tools', 'hooks', 'session-start');
const fm = (id) => `---\nid: ${id}\nkind: config\nrefs: []\n---\n\n`;
const tree = (extra = {}) =>
  tempTree({
    'knowledge/config/routing.md': `${fm('routing')}ROUTING \${CLAUDE_PLUGIN_ROOT}/knowledge/index.md\n`,
    'knowledge/config/triggers.md': `${fm('triggers')}TRIGGERS\n`,
    'knowledge/index.md': '# 索引\n\nprocedures/a\twhen\n',
    ...extra,
  });

// 抽出のログの置き場所（GORI_HOME）は、既定で空の一時ディレクトリにし、手元の本物のログを読まない。
function hook(root, { env = true, systemReport, home = mkdtempSync(join(tmpdir(), 'gori-home-')), extra = {} } = {}) {
  const e = { ...process.env };
  for (const k of ['CLAUDE_PLUGIN_ROOT', 'GORI_SYSTEM_REPORT', 'GORI_EXTRACTING', 'GORI_REVIEWING', 'GORI_AUTO', 'GORI_ROOT']) delete e[k];
  e.GORI_HOME = home;
  Object.assign(e, extra);
  if (env) e.CLAUDE_PLUGIN_ROOT = root;
  if (systemReport !== undefined) e.GORI_SYSTEM_REPORT = systemReport;
  const r = spawnSync(process.execPath, [HOOK], { encoding: 'utf8', env: e });
  return { status: r.status, out: r.stdout, err: r.stderr };
}

test('routing、triggers、index の順に frontmatter を除いて出し、終了コードは 0', () => {
  const dir = tree();
  const r = hook(dir);
  assert.equal(r.status, 0);
  assert.equal(r.out, `ROUTING ${dir}/knowledge/index.md\n\nTRIGGERS\n\n# 索引\n\nprocedures/a\twhen\n\nGORI_SYSTEM_REPORT=1\n`);
  assert.equal(r.err, '');
});

test('index.md が無くても routing と triggers を出し、失敗は stderr に書く', () => {
  const dir = tempTree({ 'knowledge/config/routing.md': `${fm('routing')}ROUTING\n`, 'knowledge/config/triggers.md': `${fm('triggers')}TRIGGERS\n` });
  const r = hook(dir);
  assert.equal(r.status, 0);
  assert.equal(r.out, 'ROUTING\n\nTRIGGERS\n\nGORI_SYSTEM_REPORT=1\n');
  assert.match(r.err, /knowledge\/index\.md/);
});

test('frontmatter が壊れていても、読めたものは出す', () => {
  const dir = tree({ 'knowledge/index.md': '---\nid: [\n# 索引\n', 'knowledge/config/triggers.md': '---\nid: triggers\nTRIGGERS 本文\n' });
  const r = hook(dir);
  assert.equal(r.status, 0);
  assert.match(r.out, /^ROUTING /);
  assert.match(r.out, /TRIGGERS 本文/);
  assert.match(r.out, /# 索引/);
});

test('routing.md が無ければ埋め込みの指示を出し、ほかは出す', () => {
  const dir = tempTree({ 'knowledge/config/triggers.md': `${fm('triggers')}TRIGGERS\n`, 'knowledge/index.md': '# 索引\n' });
  const r = hook(dir);
  assert.equal(r.status, 0);
  assert.match(r.out, /^依頼を受けたら、gori の knowledge\/index\.md を読み、当てはまる手順書に従う。/);
  assert.match(r.out, /TRIGGERS/);
  assert.match(r.err, /routing\.md/);
});

test('何も読めなくても埋め込みの指示を出して終了コード 0', () => {
  const r = hook(tempTree({ 'x': '' }));
  assert.equal(r.status, 0);
  assert.match(r.out, /knowledge\/index\.md/);
});

test('環境変数が無ければ、スクリプトの位置から求めたルートで置き換える', () => {
  const r = hook(null, { env: false });
  assert.equal(r.status, 0);
  assert.ok(r.out.includes(`${repoRoot}/knowledge/index.md`), r.out);
  assert.ok(!r.out.includes('${CLAUDE_PLUGIN_ROOT}'));
});

test('GORI_SYSTEM_REPORT は 0 のときだけ 0 を出し、未設定や他の値は既定の 1 を出す', () => {
  const dir = tree();
  for (const [value, want] of [[undefined, '1'], ['0', '0'], [' 0 ', '0'], ['1', '1'], ['off', '1'], ['', '1']]) {
    const r = hook(dir, { systemReport: value });
    assert.equal(r.status, 0);
    assert.ok(r.out.endsWith(`\n\nGORI_SYSTEM_REPORT=${want}\n`), `${JSON.stringify(value)}: ${r.out}`);
  }
});

// プールの一件。status だけを変えて並べる。
const item = (id, status) => `---\nid: ${id}\ntitle: "t"\nkind: learning\nstatus: ${status}\ncreated: 2026-11-10T21:00:00+09:00\nupdated: 2026-11-10T21:00:00+09:00\nfiles: []\n---\n## 現状\nx\n`;
function goriWithPool(byRepo) {
  const dir = gitTree({
    'knowledge/config/routing.md': `${fm('routing')}ROUTING\n`,
    'knowledge/config/triggers.md': `${fm('triggers')}TRIGGERS\n`,
    'knowledge/index.md': '# 索引\n',
  });
  for (const [name, statuses] of Object.entries(byRepo)) {
    const pool = join(dir, '.git', 'gori', 'repos', name, 'pool');
    mkdirSync(pool, { recursive: true });
    statuses.forEach((st, i) => {
      const id = `20261110-21000${i}-${name}-c${i}`;
      writeFileSync(join(pool, `${id}.md`), item(id, st));
    });
  }
  return dir;
}
const logs = (entries) => {
  const home = mkdtempSync(join(tmpdir(), 'gori-home-'));
  mkdirSync(join(home, 'logs'));
  for (const [name, text] of Object.entries(entries)) writeFileSync(join(home, 'logs', name), text);
  return home;
};
const PENDING = /^承認待ち: 改善候補のプールに proposed の候補が (\d+) 件ある/m;
const FAILED = /^抽出の失敗: /m;

test('全リポジトリのプールの proposed を数えて一行足し、0 でも伝えるよう書く。todo と done は数えない', () => {
  const dir = goriWithPool({ a: ['proposed', 'todo'], b: ['proposed', 'done', 'rejected'] });
  const r = hook(dir, { systemReport: '0' });
  assert.equal(r.status, 0, r.err);
  assert.equal(PENDING.exec(r.out)?.[1], '2', r.out);
  assert.match(r.out, /list --all --status proposed/);
  assert.match(r.out, /GORI_SYSTEM_REPORT が 0 でも、最初の返答の終わりに件数を一行で人間に伝える/);
  assert.ok(r.out.indexOf('GORI_SYSTEM_REPORT=0') < r.out.search(PENDING), r.out);
  assert.equal(r.err, '');
});

test('proposed が無ければ件数の行を足さない', () => {
  const r = hook(goriWithPool({ a: ['todo', 'done'] }));
  assert.equal(r.status, 0);
  assert.equal(r.out, 'ROUTING\n\nTRIGGERS\n\n# 索引\n\nGORI_SYSTEM_REPORT=1\n');
});

test('実際に走った最新の抽出が 0 以外なら知らせる。その後の skipped の記録は読み飛ばす', () => {
  const home = logs({
    'extract-2026-11-09T13-21-03-125Z.log': 'exit=0\nprocedure-scout-exit=0\nseconds=1\nfiled=0\n',
    'extract-2026-11-10T12-27-01-202Z.log': 'exit=1\nprocedure-scout-exit=0\nseconds=1\nfiled=0\n',
    'extract-2026-11-10T13-00-00-000Z.log': 'skipped=not-gori\n',
  });
  const r = hook(tree(), { home });
  assert.equal(r.status, 0);
  assert.match(r.out, /^抽出の失敗: 直近の抽出（2026-11-10 \d\d:27）が exit=1 で終わった。/m);
  assert.ok(r.out.includes(join(home, 'logs', 'extract-2026-11-10T12-27-01-202Z.log')), r.out);
  assert.doesNotMatch(r.out, PENDING);
});

test('手順書の候補の起動だけが失敗しても知らせる。見送った（-）は失敗にしない', () => {
  const scout = hook(tree(), { home: logs({ 'extract-2026-11-10T12-27-01-202Z.log': 'exit=0\nprocedure-scout-exit=124\n' }) });
  assert.match(scout.out, /が procedure-scout-exit=124 で終わった/);
  const skipped = hook(tree(), { home: logs({ 'extract-2026-11-10T12-27-01-202Z.log': 'exit=0\nprocedure-scout-exit=-\nprocedure-scout-skipped=x\n' }) });
  assert.doesNotMatch(skipped.out, FAILED);
});

test('最新の抽出が成功していれば、前の失敗は知らせない。ログが skipped だけでも足さない', () => {
  const ok = hook(tree(), { home: logs({ 'extract-2026-11-09T13-21-03-125Z.log': 'exit=1\n', 'extract-2026-11-10T12-27-01-202Z.log': 'exit=0\nprocedure-scout-exit=0\n' }) });
  assert.doesNotMatch(ok.out, FAILED);
  const onlySkip = hook(tree(), { home: logs({ 'extract-2026-11-10T12-27-01-202Z.log': 'skipped=x\n' }) });
  assert.equal(onlySkip.out.trimEnd().split('\n').at(-1), 'GORI_SYSTEM_REPORT=1');
});

test('抽出とレビューのセッションでは、承認待ちも抽出の失敗も足さない', () => {
  const dir = goriWithPool({ a: ['proposed'] });
  const home = logs({ 'extract-2026-11-10T12-27-01-202Z.log': 'exit=1\n' });
  for (const k of ['GORI_EXTRACTING', 'GORI_REVIEWING']) {
    const r = hook(dir, { home, extra: { [k]: '1' } });
    assert.equal(r.status, 0);
    assert.doesNotMatch(r.out, PENDING, k);
    assert.doesNotMatch(r.out, FAILED, k);
  }
  const both = hook(dir, { home });
  assert.match(both.out, PENDING);
  assert.match(both.out, FAILED);
});

test('形の崩れた一件があっても終了コード 0 で、読めたリポジトリの件数を出し、失敗は stderr に書く', () => {
  const dir = goriWithPool({ a: ['proposed'], b: ['proposed'] });
  writeFileSync(join(dir, '.git', 'gori', 'repos', 'b', 'pool', '20261110-210009-b-bad.md'), '---\nid: [\n');
  const r = hook(dir);
  assert.equal(r.status, 0);
  assert.equal(PENDING.exec(r.out)?.[1], '1', r.out);
  assert.match(r.err, /b のプールを読めない/);
});

// 無人の作業の知らせ。一時の gori と偽の claude で tools/auto/run を動かして状態を作る。
const MERGE = /^取り込み待ち: 無人の作業でレビューに合格し、人間の取り込みを待つ作業が (\d+) 件ある/m;
const STOPPED = /^止まった作業: 無人の作業で、人間を待って止まった作業が (\d+) 件ある/m;
const AUTO_FAILED = /^無人の作業の失敗: 直近の実行（.+）が失敗で終わった: /m;

test('無人の作業の取り込み待ち、止まった作業、直近の失敗を、当てはまるときだけ一行ずつ足す', async () => {
  const auto = await import('../auto/helpers.mjs');
  const none = auto.setup('idle');
  const quiet = hook(none.gori, { extra: { GORI_ROOT: none.gori } });
  assert.equal(quiet.status, 0);
  for (const re of [MERGE, STOPPED, AUTO_FAILED]) assert.doesNotMatch(quiet.out, re);

  const p = auto.setup('pass');
  assert.equal(auto.run(p.gori, p.fake).result, 'pass');
  const merged = hook(p.gori, { systemReport: '0', extra: { GORI_ROOT: p.gori } });
  assert.equal(MERGE.exec(merged.out)?.[1], '1', merged.out + merged.err);
  assert.ok(merged.out.includes(`\`${join(p.gori, 'tools', 'auto', 'status')}\` で一覧できる`), merged.out);
  assert.match(merged.out, /GORI_SYSTEM_REPORT が 0 でも、最初の返答の終わりに一行で人間に伝える/);
  for (const re of [STOPPED, AUTO_FAILED]) assert.doesNotMatch(merged.out, re);

  const s = auto.setup('stop');
  assert.equal(auto.run(s.gori, s.fake).result, 'stopped');
  const stopped = hook(s.gori, { extra: { GORI_ROOT: s.gori } });
  assert.equal(STOPPED.exec(stopped.out)?.[1], '1', stopped.out + stopped.err);
  for (const re of [MERGE, AUTO_FAILED]) assert.doesNotMatch(stopped.out, re);

  const f = auto.setup('exit3');
  assert.equal(auto.run(f.gori, f.fake).result, 'failed');
  const failed = hook(f.gori, { extra: { GORI_ROOT: f.gori } });
  assert.match(failed.out, /^無人の作業の失敗: 直近の実行（.+app\/.+）が失敗で終わった: claude が終了コード 3 で終わった/m);
  for (const re of [MERGE, STOPPED]) assert.doesNotMatch(failed.out, re);
});

test('無人の作業、抽出、レビューのセッションでは、無人の作業の知らせも承認待ちも足さない', async () => {
  const auto = await import('../auto/helpers.mjs');
  const p = auto.setup('pass');
  auto.item(p.gori, 'app', '20261109-090000-waiting', 'proposed');
  assert.equal(auto.run(p.gori, p.fake).result, 'pass');
  // GORI_AUTO は値を見ない。空でも無人として扱う。
  for (const extra of [{ GORI_AUTO: '1' }, { GORI_AUTO: '' }, { GORI_EXTRACTING: '1' }, { GORI_REVIEWING: '1' }]) {
    const r = hook(p.gori, { extra: { GORI_ROOT: p.gori, ...extra } });
    assert.equal(r.status, 0);
    assert.doesNotMatch(r.out, MERGE, JSON.stringify(extra));
    assert.doesNotMatch(r.out, PENDING, JSON.stringify(extra));
  }
  const human = hook(p.gori, { extra: { GORI_ROOT: p.gori } });
  assert.match(human.out, MERGE);
  assert.match(human.out, PENDING);
});

test('無人の作業が学びの適用を main に取り込んでも、知らせの行を足さない', async () => {
  const auto = await import('../auto/helpers.mjs');
  const gori = auto.selfRepo(auto.fakeGori());
  auto.item(gori, 'gori', '20261108-090000-lesson', 'todo', 'learning');
  assert.equal(auto.run(gori, auto.fakeClaude('pass-steps', { name: 'gori' })).result, 'merged');
  const r = hook(gori, { extra: { GORI_ROOT: gori } });
  assert.equal(r.status, 0, r.err);
  assert.doesNotMatch(r.out, /取り込んだ/);
  for (const re of [MERGE, STOPPED, AUTO_FAILED]) assert.doesNotMatch(r.out, re);
});
