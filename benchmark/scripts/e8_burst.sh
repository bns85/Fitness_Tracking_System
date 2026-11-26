#!/usr/bin/env bash
# benchmark/scripts/e8_burst.sh — E8 Burst Traffic Runner
# Simulates sudden surge: 0 to 200 concurrent clients arriving in 5 seconds.
# Measures delivery latency p95 and connection timeouts under shock load.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
RESULTS_DIR="$ROOT/benchmark/results"
RUN_LOG="$RESULTS_DIR/RUN_LOG.md"
mkdir -p "$RESULTS_DIR/logs"

START_ISO=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

echo "=========================================================="
echo " Starting Experiment E8 (Sudden Burst Load: 0 -> 200 in 5s)"
echo "=========================================================="

for variant in "event" "modular" "micro"; do
  echo ">>> Testing Burst on $variant <<<"
  EXP="e8_burst" RUN_LABEL="${variant}_burst" VARIANT="$variant" \
  STEPS="200" HOLD_S="60" WARMUP_S="5" BURST="1" \
  node "$ROOT/benchmark/loadgen.js" 2>&1 | tee "$RESULTS_DIR/logs/e8_${variant}_burst.log"
done

END_ISO=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

cat <<EOF >> "$RUN_LOG"

### E8 Burst Load ($START_ISO to $END_ISO)
- 0 to 200 clients ramped in 5 seconds (BURST=1)
- Measures shock-load delivery p95 and connection timeouts
EOF
echo "Experiment E8 complete."
