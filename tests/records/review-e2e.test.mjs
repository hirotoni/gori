import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { recordsDir } from '../helpers.mjs';
import { workRepo, review, fakeClaude } from './review-helpers.mjs';

// --e2e: review がサンドボックスの外で E2E を走らせ、結果をレビュアーに渡す。
function withE2E(script) {
  const r = workRepo();
  mkdirSync(join(r.dir, 'tests', 'e2e'), { recursive: true });
  writeFileSync(join(r.dir, 'tests', 'e2e', 'probe.sh'), script);
  r.g('add', '-A');
  r.g('commit', '-q', '-m', 'e2e');
  return r;
}
const PROBE = `echo "pwd=$(pwd -P)"
echo "tree-dirty=$(test -e dirty.txt && echo yes || echo no)"
echo "env GIT_DIR=\${GIT_DIR-unset} SID=\${CLAUDE_CODE_SESSION_ID-unset} SID2=\${CLAUDE_SESSION_ID-unset} CHILD=\${CLAUDE_CODE_CHILD_SESSION-unset} WORK=\${GORI_WORK_REPO-unset} OUTBOX=\${GORI_VERDICT_OUTBOX-unset}"
echo "to-stderr" >&2
exit 3
`;

test('--e2e: レビューする commit の別の worktree で、環境を掃除して実行し、依頼文に節が入り、全出力がレビュアーの worktree にある', () => {
  const r = withE2E(PROBE);
  // 作業者の作業ツリーにだけあるファイル（verdict record の dirty 検査に掛からないよう exclude に入れる）
  writeFileSync(join(r.dir, '.git', 'info', 'exclude'), 'dirty.txt\n');
  writeFileSync(join(r.dir, 'dirty.txt'), 'x');
  const f = fakeClaude('pass');
  const res = review(r.dir, ['--e2e', 'tests/e2e/probe.sh'], {
    GORI_CLAUDE_BIN: f.bin, CLAUDE_CODE_SESSION_ID: 'worker-1', CLAUDE_SESSION_ID: 'w2', CLAUDE_CODE_CHILD_SESSION: '1',
    GIT_AUTHOR_NAME: 'x', GORI_VERDICT_OUTBOX: '/nonexistent',
  });
  assert.equal(res.status, 0, res.out);
  const n = f.note();
  assert.ok(n.prompt.includes('## review がサンドボックスの外で実行した E2E'));
  assert.ok(n.prompt.includes('tests/e2e/probe.sh'));
  assert.ok(n.prompt.includes('終了コード: 3'), n.prompt);
  assert.ok(n.prompt.includes(`git diff ${r.g('rev-list', '--max-parents=0', 'HEAD').stdout.trim()}..${r.head()} -- tests/e2e/probe.sh`));
  const logPath = /全出力（標準出力と標準エラー）のファイル: (\S+)/.exec(n.prompt)[1];
  assert.ok(logPath.endsWith('/.gori-e2e/tests__e2e__probe.sh.log'), logPath);
  assert.equal(n.e2eLogs.length, 1, 'レビュアーの起動時に、その worktree の .gori-e2e/ に全出力のファイルがある');
  assert.ok(n.e2eLogs[0][1].includes('to-stderr') && n.e2eLogs[0][1].includes('tree-dirty=no'));
  const copies = readdirSync(join(recordsDir(r.dir), 'reviews')).filter((x) => x.endsWith('.log'));
  assert.equal(copies.length, 1);
  const log = readFileSync(join(recordsDir(r.dir), 'reviews', copies[0]), 'utf8');
  assert.ok(log.includes('tree-dirty=no'), log);
  assert.ok(log.includes('to-stderr'), log);
  assert.ok(log.includes('env GIT_DIR=unset SID=unset SID2=unset CHILD=unset WORK=unset OUTBOX=unset'), log);
  const pwd = /pwd=(\S+)/.exec(log)[1]; // check-public: allow-secret（検査のための偽の値）
  assert.notEqual(pwd, realpathSync(r.dir));
  assert.ok(!n.cwd.includes(pwd) && !pwd.includes(n.cwd.split('/').pop()));
  assert.ok(!existsSync(pwd), 'E2E 用の worktree が残っている');
  assert.equal(r.g('worktree', 'list').stdout.trim().split('\n').length, 1);
});

