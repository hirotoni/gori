import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fixture, gitFixture, gitTree, repoRoot, run, tempTree } from '../helpers.mjs';

test('正しいツリーは終了コード 0', () => {
  const r = run('knowledge/lint', ['--root', gitFixture('ok')]);
  assert.equal(r.status, 0, r.out);
});

test('リポジトリ自身が通る', () => {
  const r = run('knowledge/lint', ['--root', repoRoot]);
  assert.equal(r.status, 0, r.out);
});

const broken = [
  ['missing-section', 'knowledge/procedures/investigate.md', 'procedure-sections'],
  ['bad-ref', 'knowledge/procedures/feature.md', 'unresolved-ref'],
  ['copied-paragraph', 'knowledge/procedures/migrate.md', 'duplicated-paragraph'],
  ['kind-mismatch', 'knowledge/procedures/design.md', 'kind-mismatch'],
  ['bad-frontmatter', 'knowledge/procedures/research.md', 'bad-frontmatter'],
  ['missing-field', 'knowledge/procedures/maintain.md', 'missing-field'],
  ['bad-steps', 'knowledge/procedures/audit.md', 'procedure-steps'],
  ['unmentioned-ref', 'knowledge/procedures/review.md', 'unmentioned-ref'],
];

for (const [name, path, rule] of broken) {
  test(`${name}: ${path} が ${rule} で落ちる`, () => {
    const r = run('knowledge/lint', ['--root', fixture(name)]);
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, new RegExp(`^${path}:\\d+: ${rule}: `, 'm'));
  });
}

test('書き写しは両方のパスを名指しする', () => {
  const r = run('knowledge/lint', ['--root', fixture('copied-paragraph')]);
  assert.match(r.out, /knowledge\/procedures\/migrate\.md/);
  assert.match(r.out, /knowledge\/criteria\/done-check\.md/);
});

const unit = (extra) => `---
id: x
kind: procedure
when: 試験のとき
${extra}
provenance:
  added: 2026-11-10
  source: s
  patterns: []
  enforced_by: []
---
`;

const subsetViolations = {
  ブロックリスト: unit('refs:\n  - a'),
  'フロー map': unit('refs: {a: b}'),
  二段のネスト: unit('extra:\n  a:\n    b: c'),
  アンカー: unit('refs: &a []'),
  複数行スカラー: unit('refs: |'),
  キーの重複: unit('refs: []\nrefs: []'),
  リストが閉じない: unit('refs: [a, b'),
};

for (const [label, text] of Object.entries(subsetViolations)) {
  test(`部分集合の外 (${label}) は bad-frontmatter`, () => {
    const dir = tempTree({ 'knowledge/procedures/x.md': text });
    const r = run('knowledge/lint', ['--root', dir]);
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /^knowledge\/procedures\/x\.md:\d+: bad-frontmatter: /m);
  });
}

test('閉じの --- が無いと bad-frontmatter', () => {
  const dir = tempTree({ 'knowledge/procedures/x.md': '---\nid: x\n' });
  const r = run('knowledge/lint', ['--root', dir]);
  assert.match(r.out, /^knowledge\/procedures\/x\.md:1: bad-frontmatter: /m);
});

test('許される記法: 引用符つき文字列、行末コメント、空のリスト', () => {
  const body = ['## 対象', '', 'a', '## 手順', '', '1. b', '## 禁止事項', '', 'c', '## 終わりの条件', '', 'd', '## 報告', '', 'e'].join('\n');
  const text = unit('refs: []').replace('when: 試験のとき', 'when: "説明: コロンを含む" # コメント') + body;
  const dir = tempTree({ 'knowledge/procedures/x.md': text });
  const r = run('knowledge/lint', ['--root', dir]);
  assert.equal(r.status, 0, r.out);
});

