import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { test } from 'node:test';
import { recordsDir, repoRoot, testGori } from '../helpers.mjs';

// 判断の記録は一時の gori のチェックアウト（GORI_ROOT）の .git/gori/repos/<名前>/audit に置き、本物の gori の記録に触れない。
const cleanEnv = (extra = {}) => ({ ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_') && !k.startsWith('CLAUDE') && !k.startsWith('GORI_'))), GORI_ROOT: testGori(), ...extra });
const J = (o) => JSON.stringify(o);
const put = (dir, rel, text) => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), text);
};
// SessionEnd フックが積むのと同じ形で、会話を gori のチェックアウトの抽出待ちに置く（tools/lib/learning.mjs の enqueue）。
const pending = (root) => join(root, '.git', 'gori', 'learning', 'pending');
const queue = (root, proj, ...rels) => {
  for (const rel of rels) put(root, join('.git', 'gori', 'learning', 'pending', basename(rel, '.jsonl')), `${join(proj, rel)}\n`);
};
// 利用者の状態の置き場所を読まないよう、GORI_HOME は既定で空の一時ディレクトリにする。
const run = (args, env = {}) => {
  const r = spawnSync(process.execPath, [join(repoRoot, 'tools', 'learning', 'sessions'), ...args], { encoding: 'utf8', env: cleanEnv({ GORI_HOME: mkdtempSync(join(tmpdir(), 'gori-sessions-home-')), ...env }), cwd: tmpdir() });
  return { status: r.status, out: r.stdout, err: r.stderr };
};
const HOOK = join(repoRoot, 'tools', 'hooks', 'session-end');
// SessionEnd フックを、root を積む先にして走らせる。抽出の代わりに何もしない道具を起動させる。
const endHook = (root, input) => {
  const r = spawnSync(process.execPath, [HOOK], { input: J(input), encoding: 'utf8', env: cleanEnv({ GORI_HOME: mkdtempSync(join(tmpdir(), 'gori-sessions-home-')), GORI_ROOT: root, GORI_EXTRACT_RUN: '/usr/bin/true' }) });
  assert.equal(r.status, 0, r.stderr);
};
const goriTree = () => {
  const dir = mkdtempSync(join(tmpdir(), 'gori-sessions-'));
  put(dir, '.claude-plugin/plugin.json', J({ name: 'gori' }));
  assert.equal(spawnSync('git', ['init', '-q', dir], { env: cleanEnv() }).status, 0);
  return dir;
};
const human = (uuid, text, cwd) => J({ type: 'user', uuid, cwd, timestamp: '2026-11-03T01:00:00.000Z', message: { role: 'user', content: text } });

// 作業リポジトリ: このセッションが判断の記録に書いた作業 ID を、道具が見つけられること。
function workRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'gori-sessions-work-'));
  const r = spawnSync('git', ['init', '-q', dir], { env: cleanEnv() });
  assert.equal(r.status, 0);
  const row = (session) => ['2026-11-03T10:00:00+09:00', session, 'start', '-', '目的', '-', '-', '-'].join('\t');
  put(recordsDir(dir), 'audit/2026-11-03-demo.tsv', `time\tsession\ttype\tstep\twhat\twhy\tevidence\tresult\n${row('s-plain')}\n`);
  put(recordsDir(dir), 'audit/2026-11-03-other.tsv', `time\tsession\ttype\tstep\twhat\twhy\tevidence\tresult\n${row('s-other')}\n`);
  return dir;
}

