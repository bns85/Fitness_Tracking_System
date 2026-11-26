#!/usr/bin/env python3
"""
PulseFlow Three-Variant Grafana Benchmark Dashboard Generator
Variants:
  - Event-Driven (blue #2563eb)
  - Modular Monolith (teal #0f766e)
  - Microservices (purple #7c3aed)
  - Legacy Polling (orange #ff9830)

Rows by architectural characteristic:
  - Row 1: Performance
  - Row 2: Scalability
  - Row 3: Resource Efficiency and Cost
  - Row 4: Fault Isolation and Availability
  - Row 5: Observability (Hop latency & telemetry traces)
"""
import json
import re
import os
import sys

ALLOWED_METRICS = {
    # App metrics
    "http_request_duration_seconds_bucket",
    "http_request_duration_seconds_sum",
    "http_request_duration_seconds_count",
    "db_operations_total",
    "process_cpu_seconds_total",
    "process_resident_memory_bytes",
    "nodejs_eventloop_lag_p99_seconds",
    "events_published_total",
    "notification_listeners",
    "poll_responses_total",
    "downstream_call_duration_seconds_bucket",
    "downstream_call_duration_seconds_sum",
    "downstream_call_duration_seconds_count",
    "journey_failures_total",
    # Loadgen metrics
    "notify_delivery_seconds_bucket",
    "notify_delivery_seconds_sum",
    "notify_delivery_seconds_count",
    "notify_delivered_total",
    "notify_timeouts_total",
    "loadgen_errors_total",
    "poll_requests_total",
    "poll_empty_total",
    "loadgen_clients",
    # Container metrics (cAdvisor)
    "container_cpu_usage_seconds_total",
    "container_memory_working_set_bytes",
}

EVENT_BLUE = "#2563eb"
MODULAR_TEAL = "#0f766e"
MICRO_PURPLE = "#7c3aed"
POLLING_ORANGE = "#ff9830"


def create_color_overrides():
    return [
        {
            "matcher": {"id": "byRegexp", "options": ".*(?i)event.*"},
            "properties": [
                {
                    "id": "color",
                    "value": {"fixedColor": EVENT_BLUE, "mode": "fixed"},
                }
            ],
        },
        {
            "matcher": {"id": "byRegexp", "options": ".*(?i)modular.*"},
            "properties": [
                {
                    "id": "color",
                    "value": {"fixedColor": MODULAR_TEAL, "mode": "fixed"},
                }
            ],
        },
        {
            "matcher": {"id": "byRegexp", "options": ".*(?i)micro.*"},
            "properties": [
                {
                    "id": "color",
                    "value": {"fixedColor": MICRO_PURPLE, "mode": "fixed"},
                }
            ],
        },
        {
            "matcher": {"id": "byRegexp", "options": ".*(?i)poll.*"},
            "properties": [
                {
                    "id": "color",
                    "value": {"fixedColor": POLLING_ORANGE, "mode": "fixed"},
                }
            ],
        },
    ]


def default_field_config(unit="short", thresholds=None, log_scale=False):
    cfg = {
        "defaults": {
            "unit": unit,
            "color": {"mode": "palette-classic"},
            "custom": {
                "drawStyle": "line",
                "lineInterpolation": "linear",
                "lineWidth": 2,
                "fillOpacity": 10,
                "showPoints": "never",
                "spanNulls": False,
            },
        },
        "overrides": create_color_overrides(),
    }
    if log_scale:
        cfg["defaults"]["scale"] = {"type": "log", "log": 10}
    if thresholds:
        cfg["defaults"]["thresholds"] = thresholds
    else:
        cfg["defaults"]["thresholds"] = {
            "mode": "absolute",
            "steps": [{"color": "green", "value": None}],
        }
    return cfg


