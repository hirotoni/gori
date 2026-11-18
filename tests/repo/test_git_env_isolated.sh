#!/usr/bin/env bash
# tests/run.sh から起動されたとき、git の環境変数が一つも残っていないこと。
leaked="$(env | grep -E '^GIT_' || true)"
if [ -n "$leaked" ]; then
  echo "FAIL: git の環境変数がテストに漏れている: $leaked"
  exit 1
fi
echo "test_git_env_isolated: OK"
