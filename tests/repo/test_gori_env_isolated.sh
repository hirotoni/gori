#!/usr/bin/env bash
# tests/run.sh から起動されたとき、review がレビュアーに渡す gori の環境変数が一つも残っていないこと。
leaked="$(env | grep -E '^(GORI_WORK_REPO|GORI_VERDICT_OUTBOX|GORI_REVIEWING)=' | cut -d= -f1 || true)"
if [ -n "$leaked" ]; then
  echo "FAIL: レビュアーの環境変数がテストに漏れている: $leaked"
  exit 1
fi
echo "test_gori_env_isolated: OK"
