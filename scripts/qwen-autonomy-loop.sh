#!/usr/bin/env bash
# Hands-off Qwen loop: drain queue with aider-qwen + targeted vitest until Lite dies.
# Usage: nohup scripts/qwen-autonomy-loop.sh >> /workspace/qwen-burn/autonomy.log 2>&1 &
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
BURN="/workspace/qwen-burn"
QUEUE="$BURN/queue"
DONE="$BURN/done"
RESULTS="$BURN/RESULTS.md"
AID="/home/box/.local/bin/aider-qwen"
ENVF="/home/box/.config/aider/dashscope.env"
mkdir -p "$QUEUE" "$DONE"
echo "" >> "$RESULTS"
echo "## AUTONOMY $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$RESULTS"

exhaust_hint() {
  # True if log looks like real quota death (not model prose alone)
  grep -Eiq 'insufficient.?quota|quota.?exceeded|credit.?exhausted|billing|403.*token|401.*api.?key|rate.?limit.*token.?plan|No API-key|Payment Required|402' "$1" 2>/dev/null
}

pick_files_for() {
  local msg="$1"
  case "$msg" in
    *dumpContract*|*dump_contract*) echo "--file src/utils/dumpContract.test.ts --read src/utils/dumpContract.ts" ;;
    *debugRunTree*|*debug_tree*|*dispatch*) echo "--file src/utils/debugRunTree.test.ts --read src/utils/debugRunTree.ts" ;;
    *debugPayload*|*markdown*) echo "--file src/utils/debugPayload.test.ts --read src/utils/debugPayload.ts" ;;
    *live*|*playwright*|*multiturn-meal*) echo "--file prototype/tests/multiturn-meal-edit.live.spec.ts --read scripts/qwen-live-verify.sh" ;;
    *r3*) echo "--file prototype/tests/r3-smoke.spec.ts --read playwright.config.ts" ;;
    *) echo "--file server_meal_edit.test.ts --read server_meal_edit.ts" ;;
  esac
}

run_verify() {
  local msg="$1"
  case "$msg" in
    *dumpContract*|*dump_contract*) npx vitest run src/utils/dumpContract.test.ts ;;
    *debugRunTree*|*debug_tree*|*dispatch*) npx vitest run src/utils/debugRunTree.test.ts ;;
    *debugPayload*) npx vitest run src/utils/debugPayload.test.ts ;;
    *live*|*playwright*|*multiturn-meal*)
      PLAYWRIGHT_TEST_BASE_URL=http://127.0.0.1:3000 scripts/qwen-live-verify.sh "demo shell" || return 1
      ;;
    *r3*) PLAYWRIGHT_TEST_BASE_URL=http://127.0.0.1:3000 npx playwright test prototype/tests/r3-smoke.spec.ts --reporter=list ;;
    *) npx vitest run server_meal_edit.test.ts ;;
  esac
}

seed_more() {
  local n
  n=$(ls "$QUEUE" 2>/dev/null | wc -l)
  if [[ "$n" -gt 0 ]]; then return; fi
  local id
  id=$(date +%s)
  cat > "$QUEUE/auto_${id}_meal.md" << EOM
Add one NEW focused it() in server_meal_edit.test.ts covering an uncovered edit sequence (rename/weight/remove/split/count). Prefer failing-then-fix only if production is wrong; otherwise test-only. No LogChat.tsx.
EOM
  cat > "$QUEUE/auto_${id}_dump.md" << EOM
Add one NEW dumpContract.test.ts case for a contract/table/dispatch PASS or FAIL shape from RELIABILITY §11 not already asserted. Touch dumpContract.ts only if needed. No LogChat.
EOM
  cat > "$QUEUE/auto_${id}_tree.md" << EOM
Add one NEW debugRunTree.test.ts or debugPayload.test.ts assertion for multi-turn dispatches or markdown parity. Minimal. No LogChat.
EOM
}

wave=0
while true; do
  seed_more
  task=$(ls -1 "$QUEUE"/*.md 2>/dev/null | head -1 || true)
  if [[ -z "${task:-}" ]]; then
    echo "empty_queue_reseed" >> "$RESULTS"
    seed_more
    task=$(ls -1 "$QUEUE"/*.md 2>/dev/null | head -1 || true)
  fi
  [[ -z "${task:-}" ]] && { echo "no_tasks_stop" >> "$RESULTS"; break; }

  wave=$((wave+1))
  base=$(basename "$task" .md)
  echo "=== autonomy wave $wave $base $(date -u +%H:%M:%SZ) ===" | tee -a "$BURN/autonomy.log"
  files=$(pick_files_for "$base $(head -1 "$task")")
  log="$BURN/aider_${base}.log"
  # shellcheck disable=SC2086
  set +e
  "$AID" --edit-format diff --env-file "$ENVF" --yes-always --no-auto-commits \
    $files --message-file "$task" >"$log" 2>&1
  ec=$?
  set -e

  tokens=$(rg -o "Tokens: [^\\n]+" "$log" | tail -1 || true)
  applied=$(rg -c "Applied edit to" "$log" || true)
  applied=${applied:-0}

  if exhaust_hint "$log"; then
    # probe once
    probe="$BURN/probe_${wave}.log"
    "$AID" --edit-format diff --env-file "$ENVF" --yes-always --no-auto-commits \
      --message "Reply with exactly: pong" --exit >"$probe" 2>&1 || true
    if exhaust_hint "$probe" || ! rg -qi "pong" "$probe"; then
      echo "EXHAUSTED wave=$wave $base $tokens" | tee -a "$RESULTS"
      mv "$task" "$DONE/" 2>/dev/null || true
      exit 0
    fi
    echo "false_exhaust wave=$wave continued" >> "$RESULTS"
  fi

  set +e
  verify_out=$(run_verify "$base $(head -1 "$task")" 2>&1)
  vec=$?
  set -e
  echo "autonomy_wave=$wave task=$base applied=$applied ec=$ec $tokens verify_ec=$vec" >> "$RESULTS"
  echo "$verify_out" | tail -5 >> "$RESULTS"

  mv "$task" "$DONE/"
  # soft cap per process start so a crashed loop can be restarted
  if [[ "$wave" -ge 80 ]]; then
    echo "HIT_WAVE_CAP_80 restart_me" >> "$RESULTS"
    exit 0
  fi
  sleep 2
done