function projects(work) {
  const dir = mkdtempSync(join(tmpdir(), 'gori-sessions-proj-'));
  put(dir, '-a/s-plain.jsonl', `${human('u-1', '直して', work)}\n`);
  put(dir, '-a/s-done.jsonl', `${human('u-2', '済んだ', work)}\n`);
  put(dir, '-b/s-nohuman.jsonl', `${J({ type: 'summary' })}\n`);
  // 抽出の能力を呼んだセッションと、/gori:extract で始めたセッション
  put(dir, '-b/s-extract-skill.jsonl', `${human('u-3', '学びを取り出して', work)}\n${J({ type: 'assistant', uuid: 'a', message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'gori:extract' } }] } })}\n`);
  put(dir, '-b/s-extract-cmd.jsonl', `${human('u-4', '<command-message>gori:extract</command-message>\n<command-name>/gori:extract</command-name>', work)}\n`);
  put(dir, '-b/s-self.jsonl', `${human('u-5', '自分', work)}\n`);
  // サブエージェントの記録はセッションとして数えない
  put(dir, '-a/s-plain/subagents/agent-1.jsonl', `${human('u-6', '委任', work)}\n`);
  return dir;
}

const listed = (r) => r.out.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));

const ALL = ['-a/s-plain.jsonl', '-b/s-nohuman.jsonl', '-b/s-extract-skill.jsonl', '-b/s-extract-cmd.jsonl', '-b/s-self.jsonl'];

test('C2: 抽出待ちのセッションを一覧し、抽出待ちに無いセッション、抽出のためのセッション、自分自身を出さない', () => {
  const root = goriTree();
  const work = workRepo();
  const proj = projects(work);
  // s-done は処理済みで、抽出待ちに無い。
  queue(root, proj, ...ALL);
  const r = run(['--unprocessed', '--root', root, '--projects', proj], { CLAUDE_CODE_SESSION_ID: 's-self' });
  assert.equal(r.status, 0, r.err);
  const rows = listed(r);
  assert.deepEqual(rows.map((x) => x.session), ['s-nohuman', 's-plain']);
  const plain = rows[1];
  assert.equal(plain.file, join(proj, '-a', 's-plain.jsonl'));
  assert.equal(plain.projects, proj);
  assert.deepEqual(plain.tasks, ['2026-11-03-demo']);
  assert.equal(plain.human, 1);
  assert.equal(rows[0].human, 0);
});

test('記録の場所を決められないリポジトリ（repo.yml が食い違う、gori が見つからない）の会話は、止まらず作業 ID 無しで出す', () => {
  const root = goriTree();
  const work = workRepo();
  const proj = projects(work);
  queue(root, proj, '-a/s-plain.jsonl');
  writeFileSync(join(recordsDir(work), 'repo.yml'), 'path: /somewhere/else\n');
  const r = run(['--unprocessed', '--root', root, '--projects', proj]);
  assert.equal(r.status, 0, r.err);
  assert.deepEqual(listed(r).map((x) => [x.session, x.tasks]), [['s-plain', []]]);
  const none = run(['--unprocessed', '--root', root, '--projects', proj], { GORI_ROOT: mkdtempSync(join(tmpdir(), 'gori-sessions-notgori-')) });
  assert.equal(none.status, 0, none.err);
  assert.deepEqual(listed(none).map((x) => [x.session, x.tasks]), [['s-plain', []]]);
});

test('抽出待ちの会話の記録が消えていれば human 0 で出し、名指しの会話の記録が見つからなければ理由を書いて出さない', () => {
  const root = goriTree();
  const proj = mkdtempSync(join(tmpdir(), 'gori-sessions-proj-'));
  queue(root, proj, '-a/s-gone.jsonl');
  assert.deepEqual(listed(run(['--unprocessed', '--root', root, '--projects', proj])).map((x) => [x.session, x.human, x.tasks.length]), [['s-gone', 0, 0]]);
  const named = run(['--unprocessed', '--root', root, '--projects', proj], { GORI_EXTRACT_SESSIONS: 's-none' });
  assert.equal(named.out, '');
  assert.match(named.err, /s-none: 会話の記録が見つからない/);
});

