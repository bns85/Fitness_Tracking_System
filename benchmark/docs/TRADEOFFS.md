# Architectural Trade-Off Analysis — PulseFlow Fitness Tracking System

This document evaluates the trade-offs between the three architectural variants evaluated for the PulseFlow Fitness Tracking System:
1. **Event-Driven Architecture (SSE Push)** (`event`, Port 5001)
2. **Modular Monolith** (`modular`, Port 5011)
3. **Microservices Architecture** (`micro`, Port 5021 via Gateway)

All comparisons are governed by the controlled variables defined in `AGREEMENTS.md`: identical HTTP endpoints, identical schema fields, identical MongoDB 7 & Redis 7 container baselines, identical 1.0 total CPU budget in Round 1, and Error Policy P.

---

## 1. Trade-Off Matrix

| # | Characteristic | Metric | Event-Driven (`event`) | Modular Monolith (`modular`) | Microservices (`micro`) | Better | Matters for Us? |
|---|---|---|---|---|---|:---:|---|
| **1** | **Notification Delivery Latency (Speed)** | p50 & p95 latency from step ingest to SSE notification receipt (ms) | Moderate (~80–130 ms). In-process EventEmitter dispatch with async consumer loop and 2 database roundtrips. | **Lowest (~20–45 ms)**. Direct synchronous function calls in same memory space, zero serialization, direct DB writes. | Highest (~140–280 ms). Cascading HTTP network hops (Gateway → Telemetry → Goal → Notification) across Docker bridge. | **Modular Monolith** | **High**: Real-time feedback when a user crosses a milestone (e.g. 10,000 steps) should feel instantaneous on wearable/dashboard. |
| **2** | **Ingest Response Time (Write ACK)** | p50 & p95 HTTP response time for `POST /api/telemetry/steps` (ms) | **Fastest (< 10 ms)**. Returns HTTP 200 immediately upon event publication before saving to database. | Moderate (15–35 ms). Saves telemetry to MongoDB synchronously before returning HTTP 200. | Highest (25–60 ms). Traverses API Gateway, validates request, and writes synchronously to `fitness_telemetry` DB before returning 200. | **Event-Driven** | **High**: High-frequency fitness trackers pushing batches of accelerometer/step data need fast ingest without connection timeouts. |
| **3** | **Selective Scalability (Efficiency)** | Total CPU cores required to keep p95 latency degradation ≤ 20% under 200 clients with `GOAL_CPU_MS=10` | Poor. Cannot horizontally replicate app container without an external broker; internal EventEmitter duplicates in-memory SSE state. | Moderate. Scaling requires duplicating the entire 1.0 CPU monolithic process (telemetry + goals + notifications + workouts). | **Best**. Can scale *only* the computationally bottlenecked `goal-service` (0.35 CPU → 2x replicas) without replicating lightweight services. | **Microservices** | **Critical**: Goal evaluation with custom fitness algorithms (`GOAL_CPU_MS`) creates an asymmetric CPU bottleneck; selective scaling avoids wasted resources. |
| **4** | **Fault Isolation & Blast Radius** | System availability when notification component crashes (HTTP status of Ingest, Goals, Dashboard, Workouts) | Moderate. Consumer crash does not crash the HTTP listener, but unhandled bus errors or memory leaks affect the whole process. | Poor. In-process failure or unhandled exception in notifications module can crash the single Node.js runtime for all users. | **Best**. Complete process & network isolation. If `notification-service` crashes, Telemetry, Goal evaluation, and Workouts return HTTP 200. | **Microservices** | **Critical**: Telemetry ingestion and live workout tracking must never stop functioning just because the notification delivery channel failed. |
| **5** | **Data Durability & Crash Consistency** | Number of acknowledged step records lost when container is forcefully killed immediately after HTTP 200 (out of 20 trials) | **Fails (≥ 1 loss)**. Acknowledges HTTP 200 *before* persisting to MongoDB. If process dies during event queue processing, data is permanently lost. | **Zero loss**. Strictly guarantees write persistence to MongoDB before HTTP 200 is dispatched. | **Zero loss**. Telemetry service guarantees persistence to `fitness_telemetry` before returning HTTP 200 through Gateway. | **Modular Monolith & Microservices** | **Critical**: A user must not be told their workout or steps were logged if a server restart drops the data before saving. |
| **6** | **Resource Footprint & Cost** | Baseline idle/low-load CPU usage (%) and total memory consumption (RSS in MB across all app containers) | Moderate (~85 MB memory, 1 Node process, 1 container). Low idle CPU overhead. | **Lowest (~70 MB memory, 1 Node process, 1 container)**. Single event loop, shared database connection pool, zero intra-service network overhead. | Highest (~310 MB memory, 5 Node processes, 5 containers). Each microservice requires its own V8 runtime, Mongoose pool, and Redis connection. | **Modular Monolith** | **High**: For a student project or small-to-medium enterprise, 5x container overhead translates directly to cloud hosting costs. |
| **7** | **Surge & Burst Handling** | p95 delivery latency (ms) and dropped connection count during a 0 → 200 client spike in 5 seconds | **Best (< 500 ms, 0 drops)**. Decoupled in-process event queue absorbs the sudden ingest shock without cascading thread pool starvation. | Moderate (~650 ms). Ingest pipeline blocks on synchronous DB write and goal evaluation, causing request backlog during rapid surges. | Worst (> 1200 ms). Sudden burst triggers connection pile-up across cascading HTTP hops; risk of Gateway downstream timeouts (`1000 ms`). | **Event-Driven** | **High**: Gym check-ins, end-of-hour standing alerts, or morning synchronization create acute traffic spikes. |
| **8** | **Extensibility (Adding a Feature)** | Files changed and architectural blast radius to add a new goal type (`active_minutes`) | Highest blast radius (≥ 4 files). Requires changes across `eventBus.js`, consumer handlers, `goalController.js`, and Prometheus metric labels. | **Lowest blast radius (≤ 3 files)**. Localized entirely within `modules/goals/` behind its public `index.js` facade; verified by `check-modules.js`. | Low blast radius (≤ 2 files). Confined entirely to `goal-service`, but requires independent service redeploy and potential API contract bump. | **Modular Monolith** | **Medium**: Rapid evolution of health metrics (e.g., HRV, active minutes) requires low friction and strong module boundary safety. |
| **9** | **Independent Deployability** | Build time (seconds) and downtime required to deploy a bugfix to goal evaluation logic | Full redeploy required. Entire monolith must be rebuilt and restarted, briefly interrupting active SSE streams. | Full redeploy required. Single artifact build, but requires restarting the entire application container. | **Best**. Only `goal-service` image is rebuilt and restarted (`~15 s`); API Gateway, Telemetry, and Notification SSE connections stay alive. | **Microservices** | **Medium**: Frequent rule and recommendation algorithm updates should not disconnect user SSE streams. |
| **10** | **Operational & Observability Simplicity** | Out-of-the-box debugging difficulty, correlation tracing overhead, and operational failure modes | Low-to-Moderate. Single process debugging, standard stack traces; however, asynchronous event queue flow requires tracing correlation IDs. | **Lowest**. Single stack trace across modules, synchronous execution path, local in-memory debugging, single log stream. | Highest. Requires distributed tracing (`X-Request-Id` across all hops), multi-container orchestration, downstream timeouts, and partial failure management. | **Modular Monolith** | **High**: Operational burden on small engineering teams can negate the architectural advantages of distributed systems. |