test('--e2e: zsh の shebang と zsh 専用の構文のスクリプトは zsh で走り、依頼文の節に終了コード 0 で載る', { skip: spawnSync('zsh', ['-c', 'true']).status !== 0 && 'zsh が無い' }, () => {
  const r = withE2E('#!/usr/bin/env zsh\nx=abc\necho "up=${(U)x}"\n');
  const f = fakeClaude('pass');
  const res = review(r.dir, ['--e2e', 'tests/e2e/probe.sh'], { GORI_CLAUDE_BIN: f.bin });
  assert.equal(res.status, 0, res.out);
  assert.ok(f.note().prompt.includes('終了コード: 0'), f.note().prompt);
  assert.ok(f.note().e2eLogs[0][1].includes('up=ABC'));
});

test('--e2e: shebang の解釈器の引数（#!/bin/bash -e の -e）も渡り、失敗したコマンドで止まる', () => {
  const r = withE2E('#!/bin/bash -e\necho before\nfalse\necho after\n');
  const f = fakeClaude('pass');
  const res = review(r.dir, ['--e2e', 'tests/e2e/probe.sh'], { GORI_CLAUDE_BIN: f.bin });
  assert.equal(res.status, 0, res.out);
  assert.ok(f.note().prompt.includes('終了コード: 1'), f.note().prompt);
  const log = f.note().e2eLogs[0][1];
  assert.ok(log.includes('before') && !log.includes('after'), log);
});

test('--e2e: env -S の後ろの引数（#!/usr/bin/env -S zsh -f の -f）も解釈器に渡る', { skip: spawnSync('zsh', ['-c', 'true']).status !== 0 && 'zsh が無い' }, () => {
  const r = withE2E('#!/usr/bin/env -S zsh -f\n[[ -o rcs ]] && echo rcs=on || echo rcs=off\n');
  const f = fakeClaude('pass');
  const res = review(r.dir, ['--e2e', 'tests/e2e/probe.sh'], { GORI_CLAUDE_BIN: f.bin });
  assert.equal(res.status, 0, res.out);
  assert.ok(f.note().e2eLogs[0][1].includes('rcs=off'), f.note().e2eLogs[0][1]);
});

test('--e2e: 知らない解釈器の shebang は、レビュアーを起動せず 0 以外で止まる', () => {
  const r = withE2E('#!/usr/bin/env python3\nprint(1)\n');
  const f = fakeClaude('pass');
  const res = review(r.dir, ['--e2e', 'tests/e2e/probe.sh'], { GORI_CLAUDE_BIN: f.bin });
  assert.notEqual(res.status, 0, res.out);
  assert.ok(res.out.includes('python3'), res.out);
  assert.ok(!existsSync(join(dirname(f.bin), 'note.json')), 'レビュアーが起動された');
});

test('--e2e: スクリプトがレビューする commit に無ければ、レビュアーを起動せず 2', () => {
  const r = withE2E('exit 0\n');
  const f = fakeClaude('pass');
  const res = review(r.dir, ['--e2e', 'tests/e2e/none.sh'], { GORI_CLAUDE_BIN: f.bin });
  assert.equal(res.status, 2, res.out);
  assert.ok(res.out.includes('tests/e2e/none.sh'));
  assert.ok(!existsSync(join(dirname(f.bin), 'note.json')), 'レビュアーが起動された');
});

test('--e2e: 時間の上限を超えたら止めて、その事実を結果に書く', () => {
  const r = withE2E('sleep 30\n');
  const f = fakeClaude('pass');
  const t0 = Date.now();
  const res = review(r.dir, ['--e2e', 'tests/e2e/probe.sh'], { GORI_CLAUDE_BIN: f.bin, GORI_E2E_TIMEOUT_SEC: '1' });
  assert.ok(Date.now() - t0 < 20000);
  assert.equal(res.status, 0, res.out);
  assert.ok(f.note().prompt.includes('時間の上限 1 秒を超えたため止めた'));
  assert.equal(r.g('worktree', 'list').stdout.trim().split('\n').length, 1);
});

test('--e2e: --dry-run は実行する E2E の一覧を出し、実行しない', () => {
  const r = withE2E('touch ran.txt\n');
  const res = review(r.dir, ['--dry-run', '--e2e', 'tests/e2e/probe.sh']);
  assert.equal(res.status, 0, res.out);
  assert.ok(res.out.includes('# 実行する E2E'));
  assert.ok(res.out.includes('- tests/e2e/probe.sh'));
  assert.ok(res.out.includes('## review がサンドボックスの外で実行した E2E'));
  assert.ok(!existsSync(join(recordsDir(r.dir), 'reviews')));
});
