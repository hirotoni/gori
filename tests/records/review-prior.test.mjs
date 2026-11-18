import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { recordsDir } from '../helpers.mjs';
import { ID, workRepo, review, fakeClaude } from './review-helpers.mjs';

// 前回のレビュー結果の節。偽のレビュアーが受け取り口に置いた不合格を review が取り込み、次の依頼文に指摘が載るかを見る。
const PRIOR = '## 前回のレビュー結果（不合格）';
const failWith = (findings) => fakeClaude('pass', { raw: { result: 'fail', evidence: [], findings } }).bin;

test('前回のレビュー結果が無い作業の依頼文に、前回の節は入らない', () => {
  const r = workRepo();
  assert.ok(!review(r.dir, ['--dry-run']).out.includes(PRIOR));
});

test('前回のレビュー結果が不合格なら、次の依頼文に指摘の全部と前回からの差分の読み方が載る（commit が変わっても、同じ commit でも）', () => {
  const r = workRepo();
  const first = r.head();
  assert.equal(review(r.dir, [], { GORI_CLAUDE_BIN: failWith(['指摘その一', '指摘その\n二']) }).status, 1);
  const same = review(r.dir, ['--dry-run']).out;
  assert.ok(same.includes(PRIOR), same);
  assert.ok(same.includes('- 指摘その一') && same.includes('- 指摘その 二'), same);
  writeFileSync(join(r.dir, 'greet.sh'), 'echo "Hello, $1"\n');
  r.g('commit', '-q', '-am', 'fix');
  const next = review(r.dir, ['--dry-run']).out;
  assert.ok(next.includes(PRIOR), next);
  assert.ok(next.includes(`commit ${first}`), next);
  assert.ok(next.includes(`git diff ${first}..${r.head()}`), next);
  assert.ok(next.indexOf(PRIOR) < next.indexOf('## 検証方法'), next);
});

const unverifiedWith = (findings) => fakeClaude('pass', { raw: { result: 'unverified', evidence: ['bash tests/e2e/x.sh: operation not permitted'], findings } }).bin;

test('レビュアーが確認できずを記録すると review は 4 で終わり、次の依頼文に足りなかった材料を確かめる節が載る', () => {
  const r = workRepo();
  const res = review(r.dir, [], { GORI_CLAUDE_BIN: unverifiedWith(['E2E が渡っていない']) });
  assert.equal(res.status, 4, res.out);
  assert.match(res.out, /確認できず/);
  const next = review(r.dir, ['--dry-run']).out;
  assert.ok(next.includes('## 前回のレビュー結果（確認できず）'), next);
  assert.ok(!next.includes(PRIOR), next);
  assert.ok(next.includes('- E2E が渡っていない'), next);
  assert.match(next, /足りなかった材料が今回あるか/);
  assert.match(next, /--result unverified --finding/);
});

test('確認できずが二回続けば、review は三回目のレビュアーを起動せず 4 で止まり、人間に報告するよう示す', () => {
  const r = workRepo();
  assert.equal(review(r.dir, [], { GORI_CLAUDE_BIN: unverifiedWith(['一回目']) }).status, 4);
  assert.equal(review(r.dir, [], { GORI_CLAUDE_BIN: failWith(['間に不合格']) }).status, 1);
  assert.equal(review(r.dir, [], { GORI_CLAUDE_BIN: unverifiedWith(['二回目']) }).status, 4);
  assert.equal(review(r.dir, ['--dry-run']).status, 0, '間に別の結果があれば続けてとは数えない');
  assert.equal(review(r.dir, [], { GORI_CLAUDE_BIN: unverifiedWith(['三回目']) }).status, 4);
  const f = fakeClaude('pass');
  const res = review(r.dir, [], { GORI_CLAUDE_BIN: f.bin });
  assert.equal(res.status, 4, res.out);
  assert.match(res.out, /2 回続けて確認できず.*人間に報告.*三回目/);
  assert.ok(!existsSync(join(dirname(f.bin), 'note.json')), 'レビュアーが起動された');
});

test('受け取り口の unverified に evidence が無ければ取り込まず、未レビューの 3 にする', () => {
  const r = workRepo();
  const res = review(r.dir, [], { GORI_CLAUDE_BIN: fakeClaude('pass', { raw: { result: 'unverified', evidence: [], findings: ['x'] } }).bin });
  assert.equal(res.status, 3, res.out);
  assert.match(res.out, /unverified に findings か evidence が無い/);
});

test('いちばん新しいレビュー結果が合格なら、それより前の不合格は依頼文に載らない', () => {
  const r = workRepo();
  assert.equal(review(r.dir, [], { GORI_CLAUDE_BIN: failWith(['古い指摘']) }).status, 1);
  writeFileSync(join(r.dir, 'greet.sh'), 'echo "Hello, $1"\n');
  r.g('commit', '-q', '-am', 'fix');
  assert.equal(review(r.dir, [], { GORI_CLAUDE_BIN: fakeClaude('pass').bin }).status, 0);
  const out = review(r.dir, ['--dry-run']).out;
  assert.ok(!out.includes(PRIOR) && !out.includes('古い指摘'), out);
});

test('--e2e が無ければ依頼文に E2E の節は入らない', () => {
  const r = workRepo();
  assert.ok(!review(r.dir, ['--dry-run']).out.includes('サンドボックスの外で実行した E2E'));
});

test('範囲の起点は、start 行に記録した作業を始めた時点の HEAD（時刻に依らない）', () => {
  const r = workRepo();
  const rows = readFileSync(join(recordsDir(r.dir), 'audit', `${ID}.tsv`), 'utf8').split('\n');
  const recorded = /base=([0-9a-f]{40})/.exec(rows[1])?.[1];
  assert.ok(recorded, rows[1]);
  const res = review(r.dir, ['--dry-run']);
  assert.ok(res.out.includes(`git diff ${recorded}..${r.head()}`), res.out);
  assert.ok(res.out.includes('start 行に記録した'));
});