test('不正な値は bad-value', () => {
  const body = ['## 対象', '## 手順', '## 禁止事項', '## 終わりの条件', '## 報告'].join('\n\n');
  const text = (unit('refs: []') + body).replace('added: 2026-11-10', 'added: 2026-13-45');
  const dir = tempTree({ 'knowledge/procedures/x.md': text });
  const r = run('knowledge/lint', ['--root', dir]);
  assert.match(r.out, /x\.md:\d+: bad-value: provenance\.added/);
});

test('見出しの順序違いは procedure-sections', () => {
  const body = ['## 手順', '## 対象', '## 禁止事項', '## 終わりの条件', '## 報告'].join('\n\n');
  const dir = tempTree({ 'knowledge/procedures/x.md': unit('refs: []') + body });
  const r = run('knowledge/lint', ['--root', dir]);
  assert.match(r.out, /^knowledge\/procedures\/x\.md:\d+: procedure-sections: /m);
});

test('id が違えば id-mismatch', () => {
  const body = ['## 対象', '## 手順', '## 禁止事項', '## 終わりの条件', '## 報告'].join('\n\n');
  const dir = tempTree({ 'knowledge/procedures/y.md': unit('refs: []') + body });
  const r = run('knowledge/lint', ['--root', dir]);
  assert.match(r.out, /^knowledge\/procedures\/y\.md:\d+: id-mismatch: /m);
});

test('コードブロックの中の段落は書き写しに数えない', () => {
  const long = 'これは四十文字を超える十分に長い一行であり、コードブロックの中に置かれている。';
  const mk = (id) => ({
    [`knowledge/criteria/${id}.md`]: `---
id: ${id}
kind: criterion
when: 試験
rule: 試験の規則。
refs: []
provenance:
  added: 2026-11-10
  source: s
  patterns: []
  enforced_by: []
---

\`\`\`
${long}
\`\`\`
`,
  });
  const dir = tempTree({ ...mk('a'), ...mk('b') });
  const r = run('knowledge/lint', ['--root', dir]);
  assert.equal(r.status, 0, r.out);
});

const procedure = (steps, refs = '[]', extra = '') =>
  unit(`refs: ${refs}`) + ['## 対象', '', 'a', '', '## 手順', '', steps, '', '## 禁止事項', '', 'c', '', '## 終わりの条件', '', 'd', '', '## 報告', '', `e${extra}`].join('\n');

const stepsViolations = {
  段落だけ: 'b をする。',
  空: '',
  '番号が 2 から': '2. b',
  '連番でない': '1. b\n3. c',
  '箇条書き': '- b',
  '項目の後に地の文': '1. b\n\nc をする。',
};

for (const [label, steps] of Object.entries(stepsViolations)) {
  test(`手順の形が不正 (${label}) は procedure-steps`, () => {
    const dir = tempTree({ 'knowledge/procedures/x.md': procedure(steps) });
    const r = run('knowledge/lint', ['--root', dir]);
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /^knowledge\/procedures\/x\.md:\d+: procedure-steps: /m);
  });
}

test('複数行の項目と入れ子の箇条書きは手順として通る', () => {
  const dir = tempTree({ 'knowledge/procedures/x.md': procedure('1. b\n   続き\n   - 入れ子\n2. c') });
  assert.equal(run('knowledge/lint', ['--root', dir]).status, 0);
});

test('unmentioned-ref は別の名前の一部としての出現を数えない', () => {
  const crit = (id) => ({
    [`knowledge/criteria/${id}.md`]: `---\nid: ${id}\nkind: criterion\nwhen: 試験\nrule: 試験の規則。\nrefs: []\nprovenance:\n  added: 2026-11-10\n  source: s\n  patterns: []\n  enforced_by: []\n---\n\n${id} の本文。\n`,
  });
  const files = { ...crit('done'), ...crit('done-check'), 'knowledge/procedures/x.md': procedure('1. b', '[criteria/done]', ' `criteria/done-check` に従う') };
  const r = run('knowledge/lint', ['--root', tempTree(files)]);
  assert.match(r.out, /^knowledge\/procedures\/x\.md:\d+: unmentioned-ref: .*criteria\/done /m);
  files['knowledge/procedures/x.md'] = procedure('1. b', '[criteria/done]', ' `criteria/done` に従う');
  assert.equal(run('knowledge/lint', ['--root', tempTree(files)]).status, 0);
});

