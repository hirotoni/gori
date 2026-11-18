import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from '../helpers.mjs';

// 編集の後に作業ツリーのルートで prettier を走らせるフックが、知識ファイルの frontmatter と索引を崩さないように、knowledge/ を整形から外している。
// フックそのものを走らせる確認は tests/e2e/formatter-keeps-units.sh にある。ここでは除外の指定が残っていることだけを見る。
test('.prettierignore が knowledge/ を整形から外している', () => {
  const path = join(repoRoot, '.prettierignore');
  assert.ok(existsSync(path), '.prettierignore が無い');
  const lines = readFileSync(path, 'utf8').split('\n').map((l) => l.trim());
  assert.ok(lines.includes('knowledge/'), '.prettierignore に knowledge/ の行が無い');
});

function hasPrettier() {
  try {
    execFileSync('prettier', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

test('prettier が knowledge/ の知識ファイルと索引を無視すると答える', { skip: hasPrettier() ? false : 'prettier が PATH に無い' }, () => {
  const files = execFileSync('git', ['ls-files', '-z', '--', 'knowledge/*.md'], { cwd: repoRoot, encoding: 'utf8' }).split('\0').filter(Boolean);
  assert.ok(files.length > 0, 'knowledge/ に .md が無い');
  for (const f of files) {
    const out = execFileSync('prettier', ['--file-info', f], { cwd: repoRoot, encoding: 'utf8' });
    assert.equal(JSON.parse(out).ignored, true, `${f} が prettier の整形の対象になっている`);
  }
});
