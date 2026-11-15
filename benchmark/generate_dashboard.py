#!/usr/bin/env python3
"""
Generates and validates the ECS351 Event-Driven vs Polling Grafana comparison dashboard.

Task 3 fixes applied here (source of truth for the JSON):
  - Event=blue / polling=orange on every timeseries via fieldConfig overrides
  - Delivery latency panel: log-scale y axis
  - Throughput retitled to ingest-only; separate total req/s panel (includes polls)
  - Empty-poll panel: unit percent (loadgen + app cross-check series)
  - Error rate: `or vector(0)` so zero errors shows 0%
  - cAdvisor panel clearly labelled Linux only
  - CPU-ms and throughput/core titles state they are per INGEST request
  - Text panel: load-step reading instructions + colour key
  - Baseline textboxes base_event / base_polling documented (10-client p95 ingest, ms)
"""
import json
import re
import os
import sys

# Metrics actually exported by apps + loadgen (+ cAdvisor, optional).
# ingest_client_duration / poll_client_duration are NOT exported by current loadgen.js —
# they stay listed only so a future loadgen can add them without validator changes.
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
    # Loadgen metrics (benchmark/loadgen.js)
    "notify_delivery_seconds_bucket",
    "notify_delivery_seconds_sum",
    "notify_delivery_seconds_count",
    "notify_delivered_total",
    "notify_timeouts_total",
    "loadgen_errors_total",
    "poll_requests_total",
    "poll_empty_total",
    "loadgen_clients",
    # cAdvisor metrics (Linux only)
    "container_cpu_usage_seconds_total",
    "container_memory_working_set_bytes",
}

EVENT_BLUE = "#3274D9"
POLLING_ORANGE = "#FF9830"


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
        # Grafana 10+/11 timeseries log y-axis
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
                "calcs": ["lastNotNull", "max"],
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
            "reduceOptions": {"values": False, "calcs": ["lastNotNull"], "fields": ""},
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


def unit_override_for_empty_poll_percent():
    """Force percent unit on empty-poll % series (panel default unit is reqps/ops)."""
    return {
        "matcher": {"id": "byRegexp", "options": ".*empty-poll.*"},
        "properties": [{"id": "unit", "value": "percent"}],
    }


