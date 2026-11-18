import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { repoRoot } from '../helpers.mjs';
import { LIMITS, LOG, TASK, cleanEnv, fakeClaude, fakeGori, item, put, records, run, setup, tmp, workRepo } from './helpers.mjs';

test('上限の表が無いか、行が欠けていれば、何も起動せず 2 で終わる', () => {
  for (const limits of [null, { ...LIMITS, 'runs-per-day': 0 }, Object.fromEntries(Object.entries(LIMITS).filter(([k]) => k !== 'worker-budget-usd'))]) {
    const s = setup('idle', limits);
    const r = run(s.gori, s.fake);
    assert.equal(r.status, 2, r.out);
    assert.equal(r.result, 'failed');
    assert.match(r.out, /設定を読めないので起動しない/);
    assert.equal(s.fake.launched(), false);
    assert.deepEqual(records(s.gori), []);
  }
});

test('選べる todo が無ければ、何も起動せず 0 で終わる。proposed と done は選ばない', () => {
  const gori = fakeGori();
  workRepo(gori);
  item(gori, 'app', '20261108-090000-p', 'proposed');
  item(gori, 'app', '20261108-090001-d', 'done');
  const fake = fakeClaude();
  const r = run(gori, fake);
  assert.equal(r.status, 0, r.out);
  assert.equal(r.result, 'none');
  assert.equal(fake.launched(), false);
  assert.deepEqual(records(gori), []);
});

test('kind が learning でない todo の一件は選ばない。improvement と procedure だけなら何も起動しない', () => {
  const gori = fakeGori();
  workRepo(gori);
  item(gori, 'app', '20261108-090000-imp', 'todo', 'improvement');
  item(gori, 'app', '20261108-090001-proc', 'todo', 'procedure');
  const fake = fakeClaude();
  const r = run(gori, fake);
  assert.equal(r.status, 0, r.out);
  assert.equal(r.result, 'none');
  assert.equal(fake.launched(), false);
  assert.deepEqual(records(gori), []);
  // 学びが混ざっていれば、起票が新しくても学びを選ぶ。
  const lesson = item(gori, 'app', '20261109-090000-lesson', 'todo', 'learning');
  const second = fakeClaude();
  assert.equal(run(gori, second).status, 0);
  assert.equal(second.note().id, lesson);
});

test('全リポジトリの todo から起票が古い一件を選び、そのリポジトリで起動する', () => {
  const gori = fakeGori();
  workRepo(gori, 'app');
  const web = workRepo(gori, 'web');
  item(gori, 'app', '20261109-090000-newer');
  const old = item(gori, 'web', '20261108-090000-older');
  const fake = fakeClaude();
  const r = run(gori, fake);
  assert.equal(r.status, 0, r.out);
  assert.equal(fake.note().id, old);
  assert.equal(fake.note().cwd, web);
  assert.equal(records(gori)[0].pool, `web/${old}`);
});

test('pool:<ID> の受け入れ条件の行を持ち done の無い作業がある一件は選ばない。取り下げた行は数えない', () => {
  const gori = fakeGori();
  const repo = workRepo(gori);
  const taken = item(gori, 'app', '20261108-090000-taken');
  const free = item(gori, 'app', '20261109-090000-free');
  const env = cleanEnv({ GORI_ROOT: gori });
  const log = (...a) => {
    const r = spawnSync(process.execPath, [LOG, ...a], { cwd: repo, encoding: 'utf8', env });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout;
  };
  log('start', '--task', TASK, '--what', '目的');
  const line = Number(/:(\d+)\s*$/.exec(log('add', '--task', TASK, '--type', 'accept', '--what', `pool:${taken}`))[1]);
  const first = fakeClaude();
  assert.equal(run(gori, first).status, 0);
  assert.equal(first.note().id, free, '着手済みの一件を飛ばす');
  // 取り下げれば、着手済みに数えない。
  log('add', '--task', TASK, '--type', 'fix', '--what', `行 ${line} を取り下げ: 方針が変わった`);
  const second = fakeClaude();
  assert.equal(run(gori, second).status, 0);
  assert.equal(second.note().id, taken);
});