test('unlisted-ref は本文で名指して refs に無い知識ファイルを報告し、別の名前の一部と自分自身は数えない', () => {
  const crit = (id, body = `${id} の本文。`) => ({
    [`knowledge/criteria/${id}.md`]: `---\nid: ${id}\nkind: criterion\nwhen: 試験\nrule: 試験の規則。\nrefs: []\nprovenance:\n  added: 2026-11-10\n  source: s\n  patterns: []\n  enforced_by: []\n---\n\n${body}\n`,
  });
  const files = { ...crit('done'), ...crit('done-check', '`criteria/done-check` は自分を名指す。'), 'knowledge/procedures/x.md': procedure('1. b', '[]', ' `criteria/done` に従う') };
  const r = run('knowledge/lint', ['--root', tempTree(files)]);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /^knowledge\/procedures\/x\.md:\d+: unlisted-ref: .*criteria\/done /m);
  assert.doesNotMatch(r.out, /done-check\.md:\d+: unlisted-ref/);
  files['knowledge/procedures/x.md'] = procedure('1. b', '[]', ' `criteria/done-check2` に従う');
  assert.doesNotMatch(run('knowledge/lint', ['--root', tempTree(files)]).out, /unlisted-ref/);
});

const skill = (id, extra = '') => `---\nname: ${id}\n${extra}description: d\nid: ${id}\nkind: capability\nrefs: []\nprovenance:\n  added: 2026-11-10\n  source: s\n  patterns: []\n  enforced_by: []\n---\n\n${id} の本文。\n`;
const triggers = (rows) => `---\nid: triggers\nkind: config\nrefs: [skills/manual, skills/auto]\nprovenance:\n  added: 2026-11-10\n  source: s\n  patterns: []\n  enforced_by: []\n---\n\n能力は Skill ツールで \`gori:<id>\` として呼ぶ。\n\n| 状況 | 使うもの |\n| ---- | -------- |\n${rows}\n`;
const triggerTree = (manualRow) => ({
  'knowledge/skills/manual/SKILL.md': skill('manual', 'disable-model-invocation: true\n'),
  'knowledge/skills/auto/SKILL.md': skill('auto'),
  'knowledge/config/triggers.md': triggers(`| a のとき | \`skills/auto\` |\n${manualRow}`),
});

test('triggers の行が Skill ツールで呼べない能力を起動の仕方なしに指すと uninvocable-trigger', () => {
  const r = run('knowledge/lint', ['--root', tempTree(triggerTree('| b のとき | `skills/manual` |'))]);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /^knowledge\/config\/triggers\.md:\d+: uninvocable-trigger: skills\/manual /m);
  assert.doesNotMatch(r.out, /uninvocable-trigger: skills\/auto /);
});

test('Skill ツールの名前（gori:<id>）を書いても uninvocable-trigger は消えない', () => {
  const r = run('knowledge/lint', ['--root', tempTree(triggerTree('| b のとき | `skills/manual`（Skill ツールで `gori:manual` を呼ぶ） |'))]);
  assert.match(r.out, /^knowledge\/config\/triggers\.md:\d+: uninvocable-trigger: skills\/manual /m);
});

test('同じ行にスラッシュの起動形（/gori:<id>）を書けば uninvocable-trigger で落ちない', () => {
  const r = run('knowledge/lint', ['--root', tempTree(triggerTree('| b のとき | `skills/manual`（人間が `/loop /gori:manual` で起動する） |'))]);
  assert.equal(r.status, 0, r.out);
});