def create_panel(
    panel_id,
    title,
    ptype,
    x,
    y,
    w,
    h,
    targets,
    unit="short",
    thresholds=None,
    description="",
    log_scale=False,
    extra_overrides=None,
):
    panel = {
        "id": panel_id,
        "title": title,
        "type": ptype,
        "description": description,
        "gridPos": {"x": x, "y": y, "w": w, "h": h},
        "datasource": {"type": "prometheus", "uid": "prom"},
        "targets": [],
    }

    if ptype in ("timeseries", "barchart"):
        panel["fieldConfig"] = default_field_config(unit, thresholds, log_scale=log_scale)
        if extra_overrides:
            panel["fieldConfig"]["overrides"] = (
                panel["fieldConfig"]["overrides"] + extra_overrides
            )
        panel["options"] = {
            "tooltip": {"mode": "multi", "sort": "desc"},
            "legend": {
                "calcs": ["mean", "max"],
                "displayMode": "table",
                "placement": "bottom",
                "showLegend": True,
            },
        }
        if ptype == "barchart":
            panel["options"]["stacking"] = "normal"
    elif ptype == "stat":
        panel["fieldConfig"] = {
            "defaults": {
                "unit": unit,
                "thresholds": {
                    "mode": "absolute",
                    "steps": [{"color": "green", "value": None}],
                },
            },
            "overrides": create_color_overrides(),
        }
        panel["options"] = {
            "reduceOptions": {"values": False, "calcs": ["mean"], "fields": ""},
            "orientation": "auto",
            "textMode": "auto",
            "colorMode": "value",
            "graphMode": "area",
        }

    for idx, t in enumerate(targets):
        ref_id = chr(65 + idx)
        panel["targets"].append(
            {
                "refId": ref_id,
                "expr": t["expr"],
                "legendFormat": t.get("legendFormat", ""),
                "datasource": {"type": "prometheus", "uid": "prom"},
            }
        )

    return panel


def create_row_panel(panel_id, title, y):
    return {
        "id": panel_id,
        "title": title,
        "type": "row",
        "gridPos": {"x": 0, "y": y, "w": 24, "h": 1},
        "collapsed": False,
        "panels": [],
    }


