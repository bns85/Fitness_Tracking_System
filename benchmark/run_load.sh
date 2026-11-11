#!/usr/bin/env bash
# Run benchmark/loadgen.js with DB/Redis reset between runs.
# Usage:
#   ./benchmark/run_load.sh e1 run1 "10,50,100,200" 120 20 5000
#   EXP RUN_LABEL STEPS HOLD_S WARMUP_S POLL_MS [WORKER_CAP] [TIMEOUT_MS]
set -euo pipefail

EXP="${1:-e1}"
RUN_LABEL="${2:-run1}"
STEPS="${3:-10,50,100,200}"
HOLD_S="${4:-120}"
WARMUP_S="${5:-20}"
POLL_MS="${6:-5000}"
WORKER_CAP="${7:-250}"
TIMEOUT_MS="${8:-}"

DOCKER="${DOCKER:-/mnt/c/Users/soura/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$ROOT/benchmark/results/logs"
mkdir -p "$LOG_DIR" "$ROOT/benchmark/results"

echo "=== reset Mongo + Redis (both variants) ==="
"$DOCKER" exec mongo-event mongosh fitness_event --quiet --eval "db.dropDatabase()" >/dev/null
"$DOCKER" exec mongo-polling mongosh fitness_polling --quiet --eval "db.dropDatabase()" >/dev/null
"$DOCKER" exec redis-event redis-cli FLUSHALL >/dev/null
"$DOCKER" exec redis-polling redis-cli FLUSHALL >/dev/null
echo "dbs reset ok"

# health gate
for url in http://localhost:5001/health http://localhost:5002/health; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "$url" || true)
  if [ "$code" != "200" ]; then echo "UNHEALTHY $url → $code"; exit 1; fi
done
# real-mongo gate (must not be mock)
if ! "$DOCKER" logs event-app 2>&1 | grep -q "MongoDB connected: mongo-event"; then
  echo "event-app not on mongo-event"; exit 1
fi
if ! "$DOCKER" logs polling-app 2>&1 | grep -q "MongoDB connected: mongo-polling"; then
  echo "polling-app not on mongo-polling"; exit 1
fi
echo "health + mongo gates ok"

ENV_ARGS=(
  EXP="$EXP"
  RUN_LABEL="$RUN_LABEL"
  STEPS="$STEPS"
  HOLD_S="$HOLD_S"
  WARMUP_S="$WARMUP_S"
  POLL_MS="$POLL_MS"
  WORKER_CAP="$WORKER_CAP"
)
if [ -n "$TIMEOUT_MS" ]; then ENV_ARGS+=(TIMEOUT_MS="$TIMEOUT_MS"); fi

LOG="$LOG_DIR/${EXP}-${RUN_LABEL}.log"
echo "=== loadgen ${EXP}/${RUN_LABEL} → $LOG ==="
env "${ENV_ARGS[@]}" node "$ROOT/benchmark/loadgen.js" 2>&1 | tee "$LOG"
echo "=== done ${EXP}/${RUN_LABEL} ==="
