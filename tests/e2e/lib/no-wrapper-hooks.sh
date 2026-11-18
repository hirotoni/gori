# shellcheck shell=bash
# claude -p を走らせる E2E が source する。許可を求める呼び出しで、答えを待ったまま止まらないようにする。
# 端末の多重化ツール cmux のラッパー（PATH 上の claude のシム）は、--settings で PermissionRequest の hook を差し込む。
# その hook は答えが来るまで（timeout の 125 秒まで）許可を求める呼び出しを止め、待つ間に端末で許可されれば拒否でなく許可になる。
# CMUX_CLAUDE_HOOKS_DISABLED=1 でラッパーに何も差し込ませず、hook の無い claude -p と同じく、その場で理由つきの拒否にする。cmux の外では何も変えない。
# --permission-mode dontAsk にしないのは、拒否の文面が回避を試みないよう求め、拒否の後にモデルが作業を止めて E2E の結果が変わるためである（pause-resume を走らせて確かめた）。
# enterworktree-denied.sh が dontAsk なのは、呼べば必ず拒否される条件そのものを確かめるためである。
# これは cmux のラッパーが CMUX_CLAUDE_HOOKS_DISABLED を見ることに頼る（cmux-claude-wrapper で確かめた）。許可を求める呼び出しのたびに約 125 秒延びるようになったら、まずラッパーがまだこの変数を見るかを確かめる。
export CMUX_CLAUDE_HOOKS_DISABLED=1
