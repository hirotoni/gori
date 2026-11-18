// Claude Code の会話の記録（~/.claude/projects/<project>/<session>.jsonl）を読む。何も書かない。
// 会話の記録は退避しないので、ここにある関数はどれも「消えていれば無い」を正常として扱う。
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

// GORI_PROJECTS_DIR は、合成の会話の記録で抽出を試すための差し替え口である。
export function projectsDir(flag) {
  return resolve(flag ?? process.env.GORI_PROJECTS_DIR ?? join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects'));
}

// セッションの記録は <project>/<session>.jsonl の一段だけにある。
// それより深い場所（<session>/subagents/ など）はサブエージェントの記録なので、セッションとして数えない。
export function sessionFiles(projects) {
  const out = new Map();
  if (!existsSync(projects)) return out;
  for (const p of readdirSync(projects).sort()) {
    const dir = join(projects, p);
    if (!statSync(dir).isDirectory()) continue;
    for (const name of readdirSync(dir).sort()) {
      if (!name.endsWith('.jsonl')) continue;
      const file = join(dir, name);
      if (!statSync(file).isFile()) continue;
      const id = name.slice(0, -'.jsonl'.length);
      if (!out.has(id)) out.set(id, file);
    }
  }
  return out;
}

export function readLines(file) {
  const rows = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      // 書きかけの行や壊れた行は読み飛ばす。
    }
  }
  return rows;
}

// 人間の発言は、type が user で、本文が文字列か text ブロックだけのもの。tool_result、メタ行、サブエージェントの行、会話の要約の行は除く。
// 会話の要約（isCompactSummary）は Claude Code が書いた文で、人間の発言ではない。数えると、要約の後に、要約の前の人間の返事を引けなくなる。
// この関数を使う抽出の材料（humanMessages、isExtractionSession）でも、要約の行は人間の発言に数えない。
export function humanText(o) {
  if (o.type !== 'user' || o.isMeta || o.isSidechain || o.isCompactSummary || !o.uuid) return null;
  const c = o.message?.content;
  if (typeof c === 'string') return c.trim() || null;
  if (!Array.isArray(c) || c.some((b) => b.type === 'tool_result')) return null;
  const t = c.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  return t || null;
}

// 選択式の質問（AskUserQuestion）への人間の回答。会話の記録では tool_result の行で、toolUseResult.answers に {問い: 選んだ答え} が残る。
// 選んだ答えは人間が選ぶか書いたものだが、問いの文はエージェントが書いたものなので、分けて返す。回答でない行は null。
export function choiceAnswers(o) {
  if (o.type !== 'user' || o.isMeta || o.isSidechain || !o.uuid) return null;
  const answers = o.toolUseResult?.answers;
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return null;
  const out = Object.entries(answers)
    .filter(([, a]) => typeof a === 'string' && a.trim())
    .map(([question, answer]) => ({ question, answer }));
  return out.length ? out : null;
}

// エージェントの発言の本文（text ブロック）。ツールの呼び出しだけの行とサブエージェントの行は null。
export function assistantText(o) {
  if (o.type !== 'assistant' || o.isSidechain || !Array.isArray(o.message?.content)) return null;
  const t = o.message.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  return t || null;
}

// 人間の発言の直前にエージェントが示したもの（案、問い、報告）。訂正か、案を選んだだけかを読み分けるために、発言に添える。
// 案や問いは発言の終わりに来るので、末尾を BEFORE_MAX 文字だけ残す。
const BEFORE_MAX = 400;
function clipBefore(text) {
  const s = squash(text);
  return [...s].length > BEFORE_MAX ? `…${[...s].slice(-BEFORE_MAX).join('')}` : s;
}

// 行を順に読み、人間の発言ごとに、前の人間の発言から後のエージェントの発言をつないだものの末尾を before として返す。
// 最後の発言だけにすると、同じ番の前の方で示した案が、後の短い報告に隠れるためである。
export function* withBefore(rows) {
  let said = [];
  for (const o of rows) {
    const a = assistantText(o);
    if (a !== null) said.push(a);
    const text = humanText(o);
    if (text === null) continue;
    yield { o, text, before: said.length ? clipBefore(said.join('\n')) : null };
    said = [];
  }
}

export function humanMessages(rows) {
  const out = [];
  for (const { o, text, before } of withBefore(rows)) out.push({ message: o.uuid, time: o.timestamp ?? null, text, ...(before ? { before } : {}) });
  return out;
}

// 引用の照合は空白の違いを無視する。改行を一行に詰めた引用でも、元の発言に含まれていれば一致とする。
export const squash = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

// 抽出だけの会話は、抽出の材料ではない。抽出の結果を抽出し直すと、同じ学びが増えるためである。
// 抽出だけの会話とは、抽出を呼んだ発言（/gori:extract のコマンドか、次に Skill で gori:extract を呼ばせた発言）と
// バックグラウンドの作業の通知のほかに、人間の発言が無い会話である。
// 作業の途中で抽出を呼んだ会話は、作業の部分を読むために材料に残す。
const EXTRACT_COMMAND = /<command-name>\/?gori:extract<\/command-name>/;
const NOTIFICATION = /^<task-notification>/;
const callsExtract = (o) =>
  o.type === 'assistant' && !o.isSidechain && Array.isArray(o.message?.content) && o.message.content.some((b) => b.type === 'tool_use' && b.name === 'Skill' && b.input?.skill === 'gori:extract');

