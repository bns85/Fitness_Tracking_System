#!/usr/bin/env bash
# benchmark/scripts/e4_durability.sh — E4 Durability & Crash Recovery Runner
# 20 trials per variant:
#   1. Send step telemetry
#   2. Docker kill app container right after HTTP 200
#   3. Restart container
#   4. Compare steps saved in DB vs steps acknowledged over HTTP
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
RESULTS_DIR="$ROOT/benchmark/results"
RUN_LOG="$RESULTS_DIR/RUN_LOG.md"

START_ISO=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

echo "=========================================================="
echo " Starting Experiment E4 (Durability & Crash Recovery)"
echo " 20 Crash Trials per Variant"
echo "=========================================================="

run_durability_trials() {
  local var="$1"
  local port="$2"
  local container_target="$3"
  local mongo_container="$4"
  local db_name="$5"
  local coll_name="$6"
  local acked=0
  local saved=0

  # Resolve actual container name or id
  local cid=$(docker ps -q -f "name=$container_target" | head -n1)
  if [ -z "$cid" ]; then
    cid="$container_target"
  fi

  echo "--- Running 20 trials on $var (Target Container: $cid, DB: $db_name, Collection: $coll_name) ---"
  for trial in $(seq 1 20); do
    local user="dura_${var}_t${trial}_$(date +%s)"
    
    # Ingest steps and immediately kill container
    local res=$(curl -s -w "%{http_code}" -X POST "http://localhost:$port/api/telemetry/steps" \
      -H "Content-Type: application/json" \
      -d "{\"userId\":\"$user\",\"steps\":500,\"calories\":15,\"distance\":0.2}" || true)

    if [[ "$res" =~ "200" ]]; then
      acked=$((acked + 1))
    fi

    docker kill "$cid" >/dev/null 2>&1 || true
    sleep 1
    docker start "$cid" >/dev/null 2>&1 || true

    # Wait for recovery
    for i in $(seq 1 25); do
      if curl -s -f "http://localhost:$port/health" >/dev/null 2>&1; then break; fi
      sleep 1
    done

    # Check MongoDB for saved steps
    local count=$(docker exec "$mongo_container" mongosh "$db_name" --quiet \
      --eval "db['$coll_name'].countDocuments({userId:'$user'})" 2>/dev/null || echo "0")
    if [ "$count" -ge 1 ]; then
      saved=$((saved + 1))
    fi
  done

  echo "Result for $var: Acknowledged=$acked, Persisted=$saved"
}

# Run on available containers
run_durability_trials "event" "5001" "event-app" "mongo-event" "fitness_event" "fitnessdatas"
run_durability_trials "modular" "5011" "modular-app" "mongo-modular" "fitness_modular" "telemetry_fitness_data"
run_durability_trials "micro" "5021" "telemetry-service" "mongo-micro" "fitness_telemetry" "fitnessdatas"

END_ISO=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

cat <<EOF >> "$RUN_LOG"

### E4 Durability Trials ($START_ISO to $END_ISO)
- Trials: 20 per variant
- Measures acknowledged vs saved documents post crash
EOF
echo "Experiment E4 complete."