test('作業の途中で抽出を呼んだ会話は一覧に出て、抽出だけの会話は名指ししても理由を添えて出ない', () => {
  const root = goriTree();
  const dir = mkdtempSync(join(tmpdir(), 'gori-sessions-proj-'));
  const CMD = '<command-message>gori:extract</command-message>\n<command-name>/gori:extract</command-name>';
  const skill = J({ type: 'assistant', uuid: 'a', message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'gori:extract' } }] } });
  const note = '<task-notification>\n<task-id>x</task-id>\n</task-notification>';
  // 抽出の後に作業を続けた会話と、作業の後に抽出を呼んだ会話
  put(dir, '-a/s-after.jsonl', `${human('m-1', CMD, '/x')}\n${human('m-2', note, '/x')}\n${human('m-3', '移行の計画を立てて', '/x')}\n`);
  put(dir, '-a/s-before.jsonl', `${human('m-4', '直して', '/x')}\n${human('m-5', '学びを取り出して', '/x')}\n${skill}\n`);
  // 抽出だけの会話: コマンドを二度呼び、通知が挟まる
  put(dir, '-a/s-only.jsonl', `${human('m-6', CMD, '/x')}\n${human('m-7', note, '/x')}\n${human('m-8', CMD, '/x')}\n`);
  const r = run(['--unprocessed', '--root', root, '--projects', dir], { GORI_EXTRACT_SESSIONS: 's-after,s-before,s-only' });
  assert.equal(r.status, 0, r.err);
  assert.deepEqual(listed(r).map((x) => [x.session, x.human]), [['s-after', 3], ['s-before', 2]]);
  assert.match(r.err, /s-only: 抽出だけの会話なので出さない/);
});

test('C2: mark は抽出待ちから消し、二度目は already を返す', () => {
  const root = goriTree();
  const proj = projects(workRepo());
  queue(root, proj, '-a/s-plain.jsonl', '-b/s-nohuman.jsonl', '-b/s-self.jsonl');
  const a = run(['mark', 's-plain', 's-nohuman', '--root', root]);
  assert.equal(a.status, 0, a.err);
  assert.equal(a.out, 's-plain\tmarked\ns-nohuman\tmarked\n');
  const b = run(['mark', 's-plain', '--root', root]);
  assert.equal(b.out, 's-plain\talready\n');
  assert.deepEqual(readdirSync(pending(root)), ['s-self']);
  assert.deepEqual(listed(run(['--unprocessed', '--root', root, '--projects', proj])).map((x) => x.session), ['s-self']);
  run(['mark', 's-self', '--root', root]);
  assert.equal(run(['--unprocessed', '--root', root, '--projects', proj]).out, '');
});

test('C2: セッション ID の形でない値は受け付けない', () => {
  const root = goriTree();
  const proj = mkdtempSync(join(tmpdir(), 'gori-sessions-proj-'));
  queue(root, proj, '-a/x.jsonl');
  for (const args of [['mark', '../x'], ['mark', '--self']]) assert.notEqual(run([...args, '--root', root]).status, 0);
  assert.deepEqual(readdirSync(pending(root)), ['x']);
});

test('human は人間の発言だけを uuid つきで出す', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gori-sessions-proj-'));
  put(dir, '-a/s1.jsonl', [
    human('u-1', '一つ目', '/x'),
    J({ type: 'assistant', uuid: 'a-1', message: { content: [{ type: 'text', text: '返事' }] } }),
    J({ type: 'user', uuid: 'r-1', message: { content: [{ type: 'tool_result', content: '結果' }] } }),
    J({ type: 'user', uuid: 'm-1', isMeta: true, message: { content: 'メタ' } }),
    human('u-2', '二つ目', '/x'),
  ].join('\n'));
  const rows = listed(run(['human', 's1', '--projects', dir]));
  assert.deepEqual(rows.map((r) => [r.message, r.text]), [['u-1', '一つ目'], ['u-2', '二つ目']]);
  assert.deepEqual(rows.map((r) => r.before ?? null), [null, '返事']);
  assert.equal(run(['human', 's-none', '--projects', dir]).status, 1);
});