def build_dashboard():
    dashboard = {
        "annotations": {"list": []},
        "editable": True,
        "fiscalYearStartMonth": 0,
        "graphTooltip": 1,
        "id": None,
        "links": [],
        "liveNow": False,
        "panels": [],
        "refresh": "5s",
        "schemaVersion": 38,
        "tags": ["ECS351", "architecture-comparison", "event-driven", "polling"],
        "templating": {
            "list": [
                {
                    "current": {"selected": False, "text": "5", "value": "5"},
                    "description": (
                        "Baseline ingest p95 latency (ms) for Event-Driven at minimal load. "
                        "Set from each variant's own 10-client p95 ingest value "
                        "(Ingest Latency panel → event ingest p95 at 10 users). Do not guess."
                    ),
                    "hide": 0,
                    "label": "Baseline Event p95 (ms)",
                    "name": "base_event",
                    "options": [{"selected": True, "text": "5", "value": "5"}],
                    "query": "5",
                    "skipUrlSync": False,
                    "type": "textbox",
                },
                {
                    "current": {"selected": False, "text": "5", "value": "5"},
                    "description": (
                        "Baseline ingest p95 latency (ms) for Polling at minimal load. "
                        "Set from each variant's own 10-client p95 ingest value "
                        "(Ingest Latency panel → polling ingest p95 at 10 users). Do not guess."
                    ),
                    "hide": 0,
                    "label": "Baseline Polling p95 (ms)",
                    "name": "base_polling",
                    "options": [{"selected": True, "text": "5", "value": "5"}],
                    "query": "5",
                    "skipUrlSync": False,
                    "type": "textbox",
                },
            ]
        },
        "time": {"from": "now-30m", "to": "now"},
        "timepicker": {"refresh_intervals": ["5s", "10s", "30s", "1m", "5m"]},
        "timezone": "browser",
        "title": "ECS351: Event-Driven vs Polling Architectural Comparison",
        "uid": "event-vs-polling",
        "version": 1,
    }

    # Top Text Panel — load-step reading instructions + colour key
    top_text = {
        "id": 1,
        "title": "How to Read This Dashboard (Load Steps + Colour Key)",
        "type": "text",
        "gridPos": {"x": 0, "y": 0, "w": 24, "h": 4},
        "options": {
            "mode": "markdown",
            "content": (
                "### Architectural Trade-off Study: Event-Driven (SSE push) vs Polling (5 s pull)\n"
                f"- **Colour key (all panels):** "
                f"<span style=\"color:{EVENT_BLUE}; font-weight:bold;\">Event-Driven = blue</span> · "
                f"<span style=\"color:{POLLING_ORANGE}; font-weight:bold;\">Polling = orange</span> "
                "(fieldConfig overrides match series names containing *event* / *poll*).\n"
                "- **How to read a load step:** the loadgen steps through 10 → 50 → 100 → 200 clients. "
                "Read the **flat middle** of each step (steady state), never the ramp edges. "
                "Align time ranges with `Simulated Clients` before quoting a number.\n"
                "- **Baseline textboxes:** set `$base_event` and `$base_polling` (ms) from **each variant's own "
                "10-client ingest p95** on the Ingest Latency panel. The degradation panel draws a "
                "**20% threshold** (red) above that baseline.\n"
                "- **cAdvisor panel** is Linux-only and stays empty on Docker Desktop — use process_* metrics instead.\n"
                "- **Empty-poll %** must be read as a percent (unit override); cross-check loadgen vs app counters."
            )
        },
    }
    dashboard["panels"].append(top_text)

    # ---------------- Row 1: Responsiveness ----------------
    dashboard["panels"].append(create_row_panel(2, "Row 1: Responsiveness (Headline Result)", 4))

    # Panel 3: Delivery latency p50/p95/p99 — LOG scale
    p1_targets = [
        {"expr": 'histogram_quantile(0.50, sum by(le) (rate(notify_delivery_seconds_bucket{variant="event"}[1m])))', "legendFormat": "event p50"},
        {"expr": 'histogram_quantile(0.95, sum by(le) (rate(notify_delivery_seconds_bucket{variant="event"}[1m])))', "legendFormat": "event p95"},
        {"expr": 'histogram_quantile(0.99, sum by(le) (rate(notify_delivery_seconds_bucket{variant="event"}[1m])))', "legendFormat": "event p99"},
        {"expr": 'histogram_quantile(0.50, sum by(le) (rate(notify_delivery_seconds_bucket{variant="polling"}[1m])))', "legendFormat": "polling p50"},
        {"expr": 'histogram_quantile(0.95, sum by(le) (rate(notify_delivery_seconds_bucket{variant="polling"}[1m])))', "legendFormat": "polling p95"},
        {"expr": 'histogram_quantile(0.99, sum by(le) (rate(notify_delivery_seconds_bucket{variant="polling"}[1m])))', "legendFormat": "polling p99"},
    ]
    dashboard["panels"].append(
        create_panel(
            3,
            "Notification Delivery Latency (p50, p95, p99) — log scale",
            "timeseries",
            0,
            5,
            10,
            8,
            p1_targets,
            unit="s",
            log_scale=True,
            description=(
                "Wall-clock time from ingest POST response until the client receives GOAL_REACHED "
                "(SSE push or poll response). Log y-axis so event-driven sub-10ms lines remain visible "
                "next to polling's ~poll-interval latency."
            ),
        )
    )

    # Panel 4: Mean delivery + timeouts
    p2_targets = [
        {"expr": 'sum by(variant)(rate(notify_delivery_seconds_sum[1m])) / sum by(variant)(rate(notify_delivery_seconds_count[1m]))', "legendFormat": "{{variant}} mean delivery latency (s)"},
        {"expr": 'sum by(variant)(rate(notify_timeouts_total[1m]))', "legendFormat": "{{variant}} timeouts/s"},
    ]
    dashboard["panels"].append(
        create_panel(
            4,
            "Mean Delivery Latency & Notification Timeout Rate",
            "timeseries",
            10,
            5,
            8,
            8,
            p2_targets,
            unit="s",
            description="Average delivery latency and notification delivery timeout rate",
        )
    )

    # Panel 5: Simulated clients
    p3_targets = [
        {"expr": "max by(variant)(loadgen_clients)", "legendFormat": "{{variant}} clients"},
    ]
    dashboard["panels"].append(
        create_panel(
            5,
            "Simulated Clients (loadgen_clients)",
            "timeseries",
            18,
            5,
            6,
            8,
            p3_targets,
            unit="none",
            description="Number of concurrent virtual clients active in each load stage",
        )
    )

    # ---------------- Row 2: Performance and Scalability ----------------
    dashboard["panels"].append(create_row_panel(6, "Row 2: Performance and Scalability", 13))

    # Panel 7: Ingest latency
    p4_targets = [
        {"expr": 'histogram_quantile(0.50, sum by(le) (rate(http_request_duration_seconds_bucket{variant="event",method="POST",route="/telemetry/steps"}[30s])))', "legendFormat": "event ingest p50"},
        {"expr": 'histogram_quantile(0.95, sum by(le) (rate(http_request_duration_seconds_bucket{variant="event",method="POST",route="/telemetry/steps"}[30s])))', "legendFormat": "event ingest p95"},
        {"expr": 'histogram_quantile(0.99, sum by(le) (rate(http_request_duration_seconds_bucket{variant="event",method="POST",route="/telemetry/steps"}[30s])))', "legendFormat": "event ingest p99"},
        {"expr": 'histogram_quantile(0.50, sum by(le) (rate(http_request_duration_seconds_bucket{variant="polling",method="POST",route="/steps/:userId"}[30s])))', "legendFormat": "polling ingest p50"},
        {"expr": 'histogram_quantile(0.95, sum by(le) (rate(http_request_duration_seconds_bucket{variant="polling",method="POST",route="/steps/:userId"}[30s])))', "legendFormat": "polling ingest p95"},
        {"expr": 'histogram_quantile(0.99, sum by(le) (rate(http_request_duration_seconds_bucket{variant="polling",method="POST",route="/steps/:userId"}[30s])))', "legendFormat": "polling ingest p99"},
    ]
    dashboard["panels"].append(
        create_panel(
            7,
            "Ingest Latency (p50, p95, p99)",
            "timeseries",
            0,
            14,
            8,
            8,
            p4_targets,
            unit="s",
            description="Telemetry step ingestion API latency (event: /telemetry/steps, polling: /steps/:userId)",
        )
    )

    # Panel 8: Ingest throughput ONLY (same offered load by design)
    p5_targets = [
        {"expr": 'sum(rate(http_request_duration_seconds_count{variant="event",method="POST",route="/telemetry/steps",status!~"5.."}[30s]))', "legendFormat": "event ingest req/s"},
        {"expr": 'sum(rate(http_request_duration_seconds_count{variant="polling",method="POST",route="/steps/:userId",status!~"5.."}[30s]))', "legendFormat": "polling ingest req/s"},
    ]
    dashboard["panels"].append(
        create_panel(
            8,
            "Ingest throughput (same offered load by design)",
            "timeseries",
            8,
            14,
            8,
            8,
            p5_targets,
            unit="reqps",
            description=(
                "Successful step-ingest requests/s only (POST). Offered ingest load is identical "
                "for both variants by design — architecture must not change this curve."
            ),
        )
    )

    # Panel 23: TOTAL requests/s per variant including poll requests
    p_total_targets = [
        {"expr": 'sum(rate(http_request_duration_seconds_count{variant="event",status!~"5.."}[30s]))', "legendFormat": "event total req/s"},
        {"expr": 'sum(rate(http_request_duration_seconds_count{variant="polling",status!~"5.."}[30s]))', "legendFormat": "polling total req/s"},
        {"expr": 'sum(rate(http_request_duration_seconds_count{variant="polling",route="/notifications/:userId/poll",status!~"5.."}[30s]))', "legendFormat": "polling of which poll req/s"},
    ]
    dashboard["panels"].append(
        create_panel(
            23,
            "Total HTTP requests/s per variant (includes poll requests)",
            "timeseries",
            16,
            14,
            8,
            8,
            p_total_targets,
            unit="reqps",
            description=(
                "All non-5xx HTTP requests. Polling's orange line includes the background poll traffic "
                "that event-driven does not pay for on the data plane (SSE is measured separately)."
            ),
        )
    )

    # Panel 9: Error rate — or vector(0)
    p6_targets = [
        {
            "expr": '100 * sum(rate(http_request_duration_seconds_count{variant="event",status=~"5.."}[30s])) / sum(rate(http_request_duration_seconds_count{variant="event"}[30s])) or vector(0)',
            "legendFormat": "event error %",
        },
        {
            "expr": '100 * sum(rate(http_request_duration_seconds_count{variant="polling",status=~"5.."}[30s])) / sum(rate(http_request_duration_seconds_count{variant="polling"}[30s])) or vector(0)',
            "legendFormat": "polling error %",
        },
    ]
    dashboard["panels"].append(
        create_panel(
            9,
            "Error Rate % (5xx Share)",
            "timeseries",
            0,
            22,
            8,
            8,
            p6_targets,
            unit="percent",
            thresholds={"mode": "absolute", "steps": [{"color": "green", "value": None}, {"color": "red", "value": 1}]},
            description="Percentage of requests returning 5xx. `or vector(0)` keeps the series at 0% when there are no errors (no NaN gap).",
        )
    )

    # Panel 10: Latency degradation vs baseline (20% threshold)
    p7_targets = [
        {
            "expr": '100 * ((histogram_quantile(0.95, sum by(le) (rate(http_request_duration_seconds_bucket{variant="event",method="POST",route="/telemetry/steps"}[30s])))) - ($base_event / 1000)) / ($base_event / 1000)',
            "legendFormat": "event p95 degradation %",
        },
        {
            "expr": '100 * ((histogram_quantile(0.95, sum by(le) (rate(http_request_duration_seconds_bucket{variant="polling",method="POST",route="/steps/:userId"}[30s])))) - ($base_polling / 1000)) / ($base_polling / 1000)',
            "legendFormat": "polling p95 degradation %",
        },
        {
            "expr": "vector(20)",
            "legendFormat": "20% threshold",
        },
    ]
    dashboard["panels"].append(
        create_panel(
            10,
            "Latency Degradation % of Ingest p95 vs Baseline",
            "timeseries",
            8,
            22,
            8,
            8,
            p7_targets,
            unit="percent",
            thresholds={"mode": "absolute", "steps": [{"color": "green", "value": None}, {"color": "red", "value": 20}]},
            description=(
                "Relative ingest-p95 growth vs each variant's own 10-client baseline. "
                "Set $base_event and $base_polling (ms) from that variant's measured 10-client p95 ingest — "
                "never share one baseline across variants. Red threshold line = +20%."
            ),
        )
    )

    # Panel 11: Event-loop lag
    p8_targets = [
        {"expr": 'max by(variant)(nodejs_eventloop_lag_p99_seconds{variant="event"})', "legendFormat": "event event-loop lag p99"},
        {"expr": 'max by(variant)(nodejs_eventloop_lag_p99_seconds{variant="polling"})', "legendFormat": "polling event-loop lag p99"},
    ]
    dashboard["panels"].append(
        create_panel(
            11,
            "Event-Loop Lag p99",
            "timeseries",
            16,
            22,
            8,
            8,
            p8_targets,
            unit="s",
            description="Node.js event loop lag (p99) exposing SSE listener fan-out and main thread blocking",
        )
    )

    # ---------------- Row 3: Resource Efficiency and Cost ----------------
    dashboard["panels"].append(create_row_panel(12, "Row 3: Resource Efficiency and Cost", 30))

    # Panel 13: CPU cores
    p9_targets = [
        {"expr": 'sum by(variant)(rate(process_cpu_seconds_total{job="event-app"}[30s]))', "legendFormat": "event CPU cores"},
        {"expr": 'sum by(variant)(rate(process_cpu_seconds_total{job="polling-app"}[30s]))', "legendFormat": "polling CPU cores"},
    ]
    dashboard["panels"].append(
        create_panel(
            13,
            "CPU Cores Used per App",
            "timeseries",
            0,
            31,
            8,
            8,
            p9_targets,
            unit="none",
            description="Node.js process CPU cores utilized (rate of process_cpu_seconds_total)",
        )
    )

    # Panel 14: Memory
    p10_targets = [
        {"expr": 'sum by(variant)(process_resident_memory_bytes{job="event-app"})', "legendFormat": "event RSS memory"},
        {"expr": 'sum by(variant)(process_resident_memory_bytes{job="polling-app"})', "legendFormat": "polling RSS memory"},
    ]
    dashboard["panels"].append(
        create_panel(
            14,
            "Memory RSS per App",
            "timeseries",
            8,
            31,
            8,
            8,
            p10_targets,
            unit="bytes",
            description="Resident Set Size (RSS) memory consumption in bytes",
        )
    )

    # Panel 15: Throughput per core — INGEST only
    p11_targets = [
        {
            "expr": 'sum(rate(http_request_duration_seconds_count{variant="event",method="POST",route="/telemetry/steps"}[30s])) / sum(rate(process_cpu_seconds_total{job="event-app"}[30s]))',
            "legendFormat": "event ingest req/s per core",
        },
        {
            "expr": 'sum(rate(http_request_duration_seconds_count{variant="polling",method="POST",route="/steps/:userId"}[30s])) / sum(rate(process_cpu_seconds_total{job="polling-app"}[30s]))',
            "legendFormat": "polling ingest req/s per core",
        },
    ]
    dashboard["panels"].append(
        create_panel(
            15,
            "Throughput per CPU Core — per INGEST request (ingest req/s / core)",
            "timeseries",
            16,
            31,
            8,
            8,
            p11_targets,
            unit="ops",
            description="Step-ingest throughput delivered per single CPU core. Counted on POST ingest routes only, not poll/health traffic.",
        )
    )

    # Panel 16: CPU-ms per INGEST request
    p12_targets = [
        {
            "expr": '1000 * sum(rate(process_cpu_seconds_total{job="event-app"}[30s])) / sum(rate(http_request_duration_seconds_count{variant="event",method="POST",route="/telemetry/steps"}[30s]))',
            "legendFormat": "event CPU-ms per ingest",
        },
        {
            "expr": '1000 * sum(rate(process_cpu_seconds_total{job="polling-app"}[30s])) / sum(rate(http_request_duration_seconds_count{variant="polling",method="POST",route="/steps/:userId"}[30s]))',
            "legendFormat": "polling CPU-ms per ingest",
        },
    ]
    dashboard["panels"].append(
        create_panel(
            16,
            "CPU-ms per INGEST request (not per poll)",
            "timeseries",
            0,
            39,
            8,
            8,
            p12_targets,
            unit="ms",
            description="Process CPU time per successful step-ingest POST. Poll and health endpoints are excluded from the denominator.",
        )
    )

    # Panel 17: DB ops
    p13_targets = [
        {"expr": 'sum by(op)(rate(db_operations_total{variant="event",op=~"find|findOne|countDocuments|aggregate"}[30s]))', "legendFormat": "event read: {{op}}"},
        {"expr": 'sum by(op)(rate(db_operations_total{variant="event",op=~"save|findOneAndUpdate|updateOne|updateMany|deleteOne"}[30s]))', "legendFormat": "event write: {{op}}"},
        {"expr": 'sum by(op)(rate(db_operations_total{variant="polling",op=~"find|findOne|countDocuments|aggregate"}[30s]))', "legendFormat": "polling read: {{op}}"},
        {"expr": 'sum by(op)(rate(db_operations_total{variant="polling",op=~"save|findOneAndUpdate|updateOne|updateMany|deleteOne"}[30s]))', "legendFormat": "polling write: {{op}}"},
    ]
    dashboard["panels"].append(
        create_panel(
            17,
            "DB Operations/s by Op (Reads vs Writes)",
            "timeseries",
            8,
            39,
            8,
            8,
            p13_targets,
            unit="ops",
            description="Database read and write operation rates categorized by Mongoose operation",
        )
    )

    # Panel 18: DB ops per delivered notification
    p14_targets = [
        {
            "expr": 'sum(rate(db_operations_total{variant="event"}[1m])) / sum(rate(notify_delivered_total{variant="event"}[1m]))',
            "legendFormat": "event DB ops/notification",
        },
        {
            "expr": 'sum(rate(db_operations_total{variant="polling"}[1m])) / sum(rate(notify_delivered_total{variant="polling"}[1m]))',
            "legendFormat": "polling DB ops/notification",
        },
    ]
    dashboard["panels"].append(
        create_panel(
            18,
            "DB Operations per Delivered Notification",
            "timeseries",
            16,
            39,
            8,
            8,
            p14_targets,
            unit="ops",
            description="Database work needed to successfully deliver a single notification event",
        )
    )

    # Panel 19: cAdvisor — Linux only
    p15_targets = [
        {"expr": 'sum by(name)(rate(container_cpu_usage_seconds_total{name=~".*event-app.*"}[30s]))', "legendFormat": "event container CPU"},
        {"expr": 'sum by(name)(rate(container_cpu_usage_seconds_total{name=~".*polling-app.*"}[30s]))', "legendFormat": "polling container CPU"},
        {"expr": 'sum by(name)(container_memory_working_set_bytes{name=~".*event-app.*"})', "legendFormat": "event container Memory"},
        {"expr": 'sum by(name)(container_memory_working_set_bytes{name=~".*polling-app.*"})', "legendFormat": "polling container Memory"},
    ]
    dashboard["panels"].append(
        create_panel(
            19,
            "cAdvisor (Linux only, empty on Docker Desktop)",
            "timeseries",
            0,
            47,
            24,
            8,
            p15_targets,
            unit="none",
            description=(
                "Linux cgroups metrics via cAdvisor. Not available on Docker Desktop / WSL without cAdvisor — "
                "expect no data here; use process_cpu_seconds_total and process_resident_memory_bytes instead."
            ),
        )
    )

    # ---------------- Row 4: Mechanism Panels ----------------
    dashboard["panels"].append(create_row_panel(20, "Row 4: Mechanism Panels (Why Numbers Differ)", 55))

    # Panel 21: Empty-poll % — unit percent (rates moved to companion panel)
    p16_targets = [
        {
            "expr": '100 * sum(rate(poll_empty_total{variant="polling"}[1m])) / sum(rate(poll_requests_total{variant="polling"}[1m]))',
            "legendFormat": "loadgen empty-poll %",
        },
        {
            "expr": '100 * sum(rate(poll_responses_total{variant="polling",has_new="false"}[30s])) / sum(rate(poll_responses_total{variant="polling"}[30s]))',
            "legendFormat": "app empty-poll %",
        },
    ]
    dashboard["panels"].append(
        create_panel(
            21,
            "Empty-poll share (%) — loadgen vs app cross-check",
            "timeseries",
            0,
            56,
            12,
            8,
            p16_targets,
            unit="percent",
            description=(
                "Percent of polls that found no new notification. Two independent counters must agree: "
                "loadgen poll_empty_total/poll_requests_total and app poll_responses_total{has_new=\"false\"}/poll_responses_total. "
                "Historical bug: loadgen read `has_new` while the API returns `hasNew` (always false) and stopped "
                "polling on first hit — both fixed. Expected range with 5s poll: roughly 33–67% empty, not ~84%."
            ),
        )
    )

    # Panel 24: Poll request intensity (rates)
    p_poll_rates = [
        {"expr": 'sum(rate(http_request_duration_seconds_count{variant="polling",route="/notifications/:userId/poll"}[30s]))', "legendFormat": "app poll req/s"},
        {"expr": 'sum(rate(poll_requests_total{variant="polling"}[1m]))', "legendFormat": "loadgen poll req/s"},
        {"expr": 'sum(rate(notify_delivered_total{variant="polling"}[1m]))', "legendFormat": "polling deliveries/s"},
    ]
    dashboard["panels"].append(
        create_panel(
            24,
            "Poll request intensity (req/s) & delivery rate",
            "timeseries",
            12,
            56,
            12,
            8,
            p_poll_rates,
            unit="reqps",
            description="Raw poll request rates (app + loadgen) and successful notification deliveries/s for context next to empty-poll %.",
        )
    )

    # Panel 22: Event mechanism
    p17_targets = [
        {"expr": 'sum by(event)(rate(events_published_total{variant="event"}[30s]))', "legendFormat": "event published: {{event}}"},
        {"expr": 'max(notification_listeners{variant="event"})', "legendFormat": "event notification_listeners (SSE clients)"},
    ]
    dashboard["panels"].append(
        create_panel(
            22,
            "Event Mechanism: Events Published & SSE Listeners",
            "timeseries",
            0,
            64,
            24,
            8,
            p17_targets,
            unit="ops",
            description="EventBus publishing throughput and active open Server-Sent Event listener count",
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


def extract_metric_names(expr):
    tokens = re.findall(r"[a-zA-Z_][a-zA-Z0-9_]*", expr)
    keywords = {
        "histogram_quantile", "sum", "rate", "by", "le", "max", "min", "avg",
        "count", "on", "or", "and", "unless", "vector", "method", "route",
        "status", "variant", "job", "op", "name", "has_new", "event", "POST",
        "base_event", "base_polling",
    }
    metrics = []
    for t in tokens:
        if t in keywords or t.isdigit():
            continue
        if t in ALLOWED_METRICS:
            metrics.append(t)
    return metrics


def validate_dashboard(dashboard):
    errors = []
    panel_ids = set()
    datasource_uids = set()

    # Collect datasource uids from provisioning file
    ds_path = os.path.join(
        os.path.dirname(__file__), "grafana", "provisioning", "datasources", "prometheus.yml"
    )
    if os.path.exists(ds_path):
        with open(ds_path) as f:
            for m in re.finditer(r"uid:\s*(\S+)", f.read()):
                datasource_uids.add(m.group(1))
    if not datasource_uids:
        datasource_uids.add("prom")

    def walk_panels(panels):
        for panel in panels:
            pid = panel.get("id")
            if pid in panel_ids:
                errors.append(f"Duplicate panel ID: {pid}")
            panel_ids.add(pid)

            ds = panel.get("datasource")
            if isinstance(ds, dict):
                uid = ds.get("uid")
                if uid and uid not in datasource_uids and not str(uid).startswith("${"):
                    errors.append(f"Panel {pid} datasource uid '{uid}' not in provisioning")

            for target in panel.get("targets", []):
                tds = target.get("datasource", {})
                if isinstance(tds, dict):
                    uid = tds.get("uid")
                    if uid and uid not in datasource_uids and not str(uid).startswith("${"):
                        errors.append(
                            f"Target in panel {pid} datasource uid '{uid}' not in provisioning"
                        )
                expr = target.get("expr", "")
                if not validate_brackets(expr):
                    errors.append(f"Unbalanced brackets in expr: {expr}")
                # metric names before { or [
                for m in re.findall(r"([a-zA-Z_][a-zA-Z0-9_]*)\s*[\{\[]", expr):
                    if m in {"rate", "sum", "by", "max", "min", "avg", "histogram_quantile", "vector", "or"}:
                        continue
                    if m not in ALLOWED_METRICS:
                        errors.append(f"Disallowed metric '{m}' used in expr: {expr[:120]}")
            if "panels" in panel:
                walk_panels(panel["panels"])

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

    out_dir = os.path.join("benchmark", "grafana", "dashboards")
    os.makedirs(out_dir, exist_ok=True)
    out_file = os.path.join(out_dir, "event-vs-polling.json")

    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(dash, f, indent=2)
        f.write("\n")

    print(f"[OK] Dashboard generated and validated successfully: {out_file}")
    print(f"Total panels: {len(dash['panels'])}")
    print(f"Panel IDs: {[p['id'] for p in dash['panels']]}")
