import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test } from 'node:test';
import { repoRoot } from '../helpers.mjs';

// pre-commit の中で走ると git が GIT_INDEX_FILE などを渡す。会話の中で走ると CLAUDE* や GORI_* が立っている。
// どちらも一時リポジトリの操作と道具の判断に漏らさない。
const cleanEnv = (extra = {}) => ({
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_') && !k.startsWith('CLAUDE') && !k.startsWith('GORI_'))),
  ...extra,
});
const POOL = join(repoRoot, 'tools', 'records', 'pool');
const g = (dir, ...a) => spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8', env: cleanEnv() });

// gori の偽チェックアウト。実際の gori の .git を汚さないよう、テストはどれも GORI_ROOT でここを指す。
function fakeGori() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'gori-pool-gori-')));
  g(dir, 'init', '-q');
  mkdirSync(join(dir, '.claude-plugin'));
  writeFileSync(join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'gori' }));
  return dir;
}
// 作業リポジトリ。main に commit が一つある。
function workRepo(parent = mkdtempSync(join(tmpdir(), 'gori-pool-work-')), name = 'app') {
  const dir = join(realpathSync(parent), name);
  mkdirSync(dir);
  g(dir, 'init', '-q', '-b', 'main');
  g(dir, 'commit', '-q', '--allow-empty', '-m', 'init');
  return dir;
}
const setup = () => {
  const gori = fakeGori();
  const work = workRepo();
  return { gori, work, pool: (name = basename(work)) => join(gori, '.git', 'gori', 'repos', name, 'pool') };
};

const pool = (gori, cwd, args, { input = '', env = {} } = {}) => {
  const r = spawnSync(process.execPath, [POOL, ...args], { cwd, input, encoding: 'utf8', env: cleanEnv({ GORI_ROOT: gori, ...env }) });
  return { status: r.status, stdout: r.stdout, out: `${r.stdout}${r.stderr}` };
};

const BODY = '## 現状\n今の状態。\n## 問題\n困ること。\n## 期待する結果\nこうなる。\n## 確認したこと\n読んだ。\n## 受け入れ条件\n- 通る\n';
const learning = (pattern, slug = pattern, extra = []) => ['add', '--kind', 'learning', '--slug', slug, '--title', `${pattern} の学び`, '--pattern', pattern, '--case', '2026-11-08-c1', ...extra];
const improvement = (slug, extra = []) => ['add', '--kind', 'improvement', '--slug', slug, '--title', `${slug} の改善`, ...extra];
const procedure = (kind, slug = kind, extra = []) => ['add', '--kind', 'procedure', '--slug', slug, '--title', `${kind} の手順書`, '--work-kind', kind, '--task', 'app/20260105-101500-merge-main', '--task', 'web/2026-01-10-merge-main', ...extra];
const added = (s, args, opts = {}) => {
  const r = pool(s.gori, s.work, args, { input: BODY, ...opts });
  assert.equal(r.status, 0, r.out);
  return r.stdout.trim();
};
const fm = (s, id, name) => readFileSync(join(s.pool(name), `${id}.md`), 'utf8');

test('add は proposed で一件を作り、ID を一行出し、repo.yml に本体のパスを書く', () => {
  const s = setup();
  mkdirSync(join(s.work, 'tools', 'records'), { recursive: true });
  const id = added(s, improvement('fix-it', ['--file', 'tools/records/log']));
  assert.match(id, /^\d{8}-\d{6}-fix-it$/);
  const text = fm(s, id);
  assert.match(text, new RegExp(`^---\nid: ${id}\n`));
  assert.match(text, /\nkind: improvement\n/);
  assert.match(text, /\nstatus: proposed\n/);
  assert.match(text, /\ncreated: \d{4}-\d{2}-\d{2}T/);
  assert.match(text, /\nfiles: \[tools\/records\/log\]\n/);
  assert.ok(text.endsWith(`---\n${BODY}`));
  assert.equal(readFileSync(join(s.gori, '.git', 'gori', 'repos', basename(s.work), 'repo.yml'), 'utf8'), `path: ${s.work}\n`);
});

test('add は本文の見出しが一つでも欠ければ 2', () => {
  const s = setup();
  const r = pool(s.gori, s.work, improvement('x'), { input: BODY.replace('## 確認したこと\n', '') });
  assert.equal(r.status, 2, r.out);
  assert.match(r.out, /確認したこと/);
});

