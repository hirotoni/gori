// 無人の作業（docs/design.md の「自律起動」）の印と柵。
// 印は環境変数 GORI_AUTO で、tools/auto/run が claude -p を起動するときに fenceEnv で付ける。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// 値は見ない。空でも 0 でも、変数があれば無人として扱う。値を読み違えて柵を外さないためである。
export const isAuto = (env = process.env) => Object.hasOwn(env, 'GORI_AUTO');

// 無人の作業が人間の決定に当たる操作をしようとしたら、書かずに終える。
export function refuseIfAuto(what, env = process.env) {
  if (!isAuto(env)) return;
  console.error(`auto-fence: 無人の作業（GORI_AUTO）は ${what} をできない。人間が決める操作なので、止まって人間に知らせる`);
  process.exit(1);
}

// 無人の作業に渡す環境。git には、柵のフックの置き場所をコマンドの設定として渡す。
// リポジトリの設定を書き換えないので、どのリポジトリでも導入なしで効き、人間の作業はこのフックを読まない。
export function fenceEnv(goriRoot, env = process.env) {
  const n = Number.parseInt(env.GIT_CONFIG_COUNT ?? '0', 10);
  const i = Number.isInteger(n) && n > 0 ? n : 0;
  return {
    ...env,
    GORI_AUTO: '1',
    GIT_CONFIG_COUNT: String(i + 1),
    [`GIT_CONFIG_KEY_${i}`]: 'core.hooksPath',
    [`GIT_CONFIG_VALUE_${i}`]: join(goriRoot, 'tools', 'auto', 'githooks'),
  };
}

// 無人の作業の上限と見回りの間隔（knowledge/config/auto.md の表）。読めないか、行が欠けるか、正の数でなければ、推測せず失敗する。上限なしで起動しないためである。
const LIMIT_KEYS = ['run-minutes', 'worker-budget-usd', 'reviewer-budget-usd', 'runs-per-day', 'watch-minutes'];
const LIMIT_ROW = /^\|\s*([a-z][a-z0-9-]*)\s*\|\s*([0-9]+(?:\.[0-9]+)?)\s*\|\s*$/;
export function parseLimits(text) {
  const table = new Map();
  for (const line of text.split('\n')) {
    const m = LIMIT_ROW.exec(line);
    if (m) table.set(m[1], Number(m[2]));
  }
  return table;
}
export function autoLimits(root) {
  const path = join(root, 'knowledge', 'config', 'auto.md');
  let table;
  try {
    table = parseLimits(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new Error(`${path} を読めない: ${e.message}`);
  }
  const out = {};
  for (const k of LIMIT_KEYS) {
    const v = table.get(k);
    if (!(v > 0)) throw new Error(`${path} に「| ${k} | <正の数> |」の行がない`);
    out[k] = v;
  }
  if (!Number.isInteger(out['runs-per-day'])) throw new Error(`${path} の runs-per-day は整数にする`);
  return out;
}

// サブスクリプションより優先される認証と、送り先を変える環境変数。無人の作業が従量課金に切り替わらないよう、起動の前に取り除く。
export const BILLING_ENV = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY', 'ANTHROPIC_BASE_URL'];