def build_dashboard():
    dashboard = {
        "annotations": {
            "list": [
                {
                    "builtIn": 1,
                    "datasource": "-- Grafana --",
                    "enable": True,
                    "hide": False,
                    "name": "Annotations & Alerts",
                    "type": "dashboard",
                },
            ]
        },
        "editable": True,
        "fiscalYearStartMonth": 0,
        "graphTooltip": 1,
        "id": None,
        "links": [],
        "liveNow": False,
        "panels": [],
        "refresh": "5s",
        "schemaVersion": 38,
        "tags": ["ECS351", "architecture-comparison", "event-driven", "modular-monolith", "microservices"],
        "templating": {
            "list": [
                {
                    "current": {"selected": True, "text": "All", "value": "$__all"},
                    "description": "Select variant to isolate",
                    "hide": 0,
                    "includeAll": True,
                    "label": "Variant",
                    "name": "variant",
                    "options": [
                        {"selected": True, "text": "All", "value": "$__all"},
                        {"selected": False, "text": "event", "value": "event"},
                        {"selected": False, "text": "modular", "value": "modular"},
                        {"selected": False, "text": "micro", "value": "micro"},
                    ],
                    "query": "event,modular,micro",
                    "queryValue": "",
                    "skipUrlSync": False,
                    "type": "custom",
                },
                {
                    "current": {"selected": False, "text": "run1", "value": "run1"},
                    "description": "Run Label ID",
                    "hide": 0,
                    "label": "Run Label",
                    "name": "run",
                    "options": [{"selected": True, "text": "run1", "value": "run1"}],
                    "query": "run1",
                    "skipUrlSync": False,
                    "type": "textbox",
                },
                {
                    "current": {"selected": False, "text": "5", "value": "5"},
                    "description": "Baseline ingest p95 (ms) for Event-Driven at 10 users",
                    "hide": 0,
                    "label": "Base Event p95 (ms)",
                    "name": "base_event",
                    "options": [{"selected": True, "text": "5", "value": "5"}],
                    "query": "5",
                    "skipUrlSync": False,
                    "type": "textbox",
                },
                {
                    "current": {"selected": False, "text": "5", "value": "5"},
                    "description": "Baseline ingest p95 (ms) for Modular Monolith at 10 users",
                    "hide": 0,
                    "label": "Base Modular p95 (ms)",
                    "name": "base_modular",
                    "options": [{"selected": True, "text": "5", "value": "5"}],
                    "query": "5",
                    "skipUrlSync": False,
                    "type": "textbox",
                },
                {
                    "current": {"selected": False, "text": "8", "value": "8"},
                    "description": "Baseline ingest p95 (ms) for Microservices at 10 users",
                    "hide": 0,
                    "label": "Base Micro p95 (ms)",
                    "name": "base_micro",
                    "options": [{"selected": True, "text": "8", "value": "8"}],
                    "query": "8",
                    "skipUrlSync": False,
                    "type": "textbox",
                },
            ]
        },
        "time": {"from": "now-30m", "to": "now"},
        "timepicker": {"refresh_intervals": ["5s", "10s", "30s", "1m", "5m"]},
        "timezone": "browser",
        "title": "PulseFlow: Three-Variant Architectural Benchmark",
        "uid": "pulseflow-three-variants",
        "version": 2,
    }

    # ---------------- Top Text Panel ----------------
    top_text = {
        "id": 1,
        "title": "How to Read This Dashboard (Three Variants: Event, Modular, Micro)",
        "type": "text",
        "gridPos": {"x": 0, "y": 0, "w": 24, "h": 4},
        "options": {
            "mode": "markdown",
            "content": (
                "### Three-Variant Architectural Evaluation\n"
                f"- **Colour Key:** "
                f"<span style=\"color:{EVENT_BLUE}; font-weight:bold;\">Event-Driven = Blue</span> · "
                f"<span style=\"color:{MODULAR_TEAL}; font-weight:bold;\">Modular Monolith = Teal</span> · "
                f"<span style=\"color:{MICRO_PURPLE}; font-weight:bold;\">Microservices = Purple</span>\n"
                "- **Characteristics Evaluated:** Performance, Scalability, Resource Efficiency, Fault Isolation, Durability, Observability.\n"
                "- **Reading steady state:** Measure during the flat window of each stage (10 → 50 → 100 → 200 clients).\n"
                "- **Division Rule:** Division queries calculate `sum by(variant)(...) / sum by(variant)(...)` to ensure metric integrity."
            )
        },
    }
    dashboard["panels"].append(top_text)

    # ---------------- Row 1: Performance ----------------
    dashboard["panels"].append(create_row_panel(2, "Row 1: Performance (Delivery & Ingest Latency)", 4))

    # Panel 3: Delivery latency p50/p95/p99 — LOG scale
    p1_targets = [
        {"expr": 'histogram_quantile(0.50, sum by(le, variant) (rate(notify_delivery_seconds_bucket[1m])))', "legendFormat": "{{variant}} p50 delivery"},
        {"expr": 'histogram_quantile(0.95, sum by(le, variant) (rate(notify_delivery_seconds_bucket[1m])))', "legendFormat": "{{variant}} p95 delivery"},
        {"expr": 'histogram_quantile(0.99, sum by(le, variant) (rate(notify_delivery_seconds_bucket[1m])))', "legendFormat": "{{variant}} p99 delivery"},
    ]
    dashboard["panels"].append(
        create_panel(
            3,
            "Notification Delivery Latency (p50, p95, p99) — Log Scale",
            "timeseries",
            0,
            5,
            12,
            8,
            p1_targets,
            unit="s",
            log_scale=True,
            description="Wall-clock time from step ingest until notification arrival over SSE. Log scale to compare sub-100ms push variants.",
        )
    )

    # Panel 4: Ingest latency p50/p95/p99
    p2_targets = [
        {"expr": 'histogram_quantile(0.50, sum by(le, variant) (rate(http_request_duration_seconds_bucket{method="POST",route=~".*steps.*"}[30s])))', "legendFormat": "{{variant}} ingest p50"},
        {"expr": 'histogram_quantile(0.95, sum by(le, variant) (rate(http_request_duration_seconds_bucket{method="POST",route=~".*steps.*"}[30s])))', "legendFormat": "{{variant}} ingest p95"},
        {"expr": 'histogram_quantile(0.99, sum by(le, variant) (rate(http_request_duration_seconds_bucket{method="POST",route=~".*steps.*"}[30s])))', "legendFormat": "{{variant}} ingest p99"},
    ]
    dashboard["panels"].append(
        create_panel(
            4,
            "Telemetry Ingest Latency (p50, p95, p99)",
            "timeseries",
            12,
            5,
            12,
            8,
            p2_targets,
            unit="s",
            description="Latency of the step telemetry ingestion API call across variants.",
        )
    )

    # ---------------- Row 2: Scalability ----------------
    dashboard["panels"].append(create_row_panel(5, "Row 2: Scalability & Throughput", 13))

    # Panel 6: Ingest throughput
    p5_targets = [
        {"expr": 'sum by(variant)(rate(http_request_duration_seconds_count{method="POST",route=~".*steps.*",status!~"5.."}[30s]))', "legendFormat": "{{variant}} ingest req/s"},
    ]
    dashboard["panels"].append(
        create_panel(
            6,
            "Ingest Throughput (Offered Load Verification)",
            "timeseries",
            0,
            14,
            8,
            8,
            p5_targets,
            unit="reqps",
            description="Successful telemetry ingest requests/s. Should be equal across variants for fair comparison.",
        )
    )

    # Panel 7: Total HTTP requests/s
    p7_targets = [
        {"expr": 'sum by(variant)(rate(http_request_duration_seconds_count{status!~"5.."}[30s]))', "legendFormat": "{{variant}} total req/s"},
    ]
    dashboard["panels"].append(
        create_panel(
            7,
            "Total HTTP Requests/s per Variant",
            "timeseries",
            8,
            14,
            8,
            8,
            p7_targets,
            unit="reqps",
            description="All processed HTTP requests per second across services.",
        )
    )

    # Panel 8: Simulated clients
    p8_targets = [
        {"expr": 'max by(variant)(loadgen_clients)', "legendFormat": "{{variant}} clients"},
    ]
    dashboard["panels"].append(
        create_panel(
            8,
            "Simulated Active Clients",
            "timeseries",
            16,
            14,
            8,
            8,
            p8_targets,
            unit="none",
            description="Number of concurrent virtual client workers per variant.",
        )
    )

    # ---------------- Row 3: Resource Efficiency and Cost ----------------
    dashboard["panels"].append(create_row_panel(9, "Row 3: Resource Efficiency and Cost", 22))

    # Panel 10: CPU cores used
    p10_targets = [
        {"expr": 'sum by(variant)(rate(process_cpu_seconds_total[30s]))', "legendFormat": "{{variant}} CPU cores"},
    ]
    dashboard["panels"].append(
        create_panel(
            10,
            "Total CPU Cores Used per Variant",
            "timeseries",
            0,
            23,
            8,
            8,
            p10_targets,
            unit="none",
            description="Aggregated Node.js process CPU cores utilized (sum across all constituent service containers).",
        )
    )

    # Panel 11: Memory RSS
    p11_targets = [
        {"expr": 'sum by(variant)(process_resident_memory_bytes)', "legendFormat": "{{variant}} RSS memory"},
    ]
    dashboard["panels"].append(
        create_panel(
            11,
            "Total Memory RSS per Variant",
            "timeseries",
            8,
            23,
            8,
            8,
            p11_targets,
            unit="bytes",
            description="Total Resident Set Size memory across all containers of the variant.",
        )
    )

    # Panel 12: CPU-ms per Notification
    p12_targets = [
        {
            "expr": '1000 * sum by(variant)(rate(process_cpu_seconds_total[1m])) / sum by(variant)(rate(notify_delivered_total[1m]))',
            "legendFormat": "{{variant}} CPU-ms/notif",
        },
    ]
    dashboard["panels"].append(
        create_panel(
            12,
            "CPU-ms per Delivered Notification",
            "timeseries",
            16,
            23,
            8,
            8,
            p12_targets,
            unit="ms",
            description="Process CPU time consumed per notification delivered.",
        )
    )

    # ---------------- Row 4: Fault Isolation and Availability ----------------
    dashboard["panels"].append(create_row_panel(13, "Row 4: Fault Isolation, Error Rate & Stability", 31))

    # Panel 14: Error rate % 5xx
    p14_targets = [
        {
            "expr": '100 * sum by(variant)(rate(http_request_duration_seconds_count{status=~"5.."}[30s])) / sum by(variant)(rate(http_request_duration_seconds_count[30s])) or vector(0)',
            "legendFormat": "{{variant}} error %",
        },
    ]
    dashboard["panels"].append(
        create_panel(
            14,
            "Server Error Rate % (5xx Share)",
            "timeseries",
            0,
            32,
            8,
            8,
            p14_targets,
            unit="percent",
            thresholds={"mode": "absolute", "steps": [{"color": "green", "value": None}, {"color": "red", "value": 1}]},
            description="Percentage of HTTP requests returning 5xx status codes.",
        )
    )

    # Panel 15: Event loop lag p99
    p15_targets = [
        {"expr": 'max by(variant)(nodejs_eventloop_lag_p99_seconds)', "legendFormat": "{{variant}} event-loop lag p99"},
    ]
    dashboard["panels"].append(
        create_panel(
            15,
            "Event-Loop Lag (p99)",
            "timeseries",
            8,
            32,
            8,
            8,
            p15_targets,
            unit="s",
            description="Event loop lag exposing main thread blocking or heavy listener dispatch.",
        )
    )

    # Panel 16: Journey Failures Total
    p16_targets = [
        {"expr": 'sum by(variant)(rate(journey_failures_total[30s])) or vector(0)', "legendFormat": "{{variant}} journey failures/s"},
    ]
    dashboard["panels"].append(
        create_panel(
            16,
            "Best-Effort Journey Failures",
            "timeseries",
            16,
            32,
            8,
            8,
            p16_targets,
            unit="ops",
            description="Background goal evaluation or notification delivery failures recorded under Error Policy P.",
        )
    )

    # ---------------- Row 5: Observability & Microservices Hop Latency ----------------
    dashboard["panels"].append(create_row_panel(17, "Row 5: Observability & Inter-Service Telemetry", 40))

    # Panel 18: Downstream service-to-service call latency (microservices)
    p18_targets = [
        {
            "expr": 'histogram_quantile(0.95, sum by(le) (rate(downstream_call_duration_seconds_bucket[30s])))',
            "legendFormat": "micro downstream call p95",
        },
        {
            "expr": 'histogram_quantile(0.50, sum by(le) (rate(downstream_call_duration_seconds_bucket[30s])))',
            "legendFormat": "micro downstream call p50",
        },
    ]
    dashboard["panels"].append(
        create_panel(
            18,
            "Inter-Service Hop Latency (Microservices Downstream Calls)",
            "timeseries",
            0,
            41,
            12,
            8,
            p18_targets,
            unit="s",
            description="Gateway-to-service and service-to-service HTTP call latency histogram.",
        )
    )

    # Panel 19: Database Operations Rate
    p19_targets = [
        {"expr": 'sum by(variant)(rate(db_operations_total[30s]))', "legendFormat": "{{variant}} DB ops/s"},
    ]
    dashboard["panels"].append(
        create_panel(
            19,
            "Database Operations Throughput (Ops/sec)",
            "timeseries",
            12,
            41,
            12,
            8,
            p19_targets,
            unit="ops",
            description="Mongoose database operations rate (reads and writes) by variant.",
        )
    )

    return dashboard