test('pool:<ID> の受け入れ条件の行を持つ作業に done があれば、その一件を選ぶ', () => {
  const gori = fakeGori();
  const repo = workRepo(gori);
  const id = item(gori, 'app', '20261108-090000-finished');
  for (const a of [['start', '--task', TASK, '--what', '目的'], ['add', '--task', TASK, '--type', 'accept', '--what', `pool:${id}`], ['add', '--task', TASK, '--type', 'done', '--what', '終えた']]) {
    const r = spawnSync(process.execPath, [LOG, ...a], { cwd: repo, encoding: 'utf8', env: cleanEnv({ GORI_ROOT: gori }) });
    assert.equal(r.status, 0, r.stderr);
  }
  const fake = fakeClaude();
  assert.equal(run(gori, fake).status, 0);
  assert.equal(fake.note().id, id);
});

test('二つ目の起動は何も起動せずに終わり、持ち主が死んでいるロックは取り除いて起動する', async () => {
  const s = setup('idle');
  const lock = join(s.gori, '.git', 'gori', 'auto', 'run.lock');
  put(lock, `${process.pid}\n`);
  const held = run(s.gori, s.fake);
  assert.equal(held.status, 0, held.out);
  assert.equal(held.result, 'locked');
  assert.equal(s.fake.launched(), false);
  const dead = spawn(process.execPath, ['-e', '']);
  await new Promise((done) => dead.on('close', done));
  put(lock, `${dead.pid}\n`);
  const r = run(s.gori, s.fake);
  assert.equal(r.status, 0, r.out);
  assert.equal(s.fake.launched(), true);
  assert.equal(existsSync(lock), false, '終わったらロックを消す');
});

test('ログインが claude.ai のサブスクリプションだと確かめられなければ起動しない', () => {
  for (const auth of [{ loggedIn: true, authMethod: 'apiKey', apiProvider: 'firstParty' }, { loggedIn: false }, { loggedIn: true, authMethod: 'claude.ai', apiProvider: 'bedrock' }, 'not json']) {
    const s = setup('idle');
    const fake = fakeClaude('idle', { auth });
    const r = run(s.gori, fake);
    assert.equal(r.status, 1, r.out);
    assert.equal(r.result, 'failed');
    assert.equal(fake.launched(), false);
    const [rec] = records(s.gori);
    assert.deepEqual([rec.outcome, rec.launched, rec.pool], ['failed', false, `app/${s.id}`], '起動しなかった失敗も記録に残す');
    assert.match(rec.reason, /^起動しなかった: /);
    assert.ok(rec.started && rec.finished);
  }
});

test('起動しなかった失敗の記録は、一日の回数に数えない', () => {
  const s = setup('idle', { ...LIMITS, 'runs-per-day': 1 });
  for (let i = 0; i < 2; i++) assert.equal(run(s.gori, fakeClaude('idle', { auth: { loggedIn: false } })).result, 'failed');
  assert.equal(records(s.gori).length, 2);
  const ok = fakeClaude();
  assert.equal(run(s.gori, ok).result, 'stopped', '起動しなかった二回は数えず、一回目として起動する');
  assert.equal(ok.launched(), true);
  assert.equal(run(s.gori, fakeClaude()).result, 'daily-limit');
});

test('設定に apiKeyHelper があれば起動しない。利用者の設定でも、リポジトリの設定でも止まる', () => {
  const user = setup('idle');
  const config = tmp('gori-run-config-');
  put(join(config, 'settings.json'), '{"apiKeyHelper":"/bin/echo k"}');
  const a = run(user.gori, user.fake, { env: { CLAUDE_CONFIG_DIR: config } });
  assert.equal(a.status, 1, a.out);
  assert.match(a.out, /apiKeyHelper がある/);
  assert.equal(user.fake.launched(), false);
  const proj = setup('idle');
  put(join(proj.repo, '.claude', 'settings.local.json'), '{"apiKeyHelper":"x"}');
  const b = run(proj.gori, proj.fake);
  assert.equal(b.status, 1, b.out);
  assert.equal(proj.fake.launched(), false);
});