test('human は、前の人間の発言から後のエージェントの発言をつないだ末尾を before に添える', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gori-sessions-proj-'));
  const say = (uuid, text, extra = {}) => J({ type: 'assistant', uuid, ...extra, message: { content: [{ type: 'text', text }] } });
  const long = `${'前置き'.repeat(200)}A) パスを受け取る。B) 開いたファイルを受け取る。どちらにしますか`;
  put(dir, '-a/s1.jsonl', [
    human('u-1', '分けて', '/x'),
    say('a-1', '途中の報告'),
    say('a-2', long),
    J({ type: 'assistant', uuid: 'a-3', message: { content: [{ type: 'tool_use', name: 'Bash', input: {} }] } }),
    say('a-4', 'サブエージェントの発言', { isSidechain: true }),
    human('u-2', 'パスにして', '/x'),
    human('u-3', '続けて', '/x'),
  ].join('\n'));
  const rows = listed(run(['human', 's1', '--projects', dir]));
  assert.deepEqual(rows.map((r) => r.message), ['u-1', 'u-2', 'u-3']);
  const b = rows[1].before;
  assert.ok(b.startsWith('…'), b);
  assert.ok(b.endsWith('A) パスを受け取る。B) 開いたファイルを受け取る。どちらにしますか'), b);
  assert.equal([...b].length, 401);
  assert.equal(rows[2].before, undefined);
  // 案を示した後に短い報告が続いても、案は before に残る。
  const dir2 = mkdtempSync(join(tmpdir(), 'gori-sessions-proj-'));
  put(dir2, '-a/s2.jsonl', [human('v-1', '分けて', '/x'), say('b-1', 'A) パス。B) ファイル。どちらにしますか'), say('b-2', '待っています'), human('v-2', 'パスに', '/x')].join('\n'));
  assert.equal(listed(run(['human', 's2', '--projects', dir2]))[1].before, 'A) パス。B) ファイル。どちらにしますか 待っています');
});

test('gori でないディレクトリでは mark しない', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gori-sessions-x-'));
  const r = run(['mark', 's1', '--root', dir]);
  assert.notEqual(r.status, 0);
  assert.match(r.err, /gori のリポジトリでない/);
  assert.equal(existsSync(join(dir, 'learning')), false);
});

test('claude -p で起動したセッション（entrypoint が sdk-cli）は一覧に出さない', () => {
  const root = goriTree();
  const dir = mkdtempSync(join(tmpdir(), 'gori-sessions-proj-'));
  const withEntry = (uuid, text, entrypoint) => J({ type: 'user', uuid, cwd: '/x', entrypoint, timestamp: '2026-11-03T01:00:00.000Z', message: { role: 'user', content: text } });
  put(dir, '-a/s-headless.jsonl', `${withEntry('h-1', 'E2E の合成の訂正', 'sdk-cli')}\n`);
  put(dir, '-a/s-interactive.jsonl', `${withEntry('i-1', '確かめてから完了と言って', 'cli')}\n`);
  put(dir, '-a/s-unknown.jsonl', `${human('u-1', '入口の分からない記録', '/x')}\n`);
  queue(root, dir, '-a/s-headless.jsonl', '-a/s-interactive.jsonl', '-a/s-unknown.jsonl');
  const rows = listed(run(['--unprocessed', '--root', root, '--projects', dir]));
  assert.deepEqual(rows.map((x) => x.session), ['s-interactive', 's-unknown']);
});

test('GORI_EXTRACT_SESSIONS があれば、抽出待ちに無くても、名指しのセッションだけを出す', () => {
  const root = goriTree();
  const dir = mkdtempSync(join(tmpdir(), 'gori-sessions-proj-'));
  for (const s of ['s-a', 's-b', 's-c']) put(dir, `-a/${s}.jsonl`, `${human(`${s}-1`, '依頼', '/x')}\n`);
  queue(root, dir, '-a/s-a.jsonl', '-a/s-b.jsonl');
  const rows = listed(run(['--unprocessed', '--root', root, '--projects', dir], { GORI_EXTRACT_SESSIONS: 's-c, s-a' }));
  assert.deepEqual(rows.map((x) => x.session), ['s-a', 's-c']);
});

