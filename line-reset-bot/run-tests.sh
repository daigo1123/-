#!/bin/sh
# テスト実行: sh run-tests.sh
# src/index.js の内部関数をテストから触れるようにコピーを作ってから実行する
set -e
cd "$(dirname "$0")"
cp src/index.js test-target.mjs
cat >> test-target.mjs <<'EXPORTS'

export const __test = { SESSIONS, SESSION_HOURS, QUESTIONS, jstHour, jstDate, parseDateArg, pendingKeys, KEY_BY_LABEL, handleEvent };
EXPORTS
node test.mjs
rm -f test-target.mjs