test('learning は pattern と case が要り、improvement に pattern や case があれば 2', () => {
  const s = setup();
  assert.equal(pool(s.gori, s.work, ['add', '--kind', 'learning', '--slug', 'a', '--title', 't', '--case', 'c'], { input: BODY }).status, 2);
  assert.equal(pool(s.gori, s.work, ['add', '--kind', 'learning', '--slug', 'a', '--title', 't', '--pattern', 'p'], { input: BODY }).status, 2);
  assert.equal(pool(s.gori, s.work, improvement('a', ['--pattern', 'p']), { input: BODY }).status, 2);
  assert.equal(pool(s.gori, s.work, improvement('a', ['--case', 'c']), { input: BODY }).status, 2);
  const id = added(s, learning('pat-a'));
  assert.match(fm(s, id), /\npattern: pat-a\ncases: \[2026-11-08-c1\]\n/);
});

test('procedure は work-kind と task を frontmatter に書き、同じ task は一つにまとめる', () => {
  const s = setup();
  const id = added(s, procedure('merge-main', 'merge-main', ['--task', 'app/20260105-101500-merge-main']));
  const text = fm(s, id);
  assert.match(text, /\nkind: procedure\n/);
  assert.match(text, /\nwork-kind: merge-main\ntasks: \[app\/20260105-101500-merge-main, web\/2026-01-10-merge-main\]\n/);
  assert.equal(pool(s.gori, s.work, ['list', '--kind', 'procedure']).stdout.trim(), `${id}\tproposed\tprocedure\tmerge-main の手順書`);
});

test('procedure に pattern、case、recurrence-of があるか、work-kind か task が無ければ 2。ほかの種類に work-kind や task があれば 2', () => {
  const s = setup();
  for (const extra of [['--pattern', 'p'], ['--case', 'c'], ['--recurrence-of', '20200101-000000-x']]) {
    assert.equal(pool(s.gori, s.work, procedure('k', 'k', extra), { input: BODY }).status, 2, extra.join(' '));
  }
  const base = ['add', '--kind', 'procedure', '--slug', 'k', '--title', 't'];
  assert.equal(pool(s.gori, s.work, [...base, '--task', 'app/20260105-101500-x'], { input: BODY }).status, 2);
  assert.equal(pool(s.gori, s.work, [...base, '--work-kind', 'k'], { input: BODY }).status, 2);
  assert.equal(pool(s.gori, s.work, [...base, '--work-kind', 'Bad_Kind', '--task', 'app/20260105-101500-x'], { input: BODY }).status, 2);
  assert.equal(pool(s.gori, s.work, improvement('a', ['--work-kind', 'k']), { input: BODY }).status, 2);
  assert.equal(pool(s.gori, s.work, learning('p', 'p', ['--task', 'app/20260105-101500-x']), { input: BODY }).status, 2);
  assert.equal(existsSync(s.pool()), false);
});

test('procedure の task が <リポジトリ>/<作業ID> の形でなければ 2', () => {
  const s = setup();
  for (const t of ['20260105-101500-x', 'app/b/20260105-101500-x', 'app/x', 'app/20260105-101500-X', 'a b/2026-01-10-x']) {
    const r = pool(s.gori, s.work, ['add', '--kind', 'procedure', '--slug', 'k', '--title', 't', '--work-kind', 'k', '--task', t], { input: BODY });
    assert.equal(r.status, 2, `${t}: ${r.out}`);
  }
});

test('procedure の重複: 同じ work-kind の一件があれば、proposed、todo、rejected、done のどれでも 3 で断り、ID と状態を出す', () => {
  for (const to of ['proposed', 'todo', 'rejected', 'done']) {
    const s = setup();
    const id = added(s, procedure('same'));
    if (to !== 'proposed' && to !== 'rejected') assert.equal(pool(s.gori, s.work, ['todo', id]).status, 0);
    if (to === 'rejected') assert.equal(pool(s.gori, s.work, ['reject', id, '--why', '要らない']).status, 0);
    if (to === 'done') assert.equal(pool(s.gori, s.work, ['done', id, '--commit', g(s.work, 'rev-parse', 'HEAD').stdout.trim()]).status, 0);
    const r = pool(s.gori, s.work, procedure('same', 'again'), { input: BODY });
    assert.equal(r.status, 3, `${to}: ${r.out}`);
    assert.ok(r.out.includes(`${id}（${to}）`), r.out);
    // 別の work-kind なら起票できる。
    added(s, procedure('other'));
  }
});

