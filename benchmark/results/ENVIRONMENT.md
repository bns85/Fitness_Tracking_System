# Benchmark Environment — Three-Variant Architectural Evaluation

Updated: 2026-11-26 (for Phase 3 benchmark trials).

---

## 1. Host Machine Specifications

| Item | Value |
|---|---|
| OS | Ubuntu 24.04.4 LTS on **WSL2** / Windows 11 (kernel `6.6.87.2-microsoft-standard-WSL2`) |
| CPU | Intel Core 7 150U — 6 cores / 12 threads |
| RAM | 7.6 GiB total (≈5.4 GiB available) |
| Swap | 2.0 GiB |
| Disk (repo volume) | `C:\` 931 GiB, ~620 GiB free |
| Docker | Docker Desktop with WSL2 backend |

*Note: CPU and RAM allocations below represent container constraints, executed on the standard host.*

---

## 2. Controlled Variables (Round 1: Equal Total CPU)

| Parameter | Event-Driven (`event`) | Modular Monolith (`modular`) | Microservices (`micro`) | Source |
|---|---|---|---|---|
| **Total App CPU Limit** | **1.0 CPU** (`NanoCPUs=1e9`) | **1.0 CPU** (`NanoCPUs=1e9`) | **1.0 Total CPU** split across services: <br>• Gateway: 0.10<br>• Telemetry: 0.25<br>• Goal: 0.35<br>• Notification: 0.20<br>• Workout: 0.10 | `docker-compose.yml` |
| **Memory Limit** | 512 MB | 512 MB | 512 MB per container | Compose manifests |
| **`GOAL_CPU_MS`** | **10 ms** | **10 ms** | **10 ms** | `burnCpu(10)` in goal logic |
| **`CACHE_TTL`** | **300 s** | **300 s** | **300 s** | Compose env |
| **`QUIET`** | **1** | **1** | **1** | Suppress per-event console logs |
| **Datastores** | `mongo-event`, `redis-event` | `mongo-modular`, `redis-modular` | `mongo-micro`, `redis-micro` | Dedicated containers |
| **Database Engine** | `mongo:7`, `redis:7-alpine` | `mongo:7`, `redis:7-alpine` | `mongo:7`, `redis:7-alpine` | Identical images |
| **Worker Cap** | 20 concurrent | 20 concurrent | 20 concurrent | `WORKER_CAP` in `loadgen.js` |

---

## 3. Services & Network Topology

| Variant | Service | Host Port | Internal Port | Technology Stack |
|---|---|---|---|---|
| **Event-Driven** | `event-app` | `5001` | `5001` | Express + EventEmitter + SSE |
| **Modular Monolith** | `modular-app` | `5011` | `5011` | Express + Module Facades + RedisHub SSE |
| **Microservices** | `gateway` | `5021` | `5021` | Reverse Proxy / Static Frontend / Meta |
| | `telemetry-service` | — | `5022` | Express + Mongoose (`fitness_telemetry`) |
| | `goal-service` | — | `5023` | Express + Mongoose (`fitness_goals`) |
| | `notification-service`| — | `5024` | Express + Mongoose (`fitness_notifications`) + SSE |
| | `workout-service` | — | `5025` | Express + Mongoose (`fitness_workouts`) |
| **Monitoring** | Prometheus | `9090` | `9090` | 5s scrape, labels: `variant`, `service` |
| | Grafana | `3000` | `3000` | Anonymous admin dashboard |
| | Loadgen Exporter | `9100` | `9100` | Exact CSV metrics exporter |

---

## 4. Load Profile (E1 Baseline)

| Step | Clients per Variant | Hold Duration | Warmup Duration | Think Time Range |
|---|---|---|---|---|
| 1 | 10 | 120 s | 20 s | 0.5 s – 2.0 s |
| 2 | 50 | 120 s | 20 s | 0.5 s – 2.0 s |
| 3 | 100 | 120 s | 20 s | 0.5 s – 2.0 s |
| 4 | 200 | 120 s | 20 s | 0.5 s – 2.0 s |

- **Repetitions:** 3 independent trials per load level (`run1`, `run2`, `run3`).
- **Statistical Aggregation:** **MEDIAN** (per professor's guidelines), never arithmetic averages of percentiles.
- **Datastore Gate:** Databases and Redis caches reset before every individual trial.
