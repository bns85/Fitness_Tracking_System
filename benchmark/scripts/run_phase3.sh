#!/usr/bin/env bash
# benchmark/scripts/run_phase3.sh — Master Phase 3 Benchmark Runner (Bash)
# Executes E1 Baseline, E4 Durability, E3 Fault Isolation, E8 Burst, and Aggregation.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
RESULTS_DIR="$ROOT/benchmark/results"
RUN_LOG="$RESULTS_DIR/RUN_LOG.md"
mkdir -p "$RESULTS_DIR/logs"

echo "=========================================================="
echo " Starting Phase 3 Benchmark Suite (PulseFlow ECS351) "
echo "=========================================================="

# 1. Environment check
echo "[Step 1/5] Checking Docker Environment..."
if ! docker version >/dev/null 2>&1; then
  echo "ERROR: Docker is not reachable. Please start Docker Desktop before running Phase 3."
  exit 1
fi

# 2. Experiment E1: Baseline Multi-Variant Load
echo ""
echo "[Step 2/5] Running Experiment E1: Baseline Step Loads (10, 50, 100, 200)..."
"$ROOT/benchmark/scripts/e1_baseline.sh" "10,50,100,200" 120 20

# 3. Experiment E4: Durability (20 crash trials)
echo ""
echo "[Step 3/5] Running Experiment E4: Crash Durability (20 trials per variant)..."
"$ROOT/benchmark/scripts/e4_durability.sh"

# 4. Experiment E3: Fault Isolation
echo ""
echo "[Step 4/5] Running Experiment E3: Fault Isolation..."
"$ROOT/benchmark/scripts/e3_fault.sh"

# 5. Experiment E8: Burst Load (0 -> 200 in 5s)
echo ""
echo "[Step 5/5] Running Experiment E8: Burst Surge Load..."
"$ROOT/benchmark/scripts/e8_burst.sh"

# 6. Aggregate Results
echo ""
echo "[Aggregation] Aggregating results into summary.csv and summary.md..."
node "$ROOT/benchmark/analysis/aggregate.js" "$RESULTS_DIR"

echo ""
echo "=========================================================="
echo " Phase 3 Benchmarks Completed Successfully! "
echo " Results generated in benchmark/results/summary.csv and summary.md"
echo "=========================================================="