test('同じ ID の一件があれば 2', () => {
  const s = setup();
  const id = added(s, improvement('dup'));
  // 秒の境目に依らず当たるよう、これから 60 秒の各秒の同じ ID のファイルを先に置いてから、同じ slug で起票する。
  const text = readFileSync(join(s.pool(), `${id}.md`), 'utf8');
  const p = (n) => String(n).padStart(2, '0');
  const now = Date.now();
  for (let k = 0; k <= 60; k++) {
    const d = new Date(now + k * 1000);
    const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
    const f = join(s.pool(), `${stamp}-dup.md`);
    if (!existsSync(f)) writeFileSync(f, text);
  }
  const b = pool(s.gori, s.work, improvement('dup'), { input: BODY });
  assert.equal(b.status, 2, b.out);
  assert.match(b.out, /同じ ID/);
});

test('learning の重複: 同じ pattern が proposed、todo、rejected なら 3 で断り、add-case を案内する', () => {
  for (const to of ['proposed', 'todo', 'rejected']) {
    const s = setup();
    const id = added(s, learning('same'));
    if (to === 'todo') assert.equal(pool(s.gori, s.work, ['todo', id]).status, 0);
    if (to === 'rejected') assert.equal(pool(s.gori, s.work, ['reject', id, '--why', '要らない']).status, 0);
    const r = pool(s.gori, s.work, learning('same', 'again'), { input: BODY });
    assert.equal(r.status, 3, `${to}: ${r.out}`);
    assert.ok(r.out.includes(`pool add-case ${id} <事例>`), r.out);
  }
});

test('learning の重複: 同じ pattern が done だけなら、--recurrence-of を付けたときだけ再発として起票する', () => {
  const s = setup();
  const id = added(s, learning('rec'));
  assert.equal(pool(s.gori, s.work, ['todo', id]).status, 0);
  const sha = g(s.work, 'rev-parse', 'HEAD').stdout.trim();
  assert.equal(pool(s.gori, s.work, ['done', id, '--commit', sha]).status, 0);

  const without = pool(s.gori, s.work, learning('rec', 'rec2'), { input: BODY });
  assert.equal(without.status, 3, without.out);
  assert.ok(without.out.includes(`--recurrence-of ${id}`), without.out);
  assert.equal(pool(s.gori, s.work, learning('rec', 'rec2', ['--recurrence-of', '20200101-000000-other']), { input: BODY }).status, 2);

  const again = added(s, learning('rec', 'rec2', ['--recurrence-of', id]));
  const text = fm(s, again);
  assert.ok(text.includes(`\nrecurrence_of: ${id}\n`), text);
  assert.ok(text.includes(`## 現状\n${id} の対策の後に再発した。\n\n今の状態。\n`), text);
});

test('add-case は learning にだけ事例を足し、既にあれば何もせず 0', () => {
  const s = setup();
  const id = added(s, learning('cases'));
  assert.equal(pool(s.gori, s.work, ['add-case', id, '2026-11-08-c2']).status, 0);
  assert.match(fm(s, id), /\ncases: \[2026-11-08-c1, 2026-11-08-c2\]\n/);
  const before = fm(s, id);
  const r = pool(s.gori, s.work, ['add-case', id, '2026-11-08-c2']);
  assert.equal(r.status, 0, r.out);
  assert.equal(fm(s, id), before);
  const imp = added(s, improvement('imp'));
  assert.equal(pool(s.gori, s.work, ['add-case', imp, '2026-11-08-c2']).status, 2);
});

test('todo は CLAUDECODE があっても proposed から todo にする', () => {
  const s = setup();
  const id = added(s, improvement('approve'));
  const r = pool(s.gori, s.work, ['todo', id], { env: { CLAUDECODE: '1' } });
  assert.equal(r.status, 0, r.out);
  assert.match(fm(s, id), /\nstatus: todo\n/);
  assert.equal(pool(s.gori, s.work, ['todo', id]).status, 2, 'todo は proposed からだけ');
});

