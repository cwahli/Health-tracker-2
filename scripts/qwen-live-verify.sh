#!/usr/bin/env bash
# Run Playwright live UI checks the way Grok Bot verifies by hand.
# Usage: scripts/qwen-live-verify.sh [spec-file-or-grep]
# Requires tracker on :3000 (or set PLAYWRIGHT_TEST_BASE_URL).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export PLAYWRIGHT_TEST_BASE_URL="${PLAYWRIGHT_TEST_BASE_URL:-http://127.0.0.1:3000}"
TARGET="${1:-multiturn-meal-edit.live}"
# Prefer grep match so we don't need full path
if [[ "$TARGET" == *.ts ]]; then
  npx playwright test "$TARGET" --reporter=list
else
  npx playwright test --grep "$TARGET" --reporter=list
fi
