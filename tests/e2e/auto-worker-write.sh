#!/usr/bin/env bash
# モデルを呼ぶので tests/run.sh には入れない。手動で実行する。
# tools/auto/run が起動した担当が、gori の作業の worktree の knowledge の下を Write と Edit で書けること、
# そのときも本体のチェックアウトの main を動かす操作は柵に拒まれることを確かめる。
# run の起動の形（--plugin-dir、--allowedTools、柵の環境）はそのまま使い、依頼文とモデルだけを差し替える。担当は haiku で一回だけ起動する。
set -u
gori="$(cd "$(dirname "$0")/../.." && pwd)"
out="${E2E_OUT:-$(mktemp -d "${TMPDIR:-/tmp}/gori-e2e.XXXXXX")}"
out="$(cd "$out" && pwd -P)"
real_claude="$(type -P claude)" || { echo "claude が PATH に無い" >&2; exit 1; }

# shellcheck source=lib/no-wrapper-hooks.sh
. "$gori/tests/e2e/lib/no-wrapper-hooks.sh"
# shellcheck source=../lib/fake-gori.sh
. "$gori/tests/lib/fake-gori.sh"
use_fake_gori "$out/gori" || exit 1
fg="$GORI_ROOT"
cd "$fg" || exit 1
git checkout -q -b main
git config user.name e2e
git config user.email e2e@example.invalid
# 一時の gori を、そのまま gori のプールの作業リポジトリにする（本物の gori の作業と同じ配置）。
# 本物と同じく、道具を置いたチェックアウトを記録の gori にもする（run は自分のチェックアウトをプラグインとして渡す）。
# 確かめる版の作業ツリー（追跡しているファイルと、無視されていない新しいファイル）を写す。
(cd "$gori" && git ls-files -co --exclude-standard -z | xargs -0 tar -cf -) | tar -xf - || exit 1
mkdir -p knowledge/skills/demo
printf 'before\n' > knowledge/skills/demo/SKILL.md
printf '.worktree/\n' > .gitignore
git add -A
git commit -q -m "初期の状態"
id=20261115-090000-worker-write
rec_dir="$(gori_records "$fg" gori)"
mkdir -p "$rec_dir/pool"
printf 'path: %s\n' "$fg" > "$rec_dir/repo.yml"
cat > "$rec_dir/pool/$id.md" <<ITEM
---
id: $id
title: 知識ファイルを書く
kind: learning
status: todo
created: 2026-11-15T09:00:00+09:00
updated: 2026-11-15T09:00:00+09:00
---
## 現状
x
## 問題
x
## 期待する結果
x
## 確認したこと
x
## 受け入れ条件
- 書ける
ITEM

# run が起動する claude の代わり。run の引数のうち、依頼文とモデルだけを差し替えて本物の claude を起動する。
# 起動の前に、柵の環境のまま本体の main を動かそうとして、結果を残す。
wt="$fg/.worktree/gori/e2e-worker"
wrapper="$out/claude"
cat > "$wrapper" <<WRAP
#!/usr/bin/env bash
[ "\${1:-}" = auth ] && exec "$real_claude" "\$@"
git -C "$fg" commit -q --allow-empty -m moved > "$out/move-main.out" 2>&1
echo "\$?" > "$out/move-main.code"
git -C "$fg" worktree add -q -b e2e-worker "$wt" || exit 9
prompt="Use the Write tool to create the file $wt/knowledge/procedures/e2e-new.md with the content 'new'. Then use the Edit tool to replace 'before' with 'after' in $wt/knowledge/skills/demo/SKILL.md. Do not use Bash. Report whether each tool call succeeded."
args=()
while [ \$# -gt 0 ]; do
  case "\$1" in
    -p) args+=(-p "\$prompt"); shift 2 ;;
    --model) args+=(--model haiku); shift 2 ;;
    --plugin-dir) printf '%s\n' "\$2" > "$out/plugin-dir"; args+=("\$1" "\$2"); shift 2 ;;
    # 道具の呼び出しと結果を確かめるため、流れの形で受けて残し、run には最後の結果の行だけを返す。
    --output-format) args+=(--output-format stream-json --verbose); shift 2 ;;
    *) args+=("\$1"); shift ;;
  esac