test('起動の形: 柵と上限と gh の未ログインと main を進めない指定を付け、従量課金に切り替わる環境変数を取り除く', () => {
  const s = setup('idle');
  const r = run(s.gori, s.fake, { env: { ANTHROPIC_API_KEY: 'k', ANTHROPIC_AUTH_TOKEN: 't', CLAUDE_CODE_USE_BEDROCK: '1', CLAUDE_CODE_USE_VERTEX: '1', CLAUDE_CODE_USE_FOUNDRY: '1', ANTHROPIC_BASE_URL: 'http://x', GH_TOKEN: 'g', GITHUB_TOKEN: 'g', CLAUDE_CODE_SESSION_ID: 'parent' } });
  assert.equal(r.status, 0, r.out);
  const n = s.fake.note();
  assert.equal(n.cwd, s.repo);
  assert.deepEqual(n.leaked, []);
  assert.equal(n.auto, '1');
  assert.deepEqual([n.hooksKey, n.hooks], ['core.hooksPath', join(repoRoot, 'tools', 'auto', 'githooks')]);
  assert.equal(n.ghEmpty, true);
  assert.equal(n.ignoreUpstream, '1');
  const arg = (name) => n.args[n.args.indexOf(name) + 1];
  assert.equal(n.args[0], '-p');
  assert.match(n.args[1], new RegExp(`pool:${s.id}`));
  assert.equal(arg('--model'), 'sonnet');
  assert.equal(arg('--max-budget-usd'), '10');
  assert.equal(arg('--output-format'), 'json');
  assert.ok(n.args.includes('Bash(git push *)') && n.args.includes('Bash(gh pr create *)'));
});

test('時間の上限を過ぎたら止め、失敗として残す', () => {
  const s = setup('sleep', { ...LIMITS, 'run-minutes': 0.01 });
  const r = run(s.gori, s.fake);
  assert.equal(r.status, 1, r.out);
  assert.equal(r.result, 'failed');
  const [rec] = records(s.gori);
  assert.equal(rec.outcome, 'failed');
  assert.match(rec.reason, /時間の上限 0\.01 分を超えたので止めた/);
});

test('その日の起動が上限に達していれば、何も起動せずに終わる。前の日の記録は数えない', () => {
  const s = setup('idle', { ...LIMITS, 'runs-per-day': 2 });
  const runs = join(s.gori, '.git', 'gori', 'auto', 'runs');
  put(join(runs, '20200101-000000-1.json'), '{}');
  assert.equal(run(s.gori, fakeClaude()).result, 'stopped');
  assert.equal(run(s.gori, fakeClaude()).result, 'stopped');
  const third = fakeClaude();
  const r = run(s.gori, third);
  assert.equal(r.status, 0, r.out);
  assert.equal(r.result, 'daily-limit');
  assert.equal(third.launched(), false);
  assert.equal(readdirSync(runs).length, 3);
});

test('実行の記録に、選んだ一件、終わり方、金額、かかった時間を残す。合格は pass、合格せずに終われば stopped', () => {
  const p = setup('pass');
  const r = run(p.gori, p.fake);
  assert.equal(r.status, 0, r.out);
  assert.equal(r.result, 'pass');
  const [rec] = records(p.gori);
  assert.deepEqual([rec.pool, rec.outcome, rec.task, rec.cost_usd, rec.exit, rec.subtype, rec.session, rec.verdict], [`app/${p.id}`, 'pass', TASK, 1.25, 0, 'success', 'sess-1', 0]);
  assert.equal(typeof rec.seconds, 'number');
  assert.ok(rec.started && rec.finished);
  assert.ok(!JSON.stringify(rec).includes('CONVERSATION-TEXT'), '会話の中身は写さない');
  const st = setup('stop');
  const stopped = run(st.gori, st.fake);
  assert.equal(stopped.status, 0, stopped.out);
  assert.equal(stopped.result, 'stopped');
  assert.deepEqual([records(st.gori)[0].outcome, records(st.gori)[0].task, records(st.gori)[0].verdict], ['stopped', TASK, 3]);
});

test('0 以外の終了と、金額の上限での停止は、失敗として残す', () => {
  const e = setup('exit3');
  const r = run(e.gori, e.fake);
  assert.equal(r.status, 1, r.out);
  assert.deepEqual([records(e.gori)[0].outcome, records(e.gori)[0].exit], ['failed', 3]);
  assert.match(records(e.gori)[0].reason, /終了コード 3/);
  const b = setup('budget');
  const rb = run(b.gori, b.fake);
  assert.equal(rb.status, 1, rb.out);
  assert.deepEqual([records(b.gori)[0].outcome, records(b.gori)[0].subtype], ['failed', 'error_max_budget_usd']);
  assert.match(records(b.gori)[0].reason, /金額の上限 10 ドルに達して止まった/);
});

test('起動の前と後で、本体のチェックアウトの main か未 commit の変更が違えば、失敗として残す', () => {
  const m = setup('move-main');
  const r = run(m.gori, m.fake);
  assert.equal(r.status, 1, r.out);
  assert.match(records(m.gori)[0].reason, /main が動いた/);
  const d = setup('dirty');
  const rd = run(d.gori, d.fake);
  assert.equal(rd.status, 1, rd.out);
  assert.match(records(d.gori)[0].reason, /未 commit の変更が、起動の前と違う/);
});

