import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { repoRoot, tempTree } from '../helpers.mjs';
import { changedFiles, plan, selectTests } from '../lib/select.mjs';

// このファイルは文字列 ls-files と多くの道具の名前（tools/x/y）を含むので、--changed は文書だけの変更や多くの道具の変更でもこのファイルを選ぶ。
// 一時のリポジトリしか作らず数秒で終わるので、選ばれすぎを意図どおりとして残す。

// 選び方を確かめる一時のリポジトリ。テストの単位は tests/<名前>/*.test.mjs と tests/repo/test_*.sh である。
const TREE = {
  'tools/lib/base.mjs': 'export const b = 1;\n',
  'tools/lib/mid.mjs': "import { b } from './base.mjs';\nexport const m = b;\n",
  'tools/records/log': "#!/usr/bin/env node\nimport { m } from '../lib/mid.mjs';\n",
  'tools/records/review': "#!/usr/bin/env node\nconst log = join(root, 'tools', 'records', 'log');\n",
  'tools/learning/metrics': "#!/usr/bin/env node\nconst TRACE = join(here, '..', 'records', 'trace');\n",
  'tools/records/trace': '#!/usr/bin/env node\n',
  'tools/repo/install': '#!/usr/bin/env bash\n# tools/records/review は注釈の中なので辿らない\n',
  'tools/repo/orphan': '#!/usr/bin/env bash\n',
  'tests/helpers.mjs': 'export const fixture = (n) => n;\n',
  'tests/records/log.test.mjs': "import { x } from '../helpers.mjs';\nconst LOG = join(repoRoot, 'tools', 'records', 'log');\n",
  'tests/records/review.test.mjs': "const REVIEW = join(repoRoot, 'tools', 'records', 'review');\n",
  'tests/learning/metrics.test.mjs': "run('learning/metrics', []);\n",
  'tests/knowledge/lint.test.mjs': "copyFixture('ok');\n",
  'tests/knowledge/fixtures/ok/knowledge/a.md': 'tools/repo/orphan を名前として書いた文書\n',
  'tests/repo/test_install.sh': '#!/usr/bin/env bash\n"$root/tools/repo/install"\n',
  'tests/repo/prettier-ignore.test.mjs': "execFileSync('git', ['ls-files']);\n",
  'tests/e2e/x.sh': '#!/usr/bin/env bash\n',
};
const units = (s) => s.tests.map((t) => t.unit);

test('相対の import を推移で辿り、変えた部品を使うテストだけを選ぶ', () => {
  const root = tempTree(TREE);
  // base.mjs ← mid.mjs ← tools/records/log ← log.test と、review（join で log を指す）← review.test。
  assert.deepEqual(units(selectTests(root, ['tools/lib/base.mjs'])), ['tests/records/log.test.mjs', 'tests/records/review.test.mjs']);
});

test("join(…, 'tools', 'x', 'y')、join(here, '..', 'x', 'y')、tools/x/y、run('x/y') の形で書いた道具を辿る", () => {
  const root = tempTree(TREE);
  assert.deepEqual(units(selectTests(root, ['tools/records/review'])), ['tests/records/review.test.mjs']);
  assert.deepEqual(units(selectTests(root, ['tools/records/trace'])), ['tests/learning/metrics.test.mjs']);
  assert.deepEqual(units(selectTests(root, ['tools/repo/install'])), ['tests/repo/test_install.sh']);
});

test('テストのファイル自体を変えたら、そのファイルを選び、理由に変えたファイルを出す', () => {
  const root = tempTree(TREE);
  const s = selectTests(root, ['tests/records/review.test.mjs', 'tests/repo/test_install.sh']);
  assert.equal(s.all, false);
  assert.deepEqual(s.tests, [
    { unit: 'tests/records/review.test.mjs', because: ['tests/records/review.test.mjs'] },
    { unit: 'tests/repo/test_install.sh', because: ['tests/repo/test_install.sh'] },
  ]);
});

test('行の頭からの注釈に書いた道具の名前と、fixture の文書の中の名前は辿らない', () => {
  const root = tempTree(TREE);
  // install の注釈は tools/records/review を名指すが、review を変えても test_install.sh は選ばない。
  assert.ok(!units(selectTests(root, ['tools/records/review'])).includes('tests/repo/test_install.sh'));
  // fixture の文書は tools/repo/orphan を名指すが、orphan はどのテストの依存にも入らないので全体に倒す。
  assert.deepEqual(selectTests(root, ['tools/repo/orphan']), { all: true, because: [{ file: 'tools/repo/orphan', why: 'どのテストの依存にも見つからない' }] });
  // fixture を使うテストは、fixtures の全体に依存する。
  assert.deepEqual(units(selectTests(root, ['tests/knowledge/fixtures/ok/knowledge/a.md'])), ['tests/knowledge/lint.test.mjs']);
});

test('knowledge/ の下の変更は全体に倒し、理由に静的に辿れないことを出す', () => {
  const root = tempTree(TREE);
  const s = selectTests(root, ['tools/records/trace', 'knowledge/procedures/feature.md']);
  assert.equal(s.all, true);
  assert.deepEqual(s.because, [{ file: 'knowledge/procedures/feature.md', why: '道具が実行時に読む知識ファイルは、依存を静的に辿れない' }]);
});

test('tests/helpers.mjs、tests/lib/、tests/run.sh、tools/package.json の変更は全体に倒す', () => {
  const root = tempTree(TREE);
  for (const f of ['tests/helpers.mjs', 'tests/lib/select.mjs', 'tests/run.sh', 'tools/package.json']) {
    assert.deepEqual(selectTests(root, [f]), { all: true, because: [{ file: f, why: 'テストの全体が使う' }] }, f);
  }
});