test('uninvocable-trigger は triggers 以外の知識ファイルと表の外の文を見ない', () => {
  const files = triggerTree('| b のとき | `skills/manual`（`/gori:manual`） |');
  files['knowledge/config/triggers.md'] = files['knowledge/config/triggers.md'].replace('能力は Skill', '`skills/manual` は表の外の文。能力は Skill');
  files['knowledge/config/other.md'] = triggers('| a のとき | `skills/auto` |\n| b のとき | `skills/manual` |').replace('id: triggers', 'id: other');
  const r = run('knowledge/lint', ['--root', tempTree(files)]);
  assert.equal(r.status, 0, r.out);
});

// 来歴の検査。知識ファイルは判断基準一つにして、provenance だけを変える。
const sourced = ({ source = 's', patterns = '[]', extra = '', enforced = '[]', maturity = '' } = {}) =>
  `---\nid: x\nkind: criterion\nwhen: 試験\nrule: 試験の規則。\nrefs: []\nprovenance:\n  added: 2026-11-10\n  source: ${source}\n  patterns: ${patterns}\n${extra}  enforced_by: ${enforced}\n${maturity ? `maturity: ${maturity}\n` : ''}---\n\nx の本文。\n`;
const X = 'knowledge/criteria/x.md';
// files の learning/... は、git の共通ディレクトリの下の gori/learning/ に置く（tests/helpers.mjs の gitTree）。
const lintTree = (files) => run('knowledge/lint', ['--root', gitTree(files)]);

test('enforced_by が実在しない検査を指すと unknown-enforcer で知識ファイルと項目を名指しする', () => {
  const r = lintTree({ [X]: sourced({ enforced: '[lint:no-such-rule, test:no-such-test, verdict:no-such, nokind, other:x, lint:procedure-steps, verdict:check, log:check]' }) });
  assert.equal(r.status, 1, r.out);
  for (const item of ['lint:no-such-rule', 'test:no-such-test', 'verdict:no-such', 'nokind', 'other:x']) {
    assert.match(r.out, new RegExp(`^knowledge/criteria/x\\.md:\\d+: unknown-enforcer: enforced_by の ${item} `, 'm'));
  }
  for (const item of ['lint:procedure-steps', 'verdict:check', 'log:check']) assert.doesNotMatch(r.out, new RegExp(`の ${item} `));
});

test('test:<名前> は tests/ の下の <名前>.test.mjs か <名前>.sh を指し、fixtures の下は数えない', () => {
  const files = { 'tests/a/foo.test.mjs': '', 'tests/b/test_bar.sh': '', 'tests/knowledge/fixtures/baz.sh': '' };
  assert.equal(lintTree({ ...files, [X]: sourced({ enforced: '[test:foo, test:test_bar]' }) }).status, 0);
  const r = lintTree({ ...files, [X]: sourced({ enforced: '[test:baz]' }) });
  assert.match(r.out, /^knowledge\/criteria\/x\.md:\d+: unknown-enforcer: enforced_by の test:baz /m);
});

test('verdict: と log: の表の名前は、道具の中に検査として実在する', () => {
  const src = readFileSync(join(repoRoot, 'tools', 'knowledge', 'lint'), 'utf8');
  for (const [kind, tool] of [['verdict', 'tools/records/verdict'], ['log', 'tools/records/log']]) {
    const m = new RegExp(`^\\s*${kind}: \\{.*names: \\(\\) => \\[([^\\]]*)\\]`, 'm').exec(src);
    assert.ok(m, `${kind} の表が読めない`);
    const names = m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
    assert.ok(names.length > 0);
    const toolSrc = readFileSync(join(repoRoot, tool), 'utf8');
    for (const name of names) assert.ok(toolSrc.includes(`'${name}'`) || toolSrc.includes(`function ${name}(`), `${tool} に ${name} が無い`);
  }
});

