# Run log

Set the Grafana time range to the times below to review a run.

## e1 / smoke — 2026-11-15 (quick check, not a real benchmark run)

- Start: 2026-11-15T07:30:13Z
- End:   2026-11-15T07:33:02Z
- Command: `./benchmark/run_load.sh e1 smoke "10,50" 60 15 5000`
- Load: 10 and 50 clients per variant, hold 60 s, warmup 15 s, poll every 5000 ms
- Simulated clients reached 50 per variant (checked in Prometheus, same query as the panel)
- `node benchmark/analysis/check_panels.js --last 30m` right after the run:
  18 OK, 1 EMPTY (cAdvisor only), 0 ERROR — PASS
- CSV: `benchmark/results/_smoke/e1-smoke-levels.csv` (moved out of `results/` so it is not counted as a real run)
