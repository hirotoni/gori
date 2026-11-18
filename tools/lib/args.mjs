// 道具の引数を読む。道具ごとに、値を取るフラグ（value）、繰り返せるフラグ（repeat）、値を取らないフラグ（bool）の表を渡す。
// 表に無いフラグと、値を取るフラグの値が無い（最後の語か、次の語がフラグの形）ときは、何も読まずに終了コード 2 で止める。
// フラグの形は、-- の直後が英小文字で、その後が英小文字・数字・ハイフンだけの語とする（例：--evidnce）。
// 値は自由な文で、-- で始まることもある（例：-----BEGIN、--- 区切り）。それは値として通し、綴りを誤ったフラグは値として読まない。（check-public: allow-secret）
// 呼ぶのはエージェントで、綴りを誤ったフラグを黙って受けると、検査が外れたり空の欄が追記されたりするためである。
export function parseArgs(argv, { value = [], repeat = [], bool = [] }, usage = '') {
  const fail = (msg) => {
    console.error(usage ? `${msg}\n${usage}` : msg);
    process.exit(2);
  };
  const flagShaped = (w) => /^--[a-z][a-z0-9-]*$/.test(w);
  const flags = {};
  for (const k of repeat) flags[k] = [];
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      positional.push(a);
      continue;
    }
    const key = a.slice(2);
    if (bool.includes(key)) {
      flags[key] = true;
      continue;
    }
    if (!value.includes(key) && !repeat.includes(key)) fail(`知らないフラグ ${a}`);
    const v = argv[i + 1];
    if (v === undefined || flagShaped(v)) fail(`${a} に値が無い`);
    i++;
    if (repeat.includes(key)) flags[key].push(v);
    else flags[key] = v;
  }
  return { flags, positional };
}