test('provenance.patterns が無いと missing-field、pattern の形でない要素は bad-value', () => {
  const missing = lintTree({ [X]: sourced().replace('  patterns: []\n', '') });
  assert.equal(missing.status, 1, missing.out);
  assert.match(missing.out, /^knowledge\/criteria\/x\.md:\d+: missing-field: 必須項目 provenance\.patterns /m);
  const bad = lintTree({ [X]: sourced({ patterns: '[ok-one, Bad_Name, "a b"]' }) });
  assert.equal(bad.status, 1, bad.out);
  assert.match(bad.out, /^knowledge\/criteria\/x\.md:\d+: bad-value: provenance\.patterns の「Bad_Name」/m);
  assert.match(bad.out, /bad-value: provenance\.patterns の「a b」/);
  assert.doesNotMatch(bad.out, /「ok-one」/);
});

test('provenance.cases を書くと、事例の id の有無に依らず bad-value で patterns への書き換えを示す', () => {
  for (const cases of ['[]', '[2026-01-01-a]']) {
    const r = lintTree({ [X]: sourced({ extra: `  cases: ${cases}\n` }) });
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /^knowledge\/criteria\/x\.md:\d+: bad-value: provenance\.cases は使わない。.*provenance\.patterns に書く/m);
  }
});

const caseFile = (id, pattern) => ({ [`learning/cases/${id}.md`]: `---\nid: ${id}\ntype: correction\npattern: ${pattern}\n---\n\n例。\n` });

test('provenance.cases の失敗は、手元の事例から引いた pattern で置き換えた後の行と、手元に無い id と取り消した id を示す', () => {
  const learned = {
    ...caseFile('2026-01-01-a', 'pat-a'),
    ...caseFile('2026-01-02-b', 'pat-a'),
    ...caseFile('2026-01-03-c', 'pat-c'),
    ...caseFile('2026-01-04-d', 'pat-d'),
    'learning/retractions/2026-01-04-d.md': '---\nid: 2026-01-04-d\nretracted: 2026-01-05\n---\n\n誤り。\n',
  };
  const r = lintTree({ ...learned, [X]: sourced({ patterns: '[kept]', extra: '  cases: [2026-01-01-a, 2026-01-02-b, 2026-01-03-c, 2026-01-04-d, 2026-01-09-z]\n' }) });
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /bad-value: provenance\.cases は使わない。.*cases の行を消し、patterns: \[kept, pat-a, pat-c\] にする。手元に無い id: 2026-01-09-z（.*）。取り消した id: 2026-01-04-d（/);
  const empty = lintTree({ [X]: sourced({ extra: '  cases: []\n' }) });
  assert.match(empty.out, /cases の行を消し、patterns: \[\] にする/);
  // 手元に事例が無ければ（git の作業ツリーの最上位でないフィクスチャなど）、引き方だけを示す。
  const plain = run('knowledge/lint', ['--root', tempTree({ [X]: sourced({ extra: '  cases: [2026-01-01-a]\n' }) })]);
  assert.match(plain.out, /手元に事例が無いので、事例を持つマシンの tools\/learning\/case list で id から pattern を引く/);
});

// maturity の欄は外した。上流を取り込む前の下流の知識ファイルに残っていても落とさない。
test('外した maturity の欄が残っていても通る', () => {
  const r = lintTree({ [X]: sourced({ source: '"学び: a"', patterns: '[a]', maturity: 'established' }) });
  assert.equal(r.status, 0, r.out);
});

