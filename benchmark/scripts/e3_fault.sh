#!/usr/bin/env bash
# benchmark/scripts/e3_fault.sh — E3 Fault Isolation Experiment Runner
# Tests availability and blast radius under simulated failures at 100 users:
#   - Fault A: notification service fails (microservices: stop notification-service; monoliths: FAULT_NOTIFICATIONS=1)
#   - Fault B: kill container (goal-service vs whole monolith app)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
RESULTS_DIR="$ROOT/benchmark/results"
RUN_LOG="$RESULTS_DIR/RUN_LOG.md"
mkdir -p "$RESULTS_DIR/logs"

START_ISO=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

echo "=========================================================="
echo " Starting Experiment E3 (Fault Isolation & Availability)"
echo " Baseline Load: 100 users | Ingest Best-Effort Verification"
echo "=========================================================="

# Fault A on Microservices (Notification-service stopped)
echo "--- Simulating Fault A on Microservices (Stop notification-service) ---"
NOTIF_CID=$(docker ps -q -f "name=notification-service" | head -n1)
if [ -n "$NOTIF_CID" ]; then docker stop "$NOTIF_CID" || true; fi

EXP="e3_fault" RUN_LABEL="micro_faultA" VARIANT="micro" STEPS="100" \
HOLD_S="60" WARMUP_S="10" \
node "$ROOT/benchmark/loadgen.js" 2>&1 | tee "$RESULTS_DIR/logs/e3_micro_faultA.log"

if [ -n "$NOTIF_CID" ]; then docker start "$NOTIF_CID" || true; fi

# Fault B on Microservices (Stop goal-service)
echo "--- Simulating Fault B on Microservices (Stop goal-service) ---"
GOAL_CID=$(docker ps -q -f "name=goal-service" | head -n1)
if [ -n "$GOAL_CID" ]; then docker stop "$GOAL_CID" || true; fi

EXP="e3_fault" RUN_LABEL="micro_faultB" VARIANT="micro" STEPS="100" \
HOLD_S="60" WARMUP_S="10" \
node "$ROOT/benchmark/loadgen.js" 2>&1 | tee "$RESULTS_DIR/logs/e3_micro_faultB.log"

if [ -n "$GOAL_CID" ]; then docker start "$GOAL_CID" || true; fi

END_ISO=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

cat <<EOF >> "$RUN_LOG"

### E3 Fault Isolation ($START_ISO to $END_ISO)
- Fault A: notification-service stopped (telemetry ingest must remain 200 OK)
- Fault B: goal-service stopped (telemetry ingest best-effort)
EOF
echo "Experiment E3 complete."
