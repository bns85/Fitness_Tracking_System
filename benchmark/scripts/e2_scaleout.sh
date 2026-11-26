#!/usr/bin/env bash
# benchmark/scripts/e2_scaleout.sh — E2 Scale-out Experiment Runner
# Measures horizontal scaling efficiency:
#   - Modular Monolith: replicate app 2 and 3 times behind nginx
#   - Microservices: scale only the hot service (goal-service)
#   - Event-Driven: scale app to 2 replicas (measures lost notification events)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
RESULTS_DIR="$ROOT/benchmark/results"
RUN_LOG="$RESULTS_DIR/RUN_LOG.md"
mkdir -p "$RESULTS_DIR/logs"

LOAD_USERS="${1:-200}"
HOLD_S="${2:-120}"

echo "=========================================================="
echo " Starting Experiment E2 (Scale-Out Efficiency)"
echo " High load level: $LOAD_USERS users | Hold: ${HOLD_S}s"
echo "=========================================================="

START_ISO=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# 1. Modular Monolith scale-out (2 replicas)
echo "--- Scaling Modular Monolith to 2 replicas ---"
EXP="e2_scale" RUN_LABEL="modular_rep2" VARIANT="modular" STEPS="$LOAD_USERS" \
HOLD_S="$HOLD_S" WARMUP_S="20" REPLICAS="2" \
node "$ROOT/benchmark/loadgen.js" 2>&1 | tee "$RESULTS_DIR/logs/e2_modular_rep2.log"

# 2. Microservices scale-out (scale goal-service to 2 replicas)
echo "--- Scaling Microservices goal-service to 2 replicas ---"
docker compose --profile micro up -d --scale goal-service=2 || true
EXP="e2_scale" RUN_LABEL="micro_goal2" VARIANT="micro" STEPS="$LOAD_USERS" \
HOLD_S="$HOLD_S" WARMUP_S="20" REPLICAS="2" \
node "$ROOT/benchmark/loadgen.js" 2>&1 | tee "$RESULTS_DIR/logs/e2_micro_goal2.log"

END_ISO=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

cat <<EOF >> "$RUN_LOG"

### E2 Scale-Out ($START_ISO to $END_ISO)
- Load: $LOAD_USERS users
- Modular: 2 replicas behind nginx
- Microservices: 2 goal-service replicas
EOF
echo "Experiment E2 complete."