---

## 2. Balance Verification — Why Each Style Wins

A critical design requirement of this comparative study is that **no single architecture dominates across all dimensions**. The benchmark design and architectural trade-offs guarantee that each variant is the superior choice under specific real-world conditions:

```
                  ┌──────────────────────────────────────────────┐
                  │             PULSEFLOW ARCHITECTURES          │
                  └──────┬────────────────┬───────────────┬──────┘
                         │                │               │
                         ▼                ▼               ▼
                 [EVENT-DRIVEN]   [MODULAR MONOLITH] [MICROSERVICES]
                         │                │               │
      ┌──────────────────┴──┐             │               │
      ▼                     ▼             │               │
  Burst Tolerance     Fast Ingest ACK     │               │
  (0->200 spike)      (<10ms response)    │               │
                                          │               │
                         ┌────────────────┴────────┐      │
                         ▼                         ▼      │
                  Lowest Latency             Lowest Cost  │
                  (In-process direct call)   (1 container)│
                                                          │
                                         ┌────────────────┴────────┐
                                         ▼                         ▼
                                   Fault Isolation         Targeted Scale
                                   (blast radius)          (hot service)
```

### 1. Where Event-Driven Wins (The "Shock Absorber")
- **Burst Tolerance (H7):** Under acute traffic spikes (e.g. 0 to 200 clients in 5 seconds), the asynchronous event queue decouples ingestion from heavy processing, maintaining sub-500ms delivery and avoiding HTTP connection saturation.
- **Ultra-Fast Ingestion (Write ACK):** By acknowledging `POST /api/telemetry/steps` immediately upon event emission, mobile and wearable clients receive near-zero latency, offloading downstream goal evaluation to the Node.js event loop.
- **Documented Compromise:** This speed comes at the expense of **Durability (H4)**, as unpersisted in-flight events are lost if the container crashes.

### 2. Where Modular Monolith Wins (The "Efficiency Champion")
- **End-to-End Speed & Responsiveness (H1):** With zero inter-process network overhead, zero HTTP serialization/deserialization, and direct function invocation via module facades, notification delivery achieves the lowest p50/p95 latency.
- **Resource & Cost Efficiency (H6):** Operates within a single Node.js runtime and container (~70 MB RSS memory), minimizing operational complexity and cloud hosting overhead.
- **Code Extensibility & Modifiability (H5):** Clear module boundaries enforced by `scripts/check-modules.js` allow new goal metrics to be added with minimal file touches and zero network coordination.

### 3. Where Microservices Wins (The "Resilience & Scale Specialist")
- **Selective Horizontal Scalability (H2):** Under heavy CPU load (`GOAL_CPU_MS=10`), only the bottlenecked `goal-service` needs replication, scaling throughput efficiently without multiplying telemetry or notification resource consumption.
- **Fault Isolation & Blast Radius (H3):** If the notification delivery component fails or throws unhandled exceptions, the core business functions (telemetry logging, goal persistence, dashboard analytics) continue to operate with HTTP 200 success.
- **Independent Deployability:** Allows the data science and rules teams to continuously update and redeploy goal and recommendation services without cycling the API Gateway or dropping long-lived SSE connections.

---

## 3. Decision Guidance: When to Choose Which Architecture

| If Your Project Prioritizes... | Recommended Architecture | Primary Justification |
|---|---|---|
| **Early-stage startup / Small team / Low operational budget** | **Modular Monolith** | Maximum developer velocity, lowest cloud hosting cost, simplest observability, and superior baseline latency. Strong module boundaries prevent the codebase from degenerating into a "big ball of mud". |
| **High-throughput IoT / Wearable telemetry ingestion with spike bursts** | **Event-Driven** | Asynchronous decoupling ensures that massive bursts of sensor telemetry are absorbed without starving HTTP connection pools or blocking client devices. |
| **Large multi-team organization / Asymmetric service workloads / Strict fault isolation requirements** | **Microservices** | Clear team ownership boundaries, independent deployment cadences, zero cross-service database coupling, and the ability to scale only computationally heavy components. |