test('GORI_AUTO があれば、todo と done は一件を書き換えずに 1 で止まる。値が空でも 0 でも止まる', () => {
  const s = setup();
  const id = added(s, improvement('auto-fence'));
  const before = fm(s, id);
  for (const v of ['1', '', '0']) {
    const r = pool(s.gori, s.work, ['todo', id], { env: { GORI_AUTO: v } });
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /auto-fence: 無人の作業（GORI_AUTO）は pool todo をできない/);
    assert.equal(fm(s, id), before);
  }
  assert.equal(pool(s.gori, s.work, ['todo', id]).status, 0);
  const todo = fm(s, id);
  const sha = g(s.work, 'rev-parse', 'HEAD').stdout.trim();
  const r = pool(s.gori, s.work, ['done', id, '--commit', sha], { env: { GORI_AUTO: '1' } });
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /auto-fence: .*pool done/);
  assert.equal(fm(s, id), todo);
  assert.equal(pool(s.gori, s.work, ['done', id, '--commit', sha]).status, 0, '印が無ければ done にできる');
});

// 会話の記録の偽物。却下を頼んだ人間の発言を、Claude Code の中から照らすために使う。
function transcript(session, turns) {
  const projects = mkdtempSync(join(tmpdir(), 'gori-pool-projects-'));
  mkdirSync(join(projects, '-demo'));
  const rows = turns.map(([role, text], i) =>
    role === 'user'
      ? { type: 'user', uuid: `u-${i}`, timestamp: `2026-11-14T00:00:0${i}Z`, message: { role: 'user', content: text } }
      : { type: 'assistant', uuid: `a-${i}`, timestamp: `2026-11-14T00:00:0${i}Z`, message: { role: 'assistant', content: [{ type: 'text', text }] } });
  writeFileSync(join(projects, '-demo', `${session}.jsonl`), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return projects;
}

test('reject は Claude Code の外なら発言なしで、proposed か todo から rejected にして理由を書く', () => {
  const s = setup();
  const id = added(s, improvement('nope'));
  assert.equal(pool(s.gori, s.work, ['reject', id, '--why', '要らない: 重複']).status, 0);
  const text = fm(s, id);
  assert.match(text, /\nstatus: rejected\n/);
  assert.match(text, /\nreason: "要らない: 重複"\n/);
  assert.match(text, /\nrejected_by: "?端末の人間"?\n/);
  assert.equal(pool(s.gori, s.work, ['reject', id, '--why', 'x']).status, 2, 'rejected からは reject できない');
  const t = added(s, improvement('nope2'));
  assert.equal(pool(s.gori, s.work, ['todo', t]).status, 0);
  assert.equal(pool(s.gori, s.work, ['reject', t, '--why', 'x']).status, 0);
});

test('reject は Claude Code の中なら、最後の人間の発言に含まれる --quote があるときだけ rejected にし、発言を残す', () => {
  const s = setup();
  const id = added(s, improvement('nope'));
  const before = fm(s, id);
  const projects = transcript('s-r', [['assistant', '却下しますか。'], ['user', 'それは却下して']]);
  const env = { CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 's-r', GORI_PROJECTS_DIR: projects };
  const none = pool(s.gori, s.work, ['reject', id, '--why', '要らない'], { env });
  assert.equal(none.status, 2, none.out);
  assert.match(none.out, /--quote/);
  assert.equal(fm(s, id), before, '発言が無ければ書かない');
  const other = pool(s.gori, s.work, ['reject', id, '--why', '要らない', '--quote', '却下してよい'], { env });
  assert.equal(other.status, 2, other.out);
  assert.match(other.out, /reject-unverified: .*最後の発言の先頭: それは却下して/);
  assert.equal(fm(s, id), before, '最後の発言に無い引用では書かない');
  const noSession = pool(s.gori, s.work, ['reject', id, '--why', '要らない', '--quote', 'それは却下して'], { env: { CLAUDECODE: '1', GORI_PROJECTS_DIR: projects } });
  assert.equal(noSession.status, 2, noSession.out);
  assert.match(noSession.out, /reject-unverified/);
  const ok = pool(s.gori, s.work, ['reject', id, '--why', '要らない', '--quote', 'それは却下して'], { env });
  assert.equal(ok.status, 0, ok.out);
  const text = fm(s, id);
  assert.match(text, /\nstatus: rejected\n/);
  assert.match(text, /\nrejected_by: "発言 u-1 「それは却下して」"\n/);
});

test('reject は Claude Code の中で、返事に問いが残っていれば断る', () => {
  const s = setup();
  const id = added(s, improvement('nope'));
  const projects = transcript('s-q', [['assistant', '却下しますか。'], ['user', '却下して。ほかに残っているものはある？']]);
  const r = pool(s.gori, s.work, ['reject', id, '--why', '要らない', '--quote', '却下して'], { env: { CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 's-q', GORI_PROJECTS_DIR: projects } });
  assert.equal(r.status, 2, r.out);
  assert.match(r.out, /reject-question: 返事に問いがある（「ほかに残っているものはある？」）/);
  assert.match(fm(s, id), /\nstatus: proposed\n/);
});

test('reject は無人の作業（GORI_AUTO）からは、発言を添えても断る', () => {
  const s = setup();
  const id = added(s, improvement('nope'));
  const before = fm(s, id);
  const projects = transcript('s-a', [['user', 'それは却下して']]);
  const r = pool(s.gori, s.work, ['reject', id, '--why', '要らない', '--quote', 'それは却下して'], { env: { GORI_AUTO: '1', CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 's-a', GORI_PROJECTS_DIR: projects } });
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /auto-fence: .*pool reject/);
  assert.equal(fm(s, id), before);
});

