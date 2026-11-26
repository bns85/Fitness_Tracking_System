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

## Self-Test v3 (Three-Variant Stubs) — 2026-11-24
- Status: self-test PASS 6 of 6 checks
- Tested: Event (6301, 20ms stub), Modular (6311, 30ms stub), Microservices (6321, 45ms stub) on test metrics port 9199
- Loadgen version: `v3-three-variant`
- Checks passed: delivery latency accuracy, equal offered load within 10%, 0 timeouts, monotonic clock sampling, metadata tags, burst mode readiness.


### E1 Baseline — event / run1 (2026-11-26T09:58:43.209Z to 2026-11-26T10:08:12.641Z)
- Variant: event
- Port: 5001
- Stages: 10,50,100,200
- CSV: benchmark/results/e1-event_run1-levels.csv

### E1 Baseline — event / run2 (2026-11-26T10:08:12.643Z to 2026-11-26T10:17:41.793Z)
- Variant: event
- Port: 5001
- Stages: 10,50,100,200
- CSV: benchmark/results/e1-event_run2-levels.csv

### E1 Baseline — event / run3 (2026-11-26T10:17:41.794Z to 2026-11-26T10:27:12.061Z)
- Variant: event
- Port: 5001
- Stages: 10,50,100,200
- CSV: benchmark/results/e1-event_run3-levels.csv

### E1 Baseline — modular / run1 (2026-11-26T10:27:12.063Z to 2026-11-26T10:37:20.137Z)
- Variant: modular
- Port: 5011
- Stages: 10,50,100,200
- CSV: benchmark/results/e1-modular_run1-levels.csv

### E1 Baseline — modular / run2 (2026-11-26T10:37:20.138Z to 2026-11-26T10:47:27.553Z)
- Variant: modular
- Port: 5011
- Stages: 10,50,100,200
- CSV: benchmark/results/e1-modular_run2-levels.csv

### E1 Baseline — modular / run3 (2026-11-26T10:47:27.555Z to 2026-11-26T10:57:38.398Z)
- Variant: modular
- Port: 5011
- Stages: 10,50,100,200
- CSV: benchmark/results/e1-modular_run3-levels.csv

### E1 Baseline — micro / run1 (2026-11-26T10:57:38.400Z to 2026-11-26T11:07:45.413Z)
- Variant: micro
- Port: 5021
- Stages: 10,50,100,200
- CSV: benchmark/results/e1-micro_run1-levels.csv

### E1 Baseline — micro / run2 (2026-11-26T11:07:45.414Z to 2026-11-26T11:17:52.155Z)
- Variant: micro
- Port: 5021
- Stages: 10,50,100,200
- CSV: benchmark/results/e1-micro_run2-levels.csv

### E1 Baseline — micro / run3 (2026-11-26T11:17:52.157Z to 2026-11-26T11:27:58.868Z)
- Variant: micro
- Port: 5021
- Stages: 10,50,100,200
- CSV: benchmark/results/e1-micro_run3-levels.csv

### E1 Baseline — modular / run1 (2026-11-26T12:07:37.736Z to 2026-11-26T12:17:06.210Z)
- Variant: modular
- Port: 5011
- Stages: 10,50,100,200
- CSV: benchmark/results/e1-modular_run1-levels.csv

### E1 Baseline — modular / run2 (2026-11-26T12:17:06.213Z to 2026-11-26T12:26:34.853Z)
- Variant: modular
- Port: 5011
- Stages: 10,50,100,200
- CSV: benchmark/results/e1-modular_run2-levels.csv

### E1 Baseline — modular / run3 (2026-11-26T12:26:34.856Z to 2026-11-26T12:36:03.072Z)
- Variant: modular
- Port: 5011
- Stages: 10,50,100,200
- CSV: benchmark/results/e1-modular_run3-levels.csv

### E1 Baseline — micro / run1 (2026-11-26T12:36:03.075Z to 2026-11-26T12:45:53.111Z)
- Variant: micro
- Port: 5021
- Stages: 10,50,100,200
- CSV: benchmark/results/e1-micro_run1-levels.csv

### E1 Baseline — micro / run2 (2026-11-26T12:45:53.114Z to 2026-11-26T12:55:44.862Z)
- Variant: micro
- Port: 5021
- Stages: 10,50,100,200
- CSV: benchmark/results/e1-micro_run2-levels.csv

### E1 Baseline — micro / run3 (2026-11-26T12:55:44.865Z to 2026-11-26T13:05:26.754Z)
- Variant: micro
- Port: 5021
- Stages: 10,50,100,200
- CSV: benchmark/results/e1-micro_run3-levels.csv