test('どのテストの依存にも入らない tools/ か tests/ のファイルの変更は全体に倒す', () => {
  const root = tempTree(TREE);
  for (const f of ['tools/repo/orphan', 'tests/e2e/x.sh', 'tools/records/gone']) {
    assert.deepEqual(selectTests(root, [f]), { all: true, because: [{ file: f, why: 'どのテストの依存にも見つからない' }] }, f);
  }
});

test('docs/ と README.md のような文書だけの変更は、リポジトリ全体を読むテスト（git ls-files）だけを選ぶ', () => {
  const root = tempTree(TREE);
  const s = selectTests(root, ['README.md', 'docs/design.md']);
  assert.deepEqual(s, { all: false, tests: [{ unit: 'tests/repo/prettier-ignore.test.mjs', because: ['README.md', 'docs/design.md'] }] });
  // 道具と一緒に変えれば、両方の選んだテストを合わせる。
  assert.deepEqual(units(selectTests(root, ['README.md', 'tools/records/review'])), ['tests/records/review.test.mjs', 'tests/repo/prettier-ignore.test.mjs']);
});

test('文書でも道具でもテストでもないファイル（LICENSE、.claude-plugin/plugin.json）の変更は全体に倒す', () => {
  const root = tempTree(TREE);
  for (const f of ['LICENSE', '.claude-plugin/plugin.json']) {
    assert.deepEqual(selectTests(root, [f]), { all: true, because: [{ file: f, why: '文書でも道具でもテストでもない' }] }, f);
  }
});

test('変えたファイルが無ければ、テストを選ばない', () => {
  assert.deepEqual(selectTests(tempTree(TREE), []), { all: false, tests: [] });
});

const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
function gitTree(files, branch = 'main') {
  const root = tempTree(files);
  const g = (...a) => {
    const r = spawnSync('git', ['-C', root, ...a], { encoding: 'utf8', env });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout;
  };
  g('init', '-q', '-b', branch);
  g('config', 'user.name', 't');
  g('config', 'user.email', 't@t');
  g('add', '-A');
  g('commit', '-q', '-m', 'init');
  const write = (f, text) => {
    mkdirSync(dirname(join(root, f)), { recursive: true });
    writeFileSync(join(root, f), text);
  };
  return { root, g, write };
}

test('変えたファイルは、main との分岐点から作業ツリーまでの差分（commit 済み、index、未 commit）と未追跡のファイルである', () => {
  const r = gitTree(TREE);
  r.g('switch', '-q', '-c', 'topic');
  r.write('tools/records/trace', '#!/usr/bin/env node\n// committed\n');
  r.g('commit', '-q', '-am', 'topic');
  r.write('tools/records/log', '#!/usr/bin/env node\n// staged\n');
  r.g('add', 'tools/records/log');
  r.write('tools/repo/install', '#!/usr/bin/env bash\n# unstaged\n');
  r.write('docs/new.md', 'untracked\n');
  r.g('mv', 'tools/repo/orphan', 'tools/repo/renamed');
  assert.deepEqual(changedFiles(r.root), ['docs/new.md', 'tools/records/log', 'tools/records/trace', 'tools/repo/install', 'tools/repo/orphan', 'tools/repo/renamed']);
});

test('main が無ければ master との分岐点から見る。どちらも無ければ null で、plan は全体に倒す', () => {
  const m = gitTree(TREE, 'master');
  m.write('tools/records/trace', '#!/usr/bin/env node\n// changed\n');
  assert.deepEqual(changedFiles(m.root), ['tools/records/trace']);
  const none = gitTree(TREE, 'other');
  assert.equal(changedFiles(none.root), null);
  assert.deepEqual(plan(none.root), { out: ['ALL'], explain: ['--changed: main とも master とも分岐点が見つからないので、全体を走らせる'] });
});

test('plan は、選んだ単位を out に、変えたファイルとの対応を explain に出す。全体に倒すときは、どのファイルのせいかを出す', () => {
  const r = gitTree(TREE);
  r.write('tools/records/review', '#!/usr/bin/env node\n// changed\n');
  assert.deepEqual(plan(r.root), {
    out: ['tests/records/review.test.mjs'],
    explain: ['--changed: 変えたファイル 1 件から、1 件のテストを選んだ（lint と索引の検査はいつも走らせる）', '  tests/records/review.test.mjs ← tools/records/review'],
  });
  r.write('knowledge/x.md', 'x\n');
  assert.deepEqual(plan(r.root), { out: ['ALL'], explain: ['--changed: 次のファイルのために全体を走らせる', '  knowledge/x.md（道具が実行時に読む知識ファイルは、依存を静的に辿れない）'] });
});

test('本物のリポジトリで、metrics の変更は metrics のテストを選び、review のテストを選ばない', () => {
  const s = selectTests(repoRoot, ['tools/learning/metrics']);
  assert.equal(s.all, false);
  assert.ok(units(s).includes('tests/learning/metrics.test.mjs'), units(s).join(' '));
  assert.ok(!units(s).some((u) => u.startsWith('tests/records/review')), units(s).join(' '));
});

test('tests/run.sh は知らない引数を 2 で断り、使い方を出す', () => {
  const r = spawnSync('bash', [join(repoRoot, 'tests', 'run.sh'), '--bogus'], { encoding: 'utf8', env });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /使い方: tests\/run.sh \[--changed\]/);
});
