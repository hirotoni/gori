import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { repoRoot } from '../helpers.mjs';

const lib = pathToFileURL(join(repoRoot, 'tools', 'lib', 'args.mjs')).href;
// parseArgs は誤りで process.exit(2) するので、別のプロセスで呼ぶ。
function parse(argv, spec) {
  const code = `import { parseArgs } from ${JSON.stringify(lib)}; console.log(JSON.stringify(parseArgs(${JSON.stringify(argv)}, ${JSON.stringify(spec)}, 'USAGE')));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' });
  return { status: r.status, out: r.stdout + r.stderr, value: r.status === 0 ? JSON.parse(r.stdout) : null };
}
const SPEC = { value: ['what'], repeat: ['evidence'], bool: ['json'] };

test('表のフラグを読み、繰り返せるフラグは配列に、値を取らないフラグは true に、残りは位置引数にする', () => {
  const r = parse(['a', '--what', 'x', '--evidence', 'e1', '--json', '--evidence', '--- e2', 'b'], SPEC);
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(r.value, { flags: { evidence: ['e1', '--- e2'], what: 'x', json: true }, positional: ['a', 'b'] });
  assert.deepEqual(parse([], SPEC).value, { flags: { evidence: [] }, positional: [] });
});

test('知らないフラグと値の無いフラグは 2 で止め、使い方を示す', () => {
  for (const [argv, msg] of [
    [['--wht', 'x'], /知らないフラグ --wht/],
    [['--what'], /--what に値が無い/],
    [['--what', '--json'], /--what に値が無い/],
    [['--evidence', '--what', 'x'], /--evidence に値が無い/],
    [['--what', '--evidnce', 'y'], /--what に値が無い/],
    [['--what', '--x2-y'], /--what に値が無い/],
  ]) {
    const r = parse(argv, SPEC);
    assert.equal(r.status, 2, r.out);
    assert.match(r.out, msg);
    assert.match(r.out, /USAGE/);
  }
});

test('フラグの形でない -- で始まる語は値として読む', () => {
  for (const v of ['-----BEGIN KEY', '--- 区切り', '--', '--X', '--1a', '--a b', '--a_b']) { // check-public: allow-secret（検査のための偽の値）
    const r = parse(['--what', v], SPEC);
    assert.equal(r.status, 0, `${v}: ${r.out}`);
    assert.equal(r.value.flags.what, v);
  }
});

// レビューで見つかった、綴りを誤ったフラグが値として読まれる例。
for (const [rel, args, flag] of [
  ['tools/records/log', ['add', '--task', '20261111-000000-x', '--type', 'decision', '--what', '--evidnce', 'y'], '--what'],
  ['tools/records/trace', ['20261111-000000-x', '--repo', '--txt'], '--repo'],
  ['tools/learning/sessions', ['--projects', '--outside-task'], '--projects'],
]) {
  test(`${rel} は ${args.join(' ')} を ${flag} の値が無いとして 2 で断る`, () => {
    const r = tool(rel, args);
    assert.equal(r.status, 2, r.out);
    assert.match(r.out, new RegExp(`${flag} に値が無い`));
  });
}

// 道具ごとに、知らないフラグで 2 を返し、知らないフラグの名前を示すこと。
const tool = (rel, args) => {
  const cwd = mkdtempSync(join(tmpdir(), 'gori-args-'));
  const r = spawnSync(process.execPath, [join(repoRoot, rel), ...args], { cwd, encoding: 'utf8', env: { ...process.env, GORI_HOME: cwd } });
  return { status: r.status, out: r.stdout + r.stderr };
};
for (const [rel, args, flag] of [
  ['tools/learning/case', ['count', '--pattern', 'p', '--mn', '2'], '--mn'],
  ['tools/records/log', ['add', '--task', '20261111-000000-x', '--type', 'decision', '--what', 'x', '--evidnce', 'y'], '--evidnce'],
  ['tools/records/verdict', ['check', '--task', '20261111-000000-x', '--shaa', 'HEAD'], '--shaa'],
  ['tools/records/review', ['--task', '20261111-000000-x', '--dryrun'], '--dryrun'],
  ['tools/records/trace', ['20261111-000000-x', '--txt'], '--txt'],
  ['tools/learning/sessions', ['--unprocesed'], '--unprocesed'],
  ['tools/records/usage', ['--snce', '2026-11-01'], '--snce'],
]) {
  test(`${rel} は知らないフラグ ${flag} を 2 で断る`, () => {
    const r = tool(rel, args);
    assert.equal(r.status, 2, r.out);
    assert.match(r.out, new RegExp(`知らないフラグ ${flag}`));
  });
}

test('verdict と review は、余った位置引数を 2 で断る', () => {
  for (const [rel, args] of [
    ['tools/records/verdict', ['check', '--task', '20261111-000000-x', 'extra']],
    ['tools/records/review', ['--task', '20261111-000000-x', 'extra']],
  ]) {
    const r = tool(rel, args);
    assert.equal(r.status, 2, r.out);
    assert.match(r.out, /引数 extra を読めない/);
  }
});