done
"$real_claude" "\${args[@]}" < /dev/null > "$out/stream.jsonl"
code=\$?
grep '"type":"result"' "$out/stream.jsonl" | tail -1
exit \$code
WRAP
chmod +x "$wrapper"

main_before=$(git rev-parse refs/heads/main)
GORI_CLAUDE_BIN="$wrapper" "$fg/tools/auto/run" > "$out/run.out" 2> "$out/run.err"
code=$?

fails=0
check() { if eval "$2"; then echo "ok   $1"; else echo "FAIL $1${3:+: $3}"; fails=$((fails + 1)); fi; }
plugin="$(cat "$out/plugin-dir" 2>/dev/null)"
check "run が担当を起動した（RESULT=failed でない）" '[ "$code" -eq 0 ] && ! grep -q "^RESULT=failed" "$out/run.out"' "$(tail -2 "$out/run.out") $(cat "$out/run.err")"
check "--plugin-dir は gori の記録の場所の下の worktree で、担当の worktree を含まない" '[ "$plugin" = "$fg/.git/gori/auto/plugin" ] && case "$wt/" in "$plugin"/*) false ;; *) true ;; esac' "$plugin"
check "--plugin-dir は main の先端を指す" '[ "$(git -C "$plugin" rev-parse HEAD 2>/dev/null)" = "$main_before" ]'
check "担当が knowledge/procedures の下に新しいファイルを Write で作れた" '[ "$(cat "$wt/knowledge/procedures/e2e-new.md" 2>/dev/null)" = new ]'
check "担当が knowledge/skills の下の既存のファイルを Edit で直せた" '[ "$(cat "$wt/knowledge/skills/demo/SKILL.md" 2>/dev/null)" = after ]'
# 担当が Bash で書いても中身は同じになるので、Write と Edit の呼び出しが拒まれずに成功したことを、流れの記録から確かめる。
tool_ok() {
  STREAM="$out/stream.jsonl" TOOL="$1" FILE="$2" node --input-type=module -e '
import { readFileSync } from "node:fs";
const lines = readFileSync(process.env.STREAM, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return {}; } });
const blocks = lines.flatMap((m) => (Array.isArray(m.message?.content) ? m.message.content : []));
const uses = blocks.filter((b) => b.type === "tool_use" && b.name === process.env.TOOL && b.input?.file_path === process.env.FILE).map((b) => b.id);
const ok = uses.some((id) => blocks.some((b) => b.type === "tool_result" && b.tool_use_id === id && !b.is_error));
const denied = lines.filter((m) => m.type === "result").flatMap((m) => m.permission_denials ?? []).some((d) => d.tool_name === process.env.TOOL);
process.exit(ok && !denied ? 0 : 1);'
}
check "Write の呼び出しが拒まれずに成功した（Bash で書いていない）" 'tool_ok Write "$wt/knowledge/procedures/e2e-new.md"'
check "Edit の呼び出しが拒まれずに成功した（Bash で書いていない）" 'tool_ok Edit "$wt/knowledge/skills/demo/SKILL.md"'
check "柵の環境で本体の main を動かす commit が拒まれた" '[ "$(cat "$out/move-main.code")" != 0 ] && grep -q auto-fence "$out/move-main.out"' "$(cat "$out/move-main.out")"
check "本体の main が動いていない" '[ "$(git rev-parse refs/heads/main)" = "$main_before" ]'

echo "--- run の出力"
cat "$out/run.out" "$out/run.err"
if [ "$fails" -gt 0 ]; then echo "FAILED: $fails 件（出力: ${out}）"; exit 1; fi
echo "all passed"