test('抽出待ちに無い会話は、会話の記録があっても一覧に出さない', () => {
  const root = goriTree();
  const dir = mkdtempSync(join(tmpdir(), 'gori-sessions-proj-'));
  put(dir, '-a/s-never.jsonl', `${human('n-1', '確かめてから完了と言って', '/x')}\n`);
  assert.equal(run(['--unprocessed', '--root', root, '--projects', dir]).out, '');
});

// 作業 ID のあるセッション: 二つの作業 A、B と、別のセッションの作業 C を持つ作業リポジトリと、その会話の記録。
function windowsFixture() {
  const work = mkdtempSync(join(tmpdir(), 'gori-sessions-win-'));
  assert.equal(spawnSync('git', ['init', '-q', work], { env: cleanEnv() }).status, 0);
  const head = 'time\tsession\ttype\tstep\twhat\twhy\tevidence\tresult\n';
  const row = (time, session, type) => [time, session, type, '-', '目的', '-', '-', '-'].join('\t');
  put(recordsDir(work), 'audit/2026-11-03-a.tsv', `${head}${row('2026-11-03T10:00:00+09:00', 's-win', 'start')}\n${row('2026-11-03T11:00:00+09:00', 's-win', 'done')}\n`);
  put(recordsDir(work), 'audit/2026-11-03-b.tsv', `${head}${row('2026-11-03T12:00:00+09:00', 's-win', 'start')}\n${row('2026-11-03T13:00:00+09:00', 's-win', 'done')}\n`);
  put(recordsDir(work), 'audit/2026-11-03-c.tsv', `${head}${row('2026-11-03T09:00:00+09:00', 's-other', 'start')}\n`);
  // done の無い作業 D は、start から会話の記録の終わりまでを期間にする。
  put(recordsDir(work), 'audit/2026-11-03-d.tsv', `${head}${row('2026-11-03T15:00:00+09:00', 's-nodone', 'start')}\n`);
  const proj = mkdtempSync(join(tmpdir(), 'gori-sessions-proj-'));
  const at = (uuid, text, timestamp) => J({ type: 'user', uuid, cwd: work, timestamp, message: { role: 'user', content: text } });
  put(proj, '-a/s-win.jsonl', [
    at('pre-1', '設定はあまりいじりたくない', '2026-11-03T00:30:00.000Z'),
    at('pre-edge', 'A の start の 1 ミリ秒前', '2026-11-03T00:59:59.999Z'),
    at('a-start', 'A の start ちょうど', '2026-11-03T01:00:00.000Z'),
    at('in-a', 'A の中の訂正', '2026-11-03T01:30:00.000Z'),
    at('after-a', 'A の done の後の訂正', '2026-11-03T02:30:00.000Z'),
    at('b-edge', 'B の start の 1 ミリ秒前', '2026-11-03T02:59:59.999Z'),
    at('b-start', 'B の start ちょうど', '2026-11-03T03:00:00.000Z'),
    at('in-b', 'B の中の訂正', '2026-11-03T03:30:00.000Z'),
    at('after-b', 'B の done の後の訂正', '2026-11-03T04:30:00.000Z'),
    J({ type: 'user', uuid: 'no-time', cwd: work, message: { role: 'user', content: '時刻の無い発言' } }),
  ].join('\n'));
  put(proj, '-a/s-nodone.jsonl', [
    at('d-pre', 'D の start の 1 ミリ秒前', '2026-11-03T05:59:59.999Z'),
    at('d-start', 'D の start ちょうど', '2026-11-03T06:00:00.000Z'),
    at('d-late', 'D の後の発言', '2026-11-04T06:00:00.000Z'),
  ].join('\n'));
  return { work, proj };
}
const traceHuman = (task, work, proj) => {
  const r = spawnSync(process.execPath, [join(repoRoot, 'tools', 'records', 'trace'), task, '--repo', work, '--projects', proj], { encoding: 'utf8', env: cleanEnv() });
  assert.equal(r.status, 0, r.stderr);
  return listed({ out: r.stdout }).filter((x) => x.source === 'human').map((x) => x.ref.message);
};