export function isExtractionSession(rows) {
  let called = false;
  // 抽出を呼ばせたかがまだ決まっていない発言。次の発言より前に抽出が呼ばれれば、抽出を呼んだ発言である。
  let pending = false;
  for (const o of rows) {
    if (callsExtract(o)) {
      called = true;
      pending = false;
      continue;
    }
    const text = humanText(o);
    if (text === null || NOTIFICATION.test(text)) continue;
    if (pending) return false;
    if (EXTRACT_COMMAND.test(text)) called = true;
    else pending = true;
  }
  return called && !pending;
}

// claude -p で起動したセッション（E2E、レビュアー、抽出、委任先の実行）は、会話の記録の entrypoint が sdk-cli になる。
// 人間がその場で訂正した会話ではないので、抽出の材料にしない。レビュアーの会話もこれに当たる。
export function isHeadlessSession(rows) {
  return rows.some((o) => o.entrypoint === 'sdk-cli');
}

// 人間の決定（承認の行、プールの却下）に添える引用を、今の会話の最後の人間の入力と照らす。
// 最後の入力に限るのは、古い返事や担当の言い換えを人間の決定として残させないためである。作業の通知（<task-notification>）は人間の入力に数えない。
// 人間の入力は、文章の発言と、選択式の質問（AskUserQuestion）への回答である。回答では、引用を選んだ答えとだけ照合する。
// 問いの文は担当が書いたものなので、照合に使うと、担当が自分の書いた文を人間の決定に見せかけられるためである。
// 引用の外に問いがあれば、返事は求めた決定ではない（学び proceed-without-approval）。
// 承認の行は、問いの検査を飛ばす（questions: false）。返事が案を変える指示でないかと、案や受け入れ条件を左右する問いに答えているかは、担当が読み、レビュアーが確かめる（agents/reviewer）。
// 返すのは { evidence }。照らせなければ { rule, reason } を返す。rule は 'unverified'、'question'。
const TASK_NOTIFICATION = /^<task-notification>/;
function lastHumanInput(rows) {
  let last = null;
  for (const o of rows) {
    const text = humanText(o);
    if (text !== null && !TASK_NOTIFICATION.test(text)) last = { kind: 'text', message: o.uuid, text };
    const answers = choiceAnswers(o);
    if (answers) last = { kind: 'choice', message: o.uuid, answers, questions: Array.isArray(o.toolUseResult.questions) ? o.toolUseResult.questions : null };
  }
  return last;
}
export function checkHumanQuote(quote, { session, projects, questions: checkQuestions = true }) {
  const q = squash(quote);
  if (!q) return { rule: 'unverified', reason: '引用が空' };
  const file = sessionFiles(projectsDir(projects)).get(session);
  if (!file) return { rule: 'unverified', reason: `セッション ${session} の会話の記録が見つからない` };
  const last = lastHumanInput(readLines(file));
  if (!last) return { rule: 'unverified', reason: `セッション ${session} の会話の記録に人間の発言が無い` };
  // 空白は無視して比べる。改行を詰めた切り出しも、空白を入れて詰めた切り出しも、元の発言に含まれていれば一致とする。
  const bare = (t) => String(t).replace(/\s+/g, '');
  const head = (t) => [...squash(t)].slice(0, 80).join('');
  const questions = (text) => {
    if (!checkQuestions) return null;
    const asked = questionsOutside(text, bare(q));
    return asked.length ? { rule: 'question', reason: `返事に問いがある（${asked.map((s) => `「${s}」`).join('、')}）` } : null;
  };
  if (last.kind === 'choice') {
    const hit = last.answers.find((a) => bare(a.answer).includes(bare(q)));
    if (!hit) return { rule: 'unverified', reason: `引用「${q}」が、今の会話の最後の人間の入力（選択式の質問への回答）の選んだ答えに含まれていない（選んだ答え: ${last.answers.map((a) => `「${head(a.answer)}」`).join('、')}）。問いの文は照合に使わない` };
    return questions(hit.answer) ?? { evidence: `回答 ${last.message} 問い「${head(hit.question)}」 答え「${squash(hit.answer)}」 引用「${q}」` };
  }
  if (!bare(last.text).includes(bare(q))) {
    return { rule: 'unverified', reason: `引用「${q}」が、今の会話の最後の人間の発言に含まれていない（最後の発言の先頭: ${head(last.text)}）` };
  }
  return questions(last.text) ?? { evidence: `発言 ${last.message} 「${q}」` };
}

// 問いと見なす文は、？ か ? を含む文と、文末が「か」で終わる文である。文は 。！!？? と改行で区切る。
// 引用に含まれる文は数えない。返事の中で決定の言葉として切り出した部分だからである。
function questionsOutside(text, bareQuote) {
  const out = [];
  for (const raw of String(text).match(/[^。！!？?\n]*[。！!？?\n]?/g) ?? []) {
    const sentence = raw.trim();
    const b = sentence.replace(/\s+/g, '');
    if (!b || bareQuote.includes(b)) continue;
    if (/[？?]/.test(sentence) || /か[。！!\s]*$/.test(sentence)) out.push(sentence);
  }
  return out;
}
