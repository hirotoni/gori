// 秘密情報らしい文字列を見分ける。
// 事例、判断の記録、プール、レビュー結果は、作業が終わっても残り、事例は git にも載るので、書く前にこれで検査する。
// 公開前の検査（tools/repo/check-public）も同じ形を使う。
// 値そのものはエラーにも出さず、どの形に当たったかだけを返す。
const SECRET_PATTERNS = [
  ['秘密鍵（-----BEGIN）', /-----BEGIN/], // check-public: allow-secret（検査のための偽の値）
  ['AWS のアクセスキー', /\b(AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['GitHub のトークン', /\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/],
  ['API キー（sk-）', /\bsk-[A-Za-z0-9_-]{20,}/],
  ['Slack のトークン', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['Google の API キー', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['JWT', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./],
  ['Bearer トークン', /\bBearer\s+[A-Za-z0-9._~+/-]{20,}/i],
  ['Basic 認証', /\bBasic\s+[A-Za-z0-9+/]{8,}={0,2}/],
  ['URL の利用者名とパスワード', /\b[a-z][a-z0-9+.-]*:\/\/[^\s/?#@:]+:[^\s/?#@]+@/i],
  ['パスワードやトークンの代入', /(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|パスワード|トークン)["']?\s*[:=：]\s*["']?[A-Za-z0-9!#$%&*+./=?@^_~-]{4,}/i],
];

export function secretKinds(text) {
  if (typeof text !== 'string') return [];
  return SECRET_PATTERNS.filter(([, re]) => re.test(text)).map(([name]) => name);
}

// 欄の名前と値の組から、当たった欄と形を「--what（JWT）」の形で返す。値は配列でもよい。何も当たらなければ空の配列を返す。
export function secretFields(fields) {
  const out = [];
  for (const [name, value] of Object.entries(fields)) {
    const kinds = [...new Set([value].flat().flatMap((v) => secretKinds(v)))];
    if (kinds.length) out.push(`${name}（${kinds.join('、')}）`);
  }
  return out;
}
