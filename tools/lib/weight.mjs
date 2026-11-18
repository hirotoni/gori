// レビューの重さを、レビューする範囲の差分のファイルから決める（docs/design.md の「レビューの重さ」）。
// 作業者の申告は使わない。軽い（light）のは、変えたファイルがすべて、ふるまいに効かない文書のときだけである。
// 文書でも、エージェントの振る舞いに効くもの（gori の knowledge/、agents/、hooks/、.claude-plugin/、CLAUDE.md、AGENTS.md、.claude/ の下）はふつう（normal）にする。
// テストと道具は、検査を弱める変更を軽い側に落とさないよう、ふつうにする。

// フォルダは最上位でも入れ子（pkg/.claude-plugin/ など）でも当てる。軽い側を狭く保つためである。
const BEHAVIOR_DIRS = /(^|\/)(knowledge|agents|hooks|tools|tests|\.claude|\.claude-plugin)\//;
const BEHAVIOR_FILES = /(^|\/)(CLAUDE|AGENTS)\.md$/i;

export function reviewWeight(files, { e2e = false } = {}) {
  if (files.length === 0) return { weight: 'normal', reason: '変えたファイルが無い' };
  if (e2e) return { weight: 'normal', reason: 'E2E を渡した' };
  const heavy = files.filter((f) => !/\.md$/i.test(f) || BEHAVIOR_DIRS.test(f) || BEHAVIOR_FILES.test(f));
  if (heavy.length) return { weight: 'normal', reason: `文書でないか、振る舞いに効くファイルがある: ${heavy.slice(0, 5).join('、')}${heavy.length > 5 ? ` ほか ${heavy.length - 5} 件` : ''}` };
  return { weight: 'light', reason: `振る舞いに効かない文書だけを変えた: ${files.slice(0, 5).join('、')}${files.length > 5 ? ` ほか ${files.length - 5} 件` : ''}` };
}