test('done は todo からだけで、main に無い SHA を断り、main にある SHA はフルで書く', () => {
  const s = setup();
  const id = added(s, improvement('ship'));
  const head = g(s.work, 'rev-parse', 'HEAD').stdout.trim();
  assert.equal(pool(s.gori, s.work, ['done', id, '--commit', head]).status, 2, 'proposed からは done にできない');
  assert.equal(pool(s.gori, s.work, ['todo', id]).status, 0);
  g(s.work, 'switch', '-q', '-c', 'side');
  g(s.work, 'commit', '-q', '--allow-empty', '-m', 'side');
  const side = g(s.work, 'rev-parse', 'HEAD').stdout.trim();
  const off = pool(s.gori, s.work, ['done', id, '--commit', side]);
  assert.equal(off.status, 2, off.out);
  assert.match(off.out, /main に含まれない/);
  assert.equal(pool(s.gori, s.work, ['done', id, '--commit', head.slice(0, 8)]).status, 0);
  assert.ok(fm(s, id).includes(`\ncommit: ${head}\n`));
  assert.match(fm(s, id), /\nstatus: done\n/);
});

test('list は既定で proposed と todo を ID 順にタブ区切りで出し、--status と --kind で絞る', () => {
  const s = setup();
  const a = added(s, improvement('aaa'));
  const b = added(s, learning('bbb'));
  const c = added(s, improvement('ccc'));
  assert.equal(pool(s.gori, s.work, ['todo', b]).status, 0);
  assert.equal(pool(s.gori, s.work, ['reject', c, '--why', 'x']).status, 0);
  // 古い時刻の一件を直に置き、ID の順（時系列）に並ぶことを見る。
  const old = '20200101-000000-old';
  writeFileSync(join(s.pool(), `${old}.md`), `---\nid: ${old}\ntitle: 古い\nkind: improvement\nstatus: proposed\n---\n${BODY}`);
  const r = pool(s.gori, s.work, ['list']);
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(r.stdout.trim().split('\n'), [`${old}\tproposed\timprovement\t古い`, `${a}\tproposed\timprovement\taaa の改善`, `${b}\ttodo\tlearning\tbbb の学び`]);
  assert.equal(pool(s.gori, s.work, ['list', '--status', 'rejected']).stdout.trim(), `${c}\trejected\timprovement\tccc の改善`);
  assert.equal(pool(s.gori, s.work, ['list', '--kind', 'learning']).stdout.trim(), `${b}\ttodo\tlearning\tbbb の学び`);
  assert.equal(pool(s.gori, s.work, ['list', '--status', 'todo', '--status', 'rejected']).stdout.trim().split('\n').length, 2);
});

test('list --all は repos の下の全リポジトリを名前の列付きで出し、git の外からでも動く', () => {
  const s = setup();
  const other = workRepo(undefined, 'other');
  const a = added(s, improvement('one'));
  const r1 = pool(s.gori, other, improvement('two'), { input: BODY });
  assert.equal(r1.status, 0, r1.out);
  const b = r1.stdout.trim();
  const outside = realpathSync(mkdtempSync(join(tmpdir(), 'gori-pool-nogit-')));
  const r = pool(s.gori, outside, ['list', '--all']);
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(r.stdout.trim().split('\n'), [`app\t${a}\tproposed\timprovement\tone の改善`, `other\t${b}\tproposed\timprovement\ttwo の改善`].sort());
  assert.equal(pool(s.gori, outside, ['list']).status, 2, '--all でなければ git のリポジトリが要る');
});

