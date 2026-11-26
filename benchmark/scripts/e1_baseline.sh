#!/usr/bin/env bash
# benchmark/scripts/e1_baseline.sh — E1 Baseline Experiment Runner
# Tests variants: event, modular, micro across load levels (10, 50, 100, 200)
# 3 runs each, 120s hold, 20s warmup, resets DBs between trials.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
RESULTS_DIR="$ROOT/benchmark/results"
RUN_LOG="$RESULTS_DIR/RUN_LOG.md"
mkdir -p "$RESULTS_DIR/logs"

STEPS="${1:-10,50,100,200}"
HOLD_S="${2:-120}"
WARMUP_S="${3:-20}"
VARIANTS_TO_TEST=("event" "modular" "micro")

reset_db() {
  local var="$1"
  echo "--- Resetting DB and Redis for $var ---"
  if [ "$var" = "micro" ]; then
    docker exec mongo-micro mongosh fitness_telemetry --quiet --eval "db.dropDatabase()" >/dev/null 2>&1 || true
    docker exec mongo-micro mongosh fitness_goals --quiet --eval "db.dropDatabase()" >/dev/null 2>&1 || true
    docker exec mongo-micro mongosh fitness_notifications --quiet --eval "db.dropDatabase()" >/dev/null 2>&1 || true
    docker exec mongo-micro mongosh fitness_workouts --quiet --eval "db.dropDatabase()" >/dev/null 2>&1 || true
    docker exec redis-micro redis-cli FLUSHALL >/dev/null 2>&1 || true
  else
    docker exec "mongo-$var" mongosh "fitness_$var" --quiet --eval "db.dropDatabase()" >/dev/null 2>&1 || true
    docker exec "redis-$var" redis-cli FLUSHALL >/dev/null 2>&1 || true
  fi
}

wait_healthy() {
  local port="$1"
  local url="http://localhost:$port/health"
  echo "Waiting for $url to be healthy..."
  for i in {1..30}; do
    if curl -s -f -o /dev/null "$url"; then
      echo "OK: $url is healthy"
      return 0
    fi
    sleep 2
  done
  echo "ERROR: $url failed to become healthy"
  exit 1
}

get_port() {
  case "$1" in
    event) echo 5001 ;;
    modular) echo 5011 ;;
    micro) echo 5021 ;;
    *) echo 5001 ;;
  esac
}

echo "=========================================================="
echo " Starting Experiment E1 (Baseline Multi-Variant Load)"
echo " Stages: $STEPS users | Hold: ${HOLD_S}s | Warmup: ${WARMUP_S}s"
echo "=========================================================="

for variant in "${VARIANTS_TO_TEST[@]}"; do
  port=$(get_port "$variant")

  for run in run1 run2 run3; do
    START_ISO=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    echo ">>> Running E1 | Variant: $variant | Run: $run | Start: $START_ISO <<<"

    reset_db "$variant"
    wait_healthy "$port"

    LOG_FILE="$RESULTS_DIR/logs/e1_${variant}_${run}.log"
    
    EXP="e1" RUN_LABEL="${variant}_${run}" VARIANT="$variant" STEPS="$STEPS" \
    HOLD_S="$HOLD_S" WARMUP_S="$WARMUP_S" GOAL_CPU_MS="10" \
    node "$ROOT/benchmark/loadgen.js" 2>&1 | tee "$LOG_FILE"

    END_ISO=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    
    # Log to RUN_LOG.md
    cat <<EOF >> "$RUN_LOG"

### E1 Baseline — $variant / $run ($START_ISO to $END_ISO)
- Variant: $variant
- Port: $port
- Stages: $STEPS
- Hold: ${HOLD_S}s, Warmup: ${WARMUP_S}s
- Log: benchmark/results/logs/e1_${variant}_${run}.log
- CSV: benchmark/results/e1-${variant}_${run}-levels.csv
EOF
    echo "Completed E1 $variant $run"
    sleep 5
  done
done

echo "Running aggregate script..."
node "$ROOT/benchmark/analysis/aggregate.js" "$RESULTS_DIR"
echo "Experiment E1 complete."