test('--dry-run は選ぶ一件とコマンドを示し、何も起動せず、記録もロックも作らない', () => {
  const s = setup('idle');
  const r = run(s.gori, s.fake, { args: ['--dry-run'] });
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, new RegExp(`選べる todo: 1 件（app/${s.id}）`));
  assert.match(r.out, /"--max-budget-usd" "10"/);
  assert.equal(s.fake.launched(), false);
  assert.equal(existsSync(join(s.gori, '.git', 'gori', 'auto')), false);
});

test('受け入れ条件の行を書く前に pause で止まった作業も、実行の記録に作業 ID を残し、次の run はその一件を選ばない。done を書けば選ぶ', () => {
  const s = setup('pause-early');
  const later = item(s.gori, 'app', '20261109-090000-later');
  const r = run(s.gori, s.fake);
  assert.equal(r.status, 0, r.out);
  assert.equal(r.result, 'stopped');
  const [rec] = records(s.gori);
  assert.deepEqual([rec.pool, rec.session], [`app/${s.id}`, 'worker-1']);
  assert.match(rec.task ?? '', /^\d{8}-\d{6}-auto-early$/);
  assert.match(rec.reason, /^受け入れ条件の行を書く前に止まった。レビューに合格せずに終わった/);
  const next = fakeClaude();
  assert.equal(run(s.gori, next).status, 0);
  assert.equal(next.note().id, later, '止まって人間を待っている一件を選び直さない');
  const l = spawnSync(process.execPath, [LOG, 'add', '--task', rec.task, '--type', 'done', '--what', '人間が対応した'], { cwd: s.repo, encoding: 'utf8', env: cleanEnv({ GORI_ROOT: s.gori }) });
  assert.equal(l.status, 0, l.stderr);
  const third = fakeClaude();
  assert.equal(run(s.gori, third).status, 0);
  assert.equal(third.note().id, s.id, 'done の後は選ぶ');
});

test('作業を一つも始めずに終わった実行は、作業 ID を残さず、次の run は同じ一件を選ぶ', () => {
  const s = setup('idle');
  assert.equal(run(s.gori, s.fake).result, 'stopped');
  const [rec] = records(s.gori);
  assert.deepEqual([rec.task, rec.reason], [null, 'この一件を指す作業が始まらずに終わった']);
  const next = fakeClaude();
  assert.equal(run(s.gori, next).status, 0);
  assert.equal(next.note().id, s.id);
});

test('担当に渡す --plugin-dir は、記録の場所の下に置いた gori の main の worktree で、次の実行では main の先端に合わせ、残したファイルを消す', () => {
  const s = setup('idle');
  const plugin = join(s.gori, '.git', 'gori', 'auto', 'plugin');
  assert.equal(run(s.gori, s.fake).status, 0);
  const arg = (n, name) => n.args[n.args.indexOf(name) + 1];
  assert.equal(arg(s.fake.note(), '--plugin-dir'), plugin);
  const head = (dir) => spawnSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  assert.equal(head(plugin), head(s.gori));
  assert.ok(!join(s.gori, '.worktree', 'x').startsWith(`${plugin}/`), '担当の worktree の置き場所を含まない');
  put(join(plugin, 'left.txt'), 'x');
  spawnSync('git', ['-C', s.gori, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'next'], { env: cleanEnv() });
  const next = fakeClaude();
  assert.equal(run(s.gori, next).status, 0);
  assert.equal(arg(next.note(), '--plugin-dir'), plugin);
  assert.equal(head(plugin), head(s.gori), 'main の先端に合わせる');
  assert.equal(existsSync(join(plugin, 'left.txt')), false, '前の担当が残したファイルを消す');
});

test('gori の main を読めず、担当に渡すプラグインを用意できなければ、起動せずに失敗として残し、一日の回数に数えない', () => {
  const s = setup('idle');
  spawnSync('git', ['-C', s.gori, 'branch', '-m', 'main', 'other'], { env: cleanEnv() });
  const r = run(s.gori, s.fake);
  assert.equal(r.status, 1, r.out);
  assert.equal(r.result, 'failed');
  assert.equal(s.fake.launched(), false);
  const [rec] = records(s.gori);
  assert.deepEqual([rec.outcome, rec.launched], ['failed', false]);
  assert.match(rec.reason, /^起動しなかった: gori のチェックアウトの main を読めない/);
});
