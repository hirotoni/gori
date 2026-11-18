#!/usr/bin/env bash
# tools/repo/check-public が公開してはいけないもの（ホームの下の絶対パス、メールアドレス、秘密らしい文字列、手元の禁止語）を見つけ、
# 架空のアドレスと noreply のアドレスと印のある偽の秘密を通すこと、tools/repo/githooks/pre-push が当たったときに push を止めることを確かめる。
set -u
while IFS='=' read -r name _; do
  case "$name" in GIT_*) unset "$name" ;; esac
done <<EOF_ENV
$(env)
EOF_ENV
root="$(cd "$(dirname "$0")/../.." && pwd)"
if ! tmp="$(mktemp -d "${TMPDIR:-/tmp}/gori-test.XXXXXX")" || [ -z "$tmp" ] || [ ! -d "$tmp" ]; then
  echo "FAIL: 一時ディレクトリを作れない"
  exit 1
fi
trap 'rm -rf "$tmp"' EXIT
failures=0
fail() { echo "FAIL: $1"; failures=$((failures + 1)); }

# 道具の写しを持つ一時リポジトリ。フックは自分のリポジトリの tools/repo/check-public を呼ぶ。
repo="$tmp/repo"
mkdir -p "$repo/tools/repo/githooks" "$repo/tools/lib"
cp "$root/tools/repo/check-public" "$repo/tools/repo/"
cp "$root/tools/repo/githooks/pre-push" "$repo/tools/repo/githooks/"
cp "$root/tools/lib/secrets.mjs" "$root/tools/lib/frontmatter.mjs" "$repo/tools/lib/"
g() { git -C "$repo" "$@"; }
g init -q -b main
g config user.name t
g config user.email t@example.invalid
g config core.hooksPath tools/repo/githooks
g add -A && g commit -q -m init
check() { (cd "$repo" && node tools/repo/check-public "$@"); }

out="$(check)"; code=$?
[ "$code" -eq 0 ] || fail "道具の写しだけで当たった（$code）: $out"

# 当たるもの。行ごとに種類が出て、当たった文字列そのものは出さない。
# このテストのファイル自身が check-public に当たらないよう、当たる文字列は実行のときに組み立てる。
U=/Us; U="${U}ers"; HM=/ho; HM="${HM}me"; at=@; akia=AKIA; akia="${akia}ABCDEFGHIJKLMNOP"
printf '%s\n' "cd $U/alice/work" "mail to alice.private${at}corp.example.co.jp" "key $akia" "the word Zorblax appears" > "$repo/bad.txt"
mkdir -p "$repo/.git/gori"
printf '# 手元の禁止語\nzorblax\n' > "$repo/.git/gori/public-deny.txt"
g add -A && g commit -q -m bad
out="$(check 2>&1)"; code=$?
[ "$code" -eq 1 ] || fail "当たりがあるのに終了コードが 1 でない（$code）"
for want in 'bad.txt:1: ホームの下の絶対パス' 'bad.txt:2: メールアドレス' 'bad.txt:3: AWS のアクセスキー' 'bad.txt:4: 禁止語'; do
  printf '%s\n' "$out" | grep -qF "$want" || fail "「$want」が出ない: $out"
done
printf '%s\n' "$out" | grep -qE 'alice|AKIAABCD|Zorblax' && fail "当たった文字列そのものを出した: $out"

# 通すもの。架空のドメインと noreply のアドレス、印のある偽の秘密、プレースホルダのパス。
g rm -q bad.txt
cat > "$repo/ok.txt" <<'EOF'
git config user.email e2e@example.invalid
Co-Authored-By: Claude <noreply@anthropic.com>
someone <123+someone@users.noreply.github.com>
token=abcd1234 // check-public: allow-secret（検査のための偽の値）
置き場所は /Users/<名前>/ の下
EOF
g add -A && g commit -q -m ok
out="$(check 2>&1)"; code=$?
[ "$code" -eq 0 ] || fail "通すべきものが当たった（$code）: $out"

# 印は秘密の検査だけを外し、パスは外さない。
printf '%s\n' "see $HM/bob/x // check-public: allow-secret" > "$repo/marked.txt"
g add -A && g commit -q -m marked
out="$(check 2>&1)"; code=$?
[ "$code" -eq 1 ] && printf '%s\n' "$out" | grep -qF 'marked.txt:1: ホームの下の絶対パス' || fail "印でパスの検査まで外れた（$code）: $out"
g rm -q marked.txt && g commit -q -m unmark

