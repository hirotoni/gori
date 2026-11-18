import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, gitFixture, run, tempTree } from '../helpers.mjs';

// 事例（cases/...）は git の共通ディレクトリの下の gori/learning/ に置くので、fixture を git のリポジトリにして使う。
const OK = gitFixture('ok');
const show = (key, root = OK) => run('knowledge/show', [key, '--root', root]);
const stdoutOf = (key, root) => show(key, root).out;

test('frontmatter を出さず、先頭に参照キーと when を置く', () => {
  const r = show('procedures/bug-fix');
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /^# procedures\/bug-fix\nbug-fix の依頼を受けたとき\n\n## 対象/);
  assert.doesNotMatch(r.out, /provenance|maturity|^---$/m);
});

test('リストの項目で名指しした知識ファイルは、リストが途切れないようリスト全体の後に折り込む', () => {
  const lines = stdoutOf('procedures/bug-fix').split('\n');
  const first = lines.findIndex((l) => l.startsWith('1. 不具合の修正 の前提'));
  assert.ok(lines[first + 1].startsWith('2. 変更を小さな単位に'));
  const after = lines.findIndex((l) => l.startsWith('   実装は'));
  assert.equal(lines[after + 2], '> **skills/reproduce**：不具合を再現する手順を実行する（本文は knowledge/skills/reproduce/SKILL.md）');
  assert.ok(lines.indexOf('> **config/models**') < lines.indexOf('## 禁止事項'));
  assert.ok(lines.includes('> **cases/2026-01-01-example**'));
});

test('能力と役割は本文を折り込まず、説明と本文の場所を一行で出す', () => {
  const out = stdoutOf('procedures/bug-fix');
  assert.match(out, /^> \*\*agents\/worker\*\*：委任された変更を実装する（本文は knowledge\/agents\/worker\.md）$/m);
  assert.doesNotMatch(out, /依頼文の範囲だけを変更し/);
});

test('同じ知識ファイルは一度だけ折り込み、参照先がさらに refs を持てば「参照:」の一行だけを出す', () => {
  const dir = tempTree({
    'knowledge/criteria/b.md': '---\nid: b\nkind: criterion\nwhen: w\nrefs: []\n---\n\nB の本文。\n',
    'knowledge/criteria/a.md': '---\nid: a\nkind: criterion\nwhen: w\nrefs: [criteria/b]\n---\n\nA は criteria/b を使う。\n',
    'knowledge/procedures/x.md': '---\nid: x\nkind: procedure\nwhen: w\nrefs: [criteria/a]\n---\n\ncriteria/a を読む。\n\nもう一度 criteria/a。\n',
  });
  const out = stdoutOf('procedures/x', dir);
  assert.equal(out.split('\n').filter((l) => l === '> **criteria/a**').length, 1);
  assert.match(out, /> A は criteria\/b を使う。\n>\n> 参照: criteria\/b\n/);
  assert.doesNotMatch(out, /B の本文/);
});

test('参照先が実在しなければ失敗し、何も出さない', () => {
  const r = run('knowledge/show', ['procedures/bug-fix', '--root', fixture('bad-ref')]);
  assert.equal(r.status, 1);
  const r2 = run('knowledge/show', ['procedures/feature', '--root', fixture('bad-ref')]);
  assert.equal(r2.status, 1);
  assert.match(r2.out, /criteria\/no-such-unit/);
  assert.equal(show('procedures/none').status, 1);
});

test('コードブロックの中の空行では塊を割らない', () => {
  const dir = tempTree({
    'knowledge/criteria/a.md': '---\nid: a\nkind: criterion\nwhen: w\nrefs: []\n---\n\nA の本文。\n',
    'knowledge/procedures/x.md': '---\nid: x\nkind: procedure\nwhen: w\nrefs: [criteria/a]\n---\n\n```\nline\n\n見るのは criteria/a\n```\n\n次の段落。\n',
  });
  const out = stdoutOf('procedures/x', dir).split('\n');
  const close = out.lastIndexOf('```');
  assert.equal(out[close + 2], '> **criteria/a**');
  assert.ok(out.indexOf('次の段落。') > close);
});

test('判断基準は、適用場面の次に規則を出し、折り込まれるときも本文の前に規則を出す', () => {
  const dir = tempTree({
    'knowledge/criteria/a.md': '---\nid: a\nkind: criterion\nwhen: 迷ったとき\nrule: A の規則。\nrefs: []\n---\n\nA の理由。\n',
    'knowledge/procedures/x.md': '---\nid: x\nkind: procedure\nwhen: w\nrefs: [criteria/a]\n---\n\ncriteria/a を読む。\n',
  });
  assert.match(stdoutOf('criteria/a', dir), /^# criteria\/a\n迷ったとき\nA の規則。\n\nA の理由。/);
  assert.match(stdoutOf('procedures/x', dir), /> \*\*criteria\/a\*\*\n>\n> A の規則。\n>\n> A の理由。/);
});
