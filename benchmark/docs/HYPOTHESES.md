# Pre-Registered Hypotheses — ECS351 Three-Way Architecture Benchmark

> ⚠️ **DO NOT EDIT AFTER BENCHMARK DATA EXISTS.**
> This file is pre-registered. Any post-hoc changes invalidate the experimental record.

---

## Hypotheses H1–H7

**H1 Speed:** p50/p95 delivery latency order: Modular Monolith lowest (direct call, same process), Event-Driven middle (in-process async, 2 extra DB ops), Microservices highest (network hops: telemetry→goal→notification service). Threshold: >50 ms gap between adjacent styles at p95 under 50 clients.

**H2 Scalability:** when GOAL_CPU_MS=10, Microservices need fewer TOTAL CPU cores than Modular Monolith to keep p95 degradation ≤20% at 200 clients (scale only goal-service). Event-Driven cannot replicate without a broker.

**H3 Fault isolation:** with the notification service/module failed, Microservices keep ingest+dashboard+goal-save working (HTTP 200); each monolith loses at least 2 of those 3 journeys.

**H4 Durability:** Event-Driven loses ≥1 acknowledged step in 20 trials of kill-after-200; Modular Monolith and Microservices lose none (synchronous write before 200).

**H5 Extensibility:** Modular Monolith changes the fewest files to add a new goal type (expected ≤3 files). Microservices changes ≤2 files but those 2 are in the goal-service only. Event-Driven changes ≥4 files (consumer + eventBus + goalController + metric).

**H6 Cost:** Modular Monolith uses least CPU and memory (1 container). Microservices uses most (5+ containers). Event-Driven is middle.

**H7 Burst:** Event-Driven handles a sudden 0→200 client burst best (delivery p95 stays under 500 ms) because push fires immediately; Microservices has highest burst p95 (cascading hop latency); Modular Monolith is middle.

---

## Star Chart (Pre-Registered Ratings)

> Ratings labelled **(code)** are based on static code inspection.
> Ratings labelled **(hypothesis)** are predictions from H1–H7 above.
> Ratings labelled **(measured — fill in after experiments)** are placeholders.

| Characteristic | Event-Driven | Modular Monolith | Microservices | Basis |
|----------------|:------------:|:----------------:|:-------------:|-------|
| Speed (p95 latency, lower = better) | ★★★☆☆ | ★★★★★ | ★★☆☆☆ | (hypothesis — H1) |
| Scalability (selective scale-out) | ★★★☆☆ | ★★☆☆☆ | ★★★★★ | (hypothesis — H2) |
| Fault Isolation | ★★★☆☆ | ★★☆☆☆ | ★★★★★ | (hypothesis — H3) |
| Durability (no data loss on crash) | ★★★☆☆ | ★★★★★ | ★★★★★ | (hypothesis — H4) |
| Extensibility (new goal type) | ★★☆☆☆ | ★★★★★ | ★★★★☆ | (code + hypothesis — H5) |
| Cost (resource footprint) | ★★★☆☆ | ★★★★★ | ★★☆☆☆ | (hypothesis — H6) |
| Burst Handling (0→200 client surge) | ★★★★★ | ★★★☆☆ | ★★☆☆☆ | (hypothesis — H7) |
| Operational Complexity | ★★★☆☆ | ★★★★★ | ★★☆☆☆ | (code) |
| Observability (out-of-box metrics) | ★★★★☆ | ★★★☆☆ | ★★★★★ | (code) |

---

## Notes

- Star ratings use 1 (worst) to 5 (best) on the named characteristic.
- "Measured" ratings must be added only after all benchmark trials are complete; update only the Basis cell.
- Architecture definitions: Modular Monolith = single Express process, all modules imported directly; Event-Driven = single Express process with in-process EventEmitter bus; Microservices = separate network services per domain.