def validate_brackets(expr):
    stack = []
    pairs = {")": "(", "]": "[", "}": "{"}
    for char in expr:
        if char in "([{":
            stack.append(char)
        elif char in ")]}":
            if not stack or stack[-1] != pairs[char]:
                return False
            stack.pop()
    return len(stack) == 0


def validate_dashboard(dashboard):
    errors = []
    panel_ids = set()

    def walk_panels(panels):
        for panel in panels:
            pid = panel.get("id")
            if pid in panel_ids:
                errors.append(f"Duplicate panel ID: {pid}")
            panel_ids.add(pid)

            for target in panel.get("targets", []):
                expr = target.get("expr", "")
                if not validate_brackets(expr):
                    errors.append(f"Unbalanced brackets in expr: {expr}")
                for m in re.findall(r"([a-zA-Z_][a-zA-Z0-9_]*)\s*[\{\[]", expr):
                    if m in {"rate", "sum", "by", "max", "min", "avg", "histogram_quantile", "vector", "or"}:
                        continue
                    if m not in ALLOWED_METRICS:
                        errors.append(f"Disallowed metric '{m}' used in expr: {expr[:120]}")

    walk_panels(dashboard["panels"])
    return errors


if __name__ == "__main__":
    dash = build_dashboard()
    errs = validate_dashboard(dash)

    if errs:
        print("[ERROR] Dashboard validation failed:")
        for e in errs:
            print("  -", e)
        sys.exit(1)

    out_dir = os.path.join(os.path.dirname(__file__), "grafana", "dashboards")
    os.makedirs(out_dir, exist_ok=True)
    out_file = os.path.join(out_dir, "event-vs-polling.json")

    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(dash, f, indent=2)
        f.write("\n")

    print(f"[OK] Dashboard successfully generated and validated: {out_file}")
    print(f"Total panels: {len(dash['panels'])}")