test('show は全文を出し、無ければ 2', () => {
  const s = setup();
  const id = added(s, improvement('see'));
  const r = pool(s.gori, s.work, ['show', id]);
  assert.equal(r.status, 0, r.out);
  assert.equal(r.stdout, fm(s, id));
  assert.equal(pool(s.gori, s.work, ['show', '20200101-000000-none']).status, 2);
});

test('search は全 status から題か本文に全ての語を含むものを出し、--file は files で探す', () => {
  const s = setup();
  mkdirSync(join(s.work, 'tools'));
  const a = added(s, improvement('alpha', ['--file', 'tools/a']));
  const b = added(s, improvement('beta', ['--file', 'tools/b']));
  assert.equal(pool(s.gori, s.work, ['reject', a, '--why', 'x']).status, 0);
  assert.equal(pool(s.gori, s.work, ['search', 'alpha', '困ること']).stdout.trim(), `${a}\trejected\timprovement\talpha の改善`);
  assert.equal(pool(s.gori, s.work, ['search', 'alpha', 'beta']).stdout, '');
  assert.equal(pool(s.gori, s.work, ['search', '--file', 'tools/b']).stdout.trim(), `${b}\tproposed\timprovement\tbeta の改善`);
  assert.equal(pool(s.gori, s.work, ['search']).status, 2);
});

test('worktree の中から呼んでも、本体のチェックアウトの名前のプールを使う', () => {
  const s = setup();
  const wt = join(realpathSync(mkdtempSync(join(tmpdir(), 'gori-pool-wt-'))), 'feature-x');
  assert.equal(g(s.work, 'worktree', 'add', '-q', '-b', 'feature-x', wt).status, 0);
  const r = pool(s.gori, wt, improvement('from-wt'), { input: BODY });
  assert.equal(r.status, 0, r.out);
  assert.ok(existsSync(join(s.pool(), `${r.stdout.trim()}.md`)));
  assert.ok(!existsSync(s.pool('feature-x')));
  assert.equal(pool(s.gori, wt, ['list']).stdout.split('\n')[0].split('\t')[0], r.stdout.trim());
});

test('repo.yml の path が今のリポジトリと違えば 2 で止まり、--name で別の名前を使える', () => {
  const s = setup();
  added(s, improvement('first'));
  // 同じディレクトリ名の別のリポジトリ。
  const twin = workRepo(undefined, basename(s.work));
  const r = pool(s.gori, twin, improvement('second'), { input: BODY });
  assert.equal(r.status, 2, r.out);
  assert.match(r.out, /--name/);
  assert.match(r.out, /repo\.yml/);
  assert.equal(pool(s.gori, twin, ['list']).status, 2);
  const ok = pool(s.gori, twin, [...improvement('second'), '--name', 'twin'], { input: BODY });
  assert.equal(ok.status, 0, ok.out);
  assert.equal(readFileSync(join(s.gori, '.git', 'gori', 'repos', 'twin', 'repo.yml'), 'utf8'), `path: ${twin}\n`);
  assert.equal(pool(s.gori, twin, ['list', '--name', 'twin']).stdout.split('\t')[0], ok.stdout.trim());
});

test('gori のチェックアウトでない GORI_ROOT、不明なサブコマンドや引数は 2', () => {
  const s = setup();
  const notGori = realpathSync(mkdtempSync(join(tmpdir(), 'gori-pool-not-')));
  g(notGori, 'init', '-q');
  const r = pool(notGori, s.work, ['list']);
  assert.equal(r.status, 2, r.out);
  assert.match(r.out, /gori の git のチェックアウトでない/);
  const u = pool(s.gori, s.work, ['frobnicate']);
  assert.equal(u.status, 2);
  assert.match(u.out, /使い方/);
  assert.equal(pool(s.gori, s.work, ['list', '--bogus', 'x']).status, 2);
  assert.equal(pool(s.gori, s.work, ['show']).status, 2);
  assert.equal(pool(s.gori, s.work, []).status, 2);
});

