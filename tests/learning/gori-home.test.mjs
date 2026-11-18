import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { repoRoot } from '../helpers.mjs';

// 状態の置き場所は、GORI_HOME、XDG_STATE_HOME/gori、~/.local/state/gori の順に決まり、フックと抽出の起動が同じ場所を使う。
// HOME は一時ディレクトリに差し替え、利用者のホームに書かない。
const HOOK = join(repoRoot, 'tools', 'hooks', 'session-end');
const RUN = join(repoRoot, 'tools', 'learning', 'extract-run');
const LIB = join(repoRoot, 'tools', 'lib', 'learning.mjs');
const tmp = (p) => mkdtempSync(join(tmpdir(), p));
const env = (extra) => ({
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_') && !k.startsWith('CLAUDE') && !k.startsWith('GORI_') && k !== 'XDG_STATE_HOME')),
  ...extra,
});

// 三通りの環境と、そのとき使われるはずの置き場所。
function cases() {
  const home = tmp('gori-home-home-');
  const xdg = tmp('gori-home-xdg-');
  const explicit = tmp('gori-home-explicit-');
  return [
    { name: 'どちらも無い', env: { HOME: home }, want: join(home, '.local', 'state', 'gori') },
    { name: 'XDG_STATE_HOME', env: { HOME: home, XDG_STATE_HOME: xdg }, want: join(xdg, 'gori') },
    { name: 'XDG_STATE_HOME が相対パス', env: { HOME: home, XDG_STATE_HOME: 'rel/state' }, want: join(home, '.local', 'state', 'gori') },
    { name: 'GORI_HOME が優先', env: { HOME: home, XDG_STATE_HOME: xdg, GORI_HOME: explicit }, want: explicit },
  ].map((c) => ({ ...c, home }));
}

test('goriHome は GORI_HOME、XDG_STATE_HOME/gori、~/.local/state/gori の順に決まる', () => {
  for (const c of cases()) {
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', `import { goriHome } from ${JSON.stringify(LIB)}; console.log(goriHome());`], { encoding: 'utf8', env: env(c.env) });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), c.want, c.name);
  }
});

test('SessionEnd フックは起動しない理由のログを goriHome の logs/ に書き、ホームの直下に .gori を作らない', () => {
  for (const c of cases()) {
    // 抽出は起動させない（ルートを gori でないディレクトリに向ける）。
    const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ session_id: 'sid-x', hook_event_name: 'SessionEnd' }), encoding: 'utf8', env: env({ ...c.env, GORI_ROOT: tmp('gori-home-notgori-') }) });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(readdirSync(join(c.want, 'logs')).some((n) => n.startsWith('extract-')), `${c.name}: ${c.want}/logs にログが無い`);
    assert.ok(!existsSync(join(c.home, '.gori')), `${c.name}: ~/.gori ができた`);
  }
});

test('extract-run は起動しない理由のログを goriHome の logs/ に書く', () => {
  for (const c of cases()) {
    const r = spawnSync(process.execPath, [RUN], { cwd: tmpdir(), encoding: 'utf8', env: env({ ...c.env, CLAUDE_PLUGIN_ROOT: tmp('gori-home-cache-'), GORI_CLAUDE_BIN: '/nonexistent' }) });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(readdirSync(join(c.want, 'logs')).some((n) => n.startsWith('extract-')), `${c.name}: ${c.want}/logs にログが無い`);
    assert.ok(!existsSync(join(c.home, '.gori')), `${c.name}: ~/.gori ができた`);
  }
});
