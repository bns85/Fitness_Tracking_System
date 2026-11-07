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

Prometheus and Grafana are configured in the root `docker-compose.yml`:
- **Prometheus**: Port `9090` (Scrapes `event-app:5001`, `polling-app:5002`, `loadgen:9100`, `cadvisor:8080`)
- **Grafana**: Port `3000` (Anonymous Admin enabled, auto-loads the comparison dashboard)

---

## 3. How to Start

```bash
# 1. Start Prometheus and Grafana
docker compose up -d prometheus grafana

# 2. Access Grafana
# Open http://localhost:3000 in your browser
# The "ECS351: Event-Driven vs Polling Architectural Comparison" dashboard opens automatically!
```