# commit のメッセージも、-- の後の範囲で見る。
g commit -q --allow-empty -m "see $U/carol/notes"
out="$(check -- HEAD~1..HEAD 2>&1)"; code=$?
[ "$code" -eq 1 ] && printf '%s\n' "$out" | grep -qF 'のメッセージ:1: ホームの下の絶対パス' || fail "メッセージの当たりを出さない（$code）: $out"
out="$(check 2>&1)"; code=$?
[ "$code" -eq 0 ] || fail "範囲を渡さないのにメッセージを見た（$code）: $out"

# 範囲の commit が足した行も見る。足した commit と消した commit の二つを渡すと、先端に無くても当たる。
printf '%s\n' "ok line" "key $akia" > "$repo/leak.txt"
g add -A && g commit -q -m leak
g rm -q leak.txt && g commit -q -m unleak
leak="$(g rev-parse --short=12 HEAD~1)"
out="$(check -- HEAD~2..HEAD 2>&1)"; code=$?
[ "$code" -eq 1 ] && printf '%s\n' "$out" | grep -qF "commit $leak の leak.txt:2: AWS のアクセスキー" || fail "足して消した中身の当たりを出さない（$code）: $out"
printf '%s\n' "$out" | grep -qF "$akia" && fail "足して消した中身の当たった文字列を出した: $out"
out="$(check -- HEAD~1..HEAD 2>&1)"; code=$?
[ "$code" -eq 0 ] || fail "範囲の外の commit が足した行まで見た（$code）: $out"

# 使い方の誤りは 2。
check --nope >/dev/null 2>&1; code=$?
[ "$code" -eq 2 ] || fail "使い方の誤りで 2 でない（$code）"

# pre-push は、別の一時リポジトリで確かめる（上のリポジトリの履歴には、当たる中身を足して消した commit がある）。
src="$tmp/src"
mkdir -p "$src/tools/repo/githooks" "$src/tools/lib"
cp "$repo/tools/repo/check-public" "$src/tools/repo/"
cp "$repo/tools/repo/githooks/pre-push" "$src/tools/repo/githooks/"
cp "$repo/tools/lib/secrets.mjs" "$repo/tools/lib/frontmatter.mjs" "$src/tools/lib/"
s() { git -C "$src" "$@"; }
s init -q -b main
s config user.name t
s config user.email t@example.invalid
s config core.hooksPath tools/repo/githooks
s add -A && s commit -q -m init
remote="$tmp/remote.git"
git init -q --bare "$remote"
s remote add origin "$remote"

# 新しいブランチの形：送る先に何も無い push で、足して消した中身があれば止める。
printf '%s\n' "key $akia" > "$src/leak.txt"
s add -A && s commit -q -m leak
s rm -q leak.txt && s commit -q -m unleak
s push -q origin main >/dev/null 2>&1 && fail "足して消した中身を含む新しいブランチの push が通った"
git -C "$remote" rev-parse -q --verify refs/heads/main >/dev/null && fail "止めたはずの push で送る先に main ができた"
s reset -q --hard HEAD~2
s push -q origin main >/dev/null 2>&1 || fail "当たりの無い push が止まった"

# 更新の形：送る先にある commit の後に、足して消した中身があれば止める。
printf '%s\n' "key $akia" > "$src/leak.txt"
s add -A && s commit -q -m leak
s rm -q leak.txt && s commit -q -m unleak
s push -q origin main >/dev/null 2>&1 && fail "足して消した中身を含む更新の push が通った"
s reset -q --hard HEAD~2

# 送る先にまだ無い commit のメッセージに当たれば止め、直せば通る。
s commit -q --allow-empty -m "see $U/carol/notes"
s push -q origin main >/dev/null 2>&1 && fail "当たりのあるメッセージを含む push が通った"
s reset -q --hard HEAD~1
# 送る先にある commit は見ず、新しいファイルの中身の当たりで止める。
printf '%s\n' "path $HM/dave/y" > "$src/new.txt"
s add -A && s commit -q -m new
s push -q origin main >/dev/null 2>&1 && fail "当たりのあるファイルを含む push が通った"

if [ "$failures" -gt 0 ]; then exit 1; fi
echo "test_check_public: OK"