test('human --outside-tasks は、どの作業の期間にも入らない発言だけを出す', () => {
  const { work, proj } = windowsFixture();
  const r = run(['human', 's-win', '--projects', proj, '--outside-tasks', '--repo', work]);
  assert.equal(r.status, 0, r.err);
  assert.deepEqual(listed(r).map((x) => [x.message, x.text]), [['pre-1', '設定はあまりいじりたくない'], ['pre-edge', 'A の start の 1 ミリ秒前'], ['no-time', '時刻の無い発言']]);
  // 作業の無いリポジトリを指せば、全ての発言を出す。
  const empty = mkdtempSync(join(tmpdir(), 'gori-sessions-none-'));
  assert.equal(listed(run(['human', 's-win', '--projects', proj, '--outside-tasks', '--repo', empty])).length, 10);
  assert.equal(run(['human', 's-win', '--projects', proj, '--outside-tasks']).status, 2);
});

test('作業ごとの trace と human --outside-tasks は、同じ発言を二重に出さず、合わせて全ての発言を出す', () => {
  const { work, proj } = windowsFixture();
  const a = traceHuman('2026-11-03-a', work, proj);
  const b = traceHuman('2026-11-03-b', work, proj);
  const outside = listed(run(['human', 's-win', '--projects', proj, '--outside-tasks', '--repo', work])).map((x) => x.message);
  assert.deepEqual(a, ['a-start', 'in-a', 'after-a', 'b-edge']);
  assert.deepEqual(b, ['b-start', 'in-b', 'after-b']);
  const all = listed(run(['human', 's-win', '--projects', proj])).map((x) => x.message);
  const joined = [...a, ...b, ...outside];
  assert.equal(new Set(joined).size, joined.length);
  assert.deepEqual([...joined].sort(), [...all].sort());
});

test('done の無い作業では、start ちょうどから会話の記録の終わりまでを trace が読み、その前だけを --outside-tasks が出す', () => {
  const { work, proj } = windowsFixture();
  assert.deepEqual(traceHuman('2026-11-03-d', work, proj), ['d-start', 'd-late']);
  assert.deepEqual(listed(run(['human', 's-nodone', '--projects', proj, '--outside-tasks', '--repo', work])).map((x) => x.message), ['d-pre']);
});

test('SessionEnd フックが積んだ会話が一覧に出て、mark で消え、再開した会話がもう一度終われば、また出る', () => {
  const root = goriTree();
  const dir = mkdtempSync(join(tmpdir(), 'gori-sessions-proj-'));
  const file = join(dir, '-a', 's-ended.jsonl');
  put(dir, '-a/s-ended.jsonl', `${human('e-1', '終えた依頼', '/x')}\n`);
  // session_id がファイル名と違っても、会話の記録のファイル名で積む。
  endHook(root, { session_id: 'other-id', transcript_path: file, hook_event_name: 'SessionEnd', reason: 'prompt_input_exit' });
  const ids = () => listed(run(['--unprocessed', '--root', root, '--projects', dir])).map((x) => [x.session, x.human]);
  assert.deepEqual(ids(), [['s-ended', 1]]);
  run(['mark', 's-ended', '--root', root]);
  assert.deepEqual(ids(), []);
  writeFileSync(file, `${human('e-1', '終えた依頼', '/x')}\n${human('e-2', '再開した後の訂正', '/x')}\n`);
  endHook(root, { session_id: 's-ended', transcript_path: file, hook_event_name: 'SessionEnd' });
  assert.deepEqual(ids(), [['s-ended', 2]]);
});
