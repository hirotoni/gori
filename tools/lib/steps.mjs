// 手順書の「## 手順」節を、番号付きリストとして読む。lint と log start が同じ読み方を使う。
// 項目の続きの行は字下げされた行で、空白でつないで一項目にする。
export function procedureSteps(bodyLines, firstLine = 1) {
  const start = bodyLines.findIndex((l) => /^##\s+手順\s*$/.test(l));
  if (start < 0) return { steps: [], error: { line: firstLine, message: '見出し「## 手順」がない' } };
  const steps = [];
  for (let i = start + 1; i < bodyLines.length; i++) {
    const raw = bodyLines[i];
    const line = firstLine + i;
    if (/^##\s/.test(raw)) break;
    if (raw.trim() === '') continue;
    const m = /^(\d+)\.\s+(\S.*)$/.exec(raw);
    if (m) {
      steps.push({ n: Number(m[1]), text: m[2].trim(), line });
    } else if (/^\s+\S/.test(raw) && steps.length > 0) {
      steps.at(-1).text += ` ${raw.trim()}`;
    } else {
      return { steps, error: { line, message: '「## 手順」に番号付きリスト（1. から始まる項目）でない行がある' } };
    }
  }
  if (steps.length === 0) return { steps, error: { line: firstLine + start, message: '「## 手順」が空である' } };
  const bad = steps.findIndex((s, i) => s.n !== i + 1);
  if (bad >= 0) return { steps, error: { line: steps[bad].line, message: `番号が 1 からの連番でない（${bad + 1} 番目の項目が ${steps[bad].n}）` } };
  return { steps, error: null };
}
