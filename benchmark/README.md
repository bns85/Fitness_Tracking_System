# ECS351 Architectural Evaluation: Event-Driven vs. Polling

This directory contains the complete benchmarking, Prometheus metrics scraping, and Grafana comparison dashboard setup for comparing the two architecture variants:
- **Event-Driven**: Server-Sent Events (SSE) push backed by in-process EventEmitter.
- **Polling**: Client periodic HTTP poll (every 5 seconds).

---

## 1. Directory Structure

```text
benchmark/
├── prometheus/
│   └── prometheus.yml                     # Scrape configs with 5s interval & variant labels
├── grafana/
│   ├── provisioning/
│   │   ├── datasources/
│   │   │   └── prometheus.yml             # Datasource uid="prom" pointing to Prometheus:9090
│   │   └── dashboards/
│   │       └── dashboards.yml             # Auto-loads dashboards from /var/lib/grafana/dashboards
│   └── dashboards/
│       └── event-vs-polling.json          # 22-panel side-by-side Grafana comparison dashboard
├── results/
│   └── screenshots/                       # Target directory for slide & report evidence
└── generate_dashboard.py                  # Script used to generate & validate dashboard JSON
```

---

## 2. Docker Compose Stack

Full stack is defined in the root `docker-compose.yml`:

| Service | Role |
|---|---|
| `mongo-event` / `mongo-polling` | **Separate** MongoDB 7 instances (isolated data) |
| `redis-event` / `redis-polling` | **Separate** Redis 7 instances (isolated cache) |
| `event-app` (5001) / `polling-app` (5002) | Applications, **1 CPU each** |
| `prometheus` (9090) | Scrapes both apps (`variant=event\|polling`) + loadgen |
| `grafana` (3000) | Anonymous admin, auto-loads comparison dashboard |

### Controlled variables (Task 1)

These are held equal across both variants so the architecture is the only differing decision:

| Variable | event | polling | Notes |
|---|---|---|---|
| `CACHE_TTL` | **300 s** | **300 s** | Defaults differed (300 vs 30) — equalized |
| `QUIET` | **1** | **1** | Suppresses per-event console noise during runs |
| CPU limit | **1** | **1** | `cpus: 1` in compose |
| MongoDB | `mongo-event` → `fitness_event` | `mongo-polling` → `fitness_polling` | Separate instances |
| Redis | `redis-event` | `redis-polling` | Separate instances |
| Mongo/Redis images | `mongo:7`, `redis:7-alpine` | same | Same versions |

**Mock-mode warning:** both apps still contain a silent fallback to in-memory/mock data if MongoDB is unreachable (`src/config/db.js`). The compose stack sets `depends_on: service_healthy` and the correct `MONGODB_URI`, so logs must show `MongoDB connected: mongo-*`. **If a run was made without Mongo up, every latency number from that run excluded database cost** — discard it.

---

## 3. How to Start

```bash
# 1. Start everything (apps + DBs + Prometheus + Grafana)
docker compose up -d --build

# 2. Verify real DB connectivity (must NOT say mock/in-memory)
docker logs event-app 2>&1 | grep MongoDB
docker logs polling-app 2>&1 | grep MongoDB

# 3. Access Grafana
# Open http://localhost:3000 in your browser
```