// 来歴がプールの一件を指す書き方。手元にプール（gori/repos/）が無くても落ちる。
test('来歴がプールの一件を指すと pool-provenance で落ち、直し方を示す', () => {
  const byId = lintTree({ [X]: sourced({ source: '"学び: x"', patterns: '[20260101-090000-demo-item, 20261108-090000-y]' }) });
  assert.equal(byId.status, 1, byId.out);
  assert.match(byId.out, /^knowledge\/criteria\/x\.md:\d+: pool-provenance: provenance\.patterns の「20260101-090000-demo-item」が.*patterns には学びの pattern を/m);
  assert.match(byId.out, /pool-provenance: provenance\.patterns の「20261108-090000-y」/);
  const byRef = lintTree({ [X]: sourced({ source: 'pool:20260101-090000-demo-item' }) });
  assert.equal(byRef.status, 1, byRef.out);
  assert.match(byRef.out, /^knowledge\/criteria\/x\.md:\d+: pool-provenance: provenance\.source の「pool:20260101-090000-demo-item」/m);
  assert.match(lintTree({ [X]: sourced({ source: '"学び: x、20260101-090000-demo"' }) }).out, /pool-provenance: provenance\.source/);
});

test('pattern、「学び: <pattern>」、課題管理のチケット番号は pool-provenance で落ちない', () => {
  const r = lintTree({ [X]: sourced({ source: '"学び: pool-dependency"', patterns: '[pool-dependency, label-dependency, task-15-x]' }) });
  assert.equal(r.status, 0, r.out);
  // 来歴がプールの一件を指すかだけを見るので、課題管理のチケット番号やラベルの語では落とさない。
  const ticket = lintTree({ [X]: sourced({ source: 'PROJ-3（成熟度は Backlog のラベル）' }) });
  assert.doesNotMatch(ticket.out, /provenance/);
});

test('判断基準は rule が無いと missing-field、空だと bad-value で落ちる。手順書には rule を求めない', () => {
  const none = lintTree({ [X]: sourced().replace('rule: 試験の規則。\n', '') });
  assert.equal(none.status, 1, none.out);
  assert.match(none.out, /x\.md:\d+: missing-field: 必須項目 rule がない/);
  const empty = lintTree({ [X]: sourced().replace('rule: 試験の規則。', 'rule: ""') });
  assert.equal(empty.status, 1, empty.out);
  assert.match(empty.out, /x\.md:\d+: bad-value: rule が空/);
  assert.equal(lintTree({ [X]: sourced() }).status, 0);
  assert.equal(run('knowledge/lint', ['--root', gitFixture('ok')]).status, 0);
});

test('rule の無い判断基準には、本体の冒頭の一文から作った rule の行を示す。冒頭が文でなければ書き方だけを示す', () => {
  const old = sourced().replace('rule: 試験の規則。\n', '').replace('x の本文。\n', '迷ったら削る。理由は二つある。\n\n詳しい説明。\n');
  const r = lintTree({ [X]: old });
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /^knowledge\/criteria\/x\.md:\d+: missing-field: 必須項目 rule がない。本体の冒頭の一文を frontmatter に移し、本体からその一文を消す。足す行: rule: 迷ったら削る。$/m);
  for (const body of ['## 見出し\n\n本文。\n', '- 箇条書き。\n', '1. 手順。\n', '句点の無い行\n', '']) {
    const none = lintTree({ [X]: sourced().replace('rule: 試験の規則。\n', '').replace('x の本文。\n', body) });
    assert.equal(none.status, 1, none.out);
    assert.match(none.out, /missing-field: 必須項目 rule がない。規則を一文か二文で、frontmatter に rule: <規則> の一行で書く$/m);
    assert.doesNotMatch(none.out, /足す行/);
  }
});

test('rule のある判断基準と、判断基準でない知識ファイルの lint の出力は、rule の案内を含まない', () => {
  const ok = lintTree({ [X]: sourced() });
  assert.equal(ok.status, 0, ok.out);
  assert.doesNotMatch(ok.out, /rule/);
  const r = run('knowledge/lint', ['--root', gitFixture('ok')]);
  assert.equal(r.status, 0, r.out);
  assert.doesNotMatch(r.out, /rule がない/);
});