test('add は、題か本文に秘密情報らしい文字列があれば書かずに 2 で終え、値を出さない', () => {
  const s = setup();
  const url = ['postgres://user', 'pass@host/db'].join(':'); // 検査のための偽の値
  const inBody = pool(s.gori, s.work, improvement('leak-body'), { input: BODY.replace('今の状態。', `接続先 ${url}`) });
  assert.equal(inBody.status, 2, inBody.out);
  assert.match(inBody.out, /secret-like: 本文（URL の利用者名とパスワード）/);
  const inTitle = pool(s.gori, s.work, ['add', '--kind', 'improvement', '--slug', 'leak-title', '--title', url], { input: BODY });
  assert.equal(inTitle.status, 2, inTitle.out);
  assert.match(inTitle.out, /secret-like: --title/);
  for (const r of [inBody, inTitle]) assert.doesNotMatch(r.out, /pass@host/);
  assert.equal(existsSync(s.pool()), false);
});

test('add の起票先は --file のあるリポジトリ。gori のパスだけなら gori のプールに、無いか分かれるなら止まる', () => {
  const s = setup();
  mkdirSync(join(s.gori, 'tools', 'records'), { recursive: true });
  writeFileSync(join(s.gori, 'tools', 'records', 'pool'), '');
  mkdirSync(join(s.work, 'src'));
  writeFileSync(join(s.work, 'src', 'app.js'), '');
  const goriPool = join(s.gori, '.git', 'gori', 'repos', basename(s.gori), 'pool');
  // gori のチェックアウトにだけあるパスは、作業リポジトリから起票しても gori のプールに入る。
  const r = pool(s.gori, s.work, improvement('gori-fix', ['--file', 'tools/records/pool']), { input: BODY });
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /gori のプールに起票する/);
  const id = r.stdout.trim();
  assert.ok(existsSync(join(goriPool, `${id}.md`)), r.out);
  assert.equal(existsSync(s.pool()), false);
  // 作業リポジトリのパスは、今までどおり作業リポジトリのプールに入る。これから作るファイル（親のディレクトリがある）も同じ。
  const here = added(s, improvement('app-fix', ['--file', 'src/app.js', '--file', 'src/new.js']));
  assert.ok(existsSync(join(s.pool(), `${here}.md`)));
  // どちらにも無いパス、二つに分かれるパス、絶対パスと .. は断り、書かない。
  for (const [file, why] of [
    [['nowhere/x.js'], /どちらにも|にも gori のチェックアウトにも無い: nowhere\/x\.js/],
    [['src/app.js', 'tools/records/pool'], /分かれる/],
    [['/etc/hosts'], /相対パス/],
    [['src/../../x'], /相対パス/],
  ]) {
    const res = pool(s.gori, s.work, improvement('bad', file.flatMap((f) => ['--file', f])), { input: BODY });
    assert.equal(res.status, 2, `${file}: ${res.out}`);
    assert.match(res.out, why);
  }
  // 最上位の一段のパスは、ファイルが実際にあるときだけ今のリポジトリにあると見る。
  writeFileSync(join(s.work, 'README.md'), '');
  const top = added(s, improvement('top-fix', ['--file', 'README.md']));
  assert.ok(existsSync(join(s.pool(), `${top}.md`)));
  const typo = pool(s.gori, s.work, improvement('typo', ['--file', 'newtop.js']), { input: BODY });
  assert.equal(typo.status, 2, typo.out);
  assert.match(typo.out, /newtop\.js/);
  // gori のプールに回すときは --name を断る。
  const named = pool(s.gori, s.work, improvement('named', ['--file', 'tools/records/pool', '--name', 'other']), { input: BODY });
  assert.equal(named.status, 2, named.out);
  assert.match(named.out, /--name other は付けない/);
  assert.equal(readdirSync(s.pool()).filter((f) => f.endsWith('.md')).length, 2);
  assert.equal(readdirSync(goriPool).filter((f) => f.endsWith('.md')).length, 1);
});

test('端末向けの表示は、最後の列を除いて列幅を揃え、空白二つで繋ぐ', async () => {
  const { alignRows } = await import('../../tools/lib/pool.mjs');
  assert.deepEqual(
    alignRows([
      ['gori', '20261108-072012-a', 'todo', 'learning', '題その一'],
      ['sample-project', '20261112-213230-long-slug', 'proposed', 'improvement', '題'],
    ]),
    ['gori            20261108-072012-a          todo      learning     題その一', 'sample-project  20261112-213230-long-slug  proposed  improvement  題'],
  );
});
