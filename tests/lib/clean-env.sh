# tests/run.sh が、テストの前に読み込む（source する）環境の掃除。
# pre-commit から呼ばれると git が GIT_DIR や GIT_INDEX_FILE を渡す。一時リポジトリを操作するテストがこれを引き継ぐと、本体の .git を書き換える。
# 無人の作業（tools/auto/run）は柵の GIT_CONFIG_* と GORI_AUTO、GORI_IGNORE_UPSTREAM を渡し、レビュアーのセッションには review が GORI_WORK_REPO などを渡す。
# テストの中の道具がこれを受け継ぐと、人間の作業のときと違う結果になるか、テストの一時リポジトリでなく元のリポジトリを読む。
# そこで、GIT_ と GORI_ で始まる環境変数をすべて消す。node のテストの cleanEnv（tests/auto/helpers.mjs など）と同じ扱いである。
while IFS='=' read -r name _; do
  case "$name" in GIT_* | GORI_*) unset "$name" ;; esac
done <<EOF_ENV
$(env)
EOF_ENV
