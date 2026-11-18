// YAML の部分集合だけを読む。部分集合の外は推測せず、行番号つきの誤りとして返す。

class FrontmatterError extends Error {
  constructor(line, message) {
    super(message);
    this.line = line;
  }
}

const KEY_LINE = /^([A-Za-z_][A-Za-z0-9_-]*):(?:[ ]+(.*))?$/;

function readQuoted(raw, start, line) {
  const quote = raw[start];
  const close = raw.indexOf(quote, start + 1);
  if (close < 0) throw new FrontmatterError(line, '引用符が閉じていない');
  const text = raw.slice(start + 1, close);
  if (text.includes('\\')) throw new FrontmatterError(line, 'エスケープ記法は部分集合の外');
  return { text, end: close + 1 };
}

function expectEndOrComment(rest, line) {
  if (rest.trim() !== '' && !/^\s+#/.test(rest)) {
    throw new FrontmatterError(line, '値の後ろに余分な文字がある');
  }
}

function parseList(raw, line) {
  const items = [];
  let i = 1;
  for (;;) {
    while (raw[i] === ' ') i++;
    if (raw[i] === ']') {
      i++;
      break;
    }
    if (i >= raw.length) throw new FrontmatterError(line, 'リストが閉じていない');
    let item;
    if (raw[i] === '"' || raw[i] === "'") {
      const q = readQuoted(raw, i, line);
      item = q.text;
      i = q.end;
    } else {
      let j = i;
      while (j < raw.length && raw[j] !== ',' && raw[j] !== ']') j++;
      if (j >= raw.length) throw new FrontmatterError(line, 'リストが閉じていない');
      item = raw.slice(i, j).trim();
      if (/[[\]{}#]|: /.test(item)) throw new FrontmatterError(line, 'リストの要素に部分集合の外の記法がある');
      i = j;
    }
    if (item === '') throw new FrontmatterError(line, 'リストに空の要素がある');
    items.push(item);
    while (raw[i] === ' ') i++;
    if (raw[i] === ',') {
      i++;
      while (raw[i] === ' ') i++;
      if (raw[i] === ']') throw new FrontmatterError(line, 'リストに空の要素がある');
    } else if (raw[i] !== ']') {
      throw new FrontmatterError(line, 'リストの区切りが不正');
    }
  }
  expectEndOrComment(raw.slice(i), line);
  return items;
}

function parseScalarOrList(raw, line) {
  const trimmed = raw.trim();
  if (trimmed === '') return { type: 'scalar', value: '', line };
  if (trimmed.startsWith('[')) return { type: 'list', value: parseList(trimmed, line), line };
  if (trimmed[0] === '"' || trimmed[0] === "'") {
    const q = readQuoted(trimmed, 0, line);
    expectEndOrComment(trimmed.slice(q.end), line);
    return { type: 'scalar', value: q.text, line };
  }
  if (/^[{|>&*!%@`]/.test(trimmed) || /^-(\s|$)/.test(trimmed) || trimmed.startsWith('#')) {
    if (trimmed.startsWith('#')) return { type: 'scalar', value: '', line };
    throw new FrontmatterError(line, '部分集合の外の記法');
  }
  const comment = trimmed.search(/\s#/);
  const value = (comment >= 0 ? trimmed.slice(0, comment) : trimmed).trim();
  if (/:(\s|$)/.test(value)) throw new FrontmatterError(line, '値に「: 」を含められない（引用符で囲む）');
  return { type: 'scalar', value, line };
}

// lines は frontmatter の内側の行。firstLine はその先頭行の、ファイル内の行番号。
export function parseFrontmatterLines(lines, firstLine) {
  const result = {};
  let i = 0;
  while (i < lines.length) {
    const line = firstLine + i;
    const text = lines[i];
    if (text.trim() === '' || /^\s*#/.test(text)) {
      i++;
      continue;
    }
    if (/\t/.test(text.match(/^\s*/)[0])) throw new FrontmatterError(line, 'インデントにタブは使えない');
    if (/^\s/.test(text)) throw new FrontmatterError(line, '親のないインデント');
    if (/^-(\s|$)/.test(text)) throw new FrontmatterError(line, 'ブロックリストは部分集合の外（[a, b] を使う）');
    const m = KEY_LINE.exec(text.trimEnd());
    if (!m) throw new FrontmatterError(line, '「キー: 値」の形でない');
    const key = m[1];
    if (key in result) throw new FrontmatterError(line, `キー ${key} が重複している`);
    const raw = m[2] ?? '';
    const node = parseScalarOrList(raw, line);
    i++;
    if (/^\s*(#.*)?$/.test(raw)) {
      const child = {};
      let indent = null;
      while (i < lines.length) {
        const cl = lines[i];
        const cline = firstLine + i;
        if (cl.trim() === '' || /^\s*#/.test(cl)) {
          i++;
          continue;
        }
        const ws = cl.match(/^ */)[0].length;
        if (ws === 0) break;
        if (/^\s*\t/.test(cl)) throw new FrontmatterError(cline, 'インデントにタブは使えない');
        if (indent === null) indent = ws;
        if (ws !== indent) throw new FrontmatterError(cline, '二段以上のネストは部分集合の外');
        if (/^\s*-(\s|$)/.test(cl)) throw new FrontmatterError(cline, 'ブロックリストは部分集合の外（[a, b] を使う）');
        const cm = KEY_LINE.exec(cl.trim());
        if (!cm) throw new FrontmatterError(cline, '「キー: 値」の形でない');
        if (cm[1] in child) throw new FrontmatterError(cline, `キー ${cm[1]} が重複している`);
        const cnode = parseScalarOrList(cm[2] ?? '', cline);
        child[cm[1]] = cnode;
        i++;
      }
      result[key] = indent === null ? node : { type: 'map', value: child, line };
    } else {
      result[key] = node;
    }
  }
  return result;
}

// 戻り値の body は閉じの --- の次の行から。bodyLine はその行番号。
export function readFrontmatter(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines[0].trimEnd() !== '---') {
    return { error: new FrontmatterError(1, '先頭に --- がない'), lines };
  }
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trimEnd() === '---') {
      end = i;
      break;
    }
  }
  if (end < 0) return { error: new FrontmatterError(1, '閉じの --- がない'), lines };
  const bodyLines = lines.slice(end + 1);
  const bodyLine = end + 2;
  try {
    const fields = parseFrontmatterLines(lines.slice(1, end), 2);
    return { fields, bodyLines, bodyLine };
  } catch (e) {
    if (e instanceof FrontmatterError) return { error: e, lines, bodyLines, bodyLine };
    throw e;
  }
}
