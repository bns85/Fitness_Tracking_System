#!/usr/bin/env python3
"""
Generates and validates the ECS351 Event-Driven vs Polling Grafana comparison dashboard.
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
    # Loadgen metrics
    "notify_delivery_seconds_bucket",
    "notify_delivery_seconds_sum",
    "notify_delivery_seconds_count",
    "ingest_client_duration_seconds_bucket",
    "ingest_client_duration_seconds_sum",
    "ingest_client_duration_seconds_count",
    "poll_client_duration_seconds_bucket",
    "poll_client_duration_seconds_sum",
    "poll_client_duration_seconds_count",
    "notify_delivered_total",
    "notify_timeouts_total",
    "loadgen_errors_total",
    "poll_requests_total",
    "poll_empty_total",
    "loadgen_clients",
    # cAdvisor metrics
    "container_cpu_usage_seconds_total",
    "container_memory_working_set_bytes",
}

def create_color_overrides():
    return [
        {
            "matcher": {"id": "byRegexp", "options": ".*(?i)event.*"},
            "properties": [
                {
                    "id": "color",
                    "value": {"fixedColor": "#3274D9", "mode": "fixed"}
                }
            ]
        },
        {
            "matcher": {"id": "byRegexp", "options": ".*(?i)poll.*"},
            "properties": [
                {
                    "id": "color",
                    "value": {"fixedColor": "#FF9830", "mode": "fixed"}
                }
            ]
        }
    ]

def default_field_config(unit="short", thresholds=None):
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
                "spanNulls": False
            }
        },
        "overrides": create_color_overrides()
    }
    if thresholds:
        cfg["defaults"]["thresholds"] = thresholds
    else:
        cfg["defaults"]["thresholds"] = {
            "mode": "absolute",
            "steps": [{"color": "green", "value": None}]
        }
    return cfg

def create_panel(panel_id, title, ptype, x, y, w, h, targets, unit="short", thresholds=None, description=""):
    panel = {
        "id": panel_id,
        "title": title,
        "type": ptype,
        "description": description,
        "gridPos": {"x": x, "y": y, "w": w, "h": h},
        "datasource": {"type": "prometheus", "uid": "prom"},
        "targets": []
    }
    
    if ptype == "timeseries":
        panel["fieldConfig"] = default_field_config(unit, thresholds)
        panel["options"] = {
            "tooltip": {"mode": "multi", "sort": "desc"},
            "legend": {
                "calcs": ["lastNotNull", "max"],
                "displayMode": "table",
                "placement": "bottom",
                "showLegend": True
            }
        }
    elif ptype == "barchart":
        panel["fieldConfig"] = default_field_config(unit, thresholds)
        panel["options"] = {
            "tooltip": {"mode": "multi", "sort": "desc"},
            "legend": {
                "calcs": ["lastNotNull", "max"],
                "displayMode": "table",
                "placement": "bottom",
                "showLegend": True
            },
            "stacking": "normal"
        }
    elif ptype == "stat":
        panel["fieldConfig"] = {
            "defaults": {
                "unit": unit,
                "thresholds": {"mode": "absolute", "steps": [{"color": "green", "value": None}]}
            },
            "overrides": create_color_overrides()
        }
        panel["options"] = {
            "reduceOptions": {"values": False, "calcs": ["lastNotNull"], "fields": ""},
            "orientation": "auto",
            "textMode": "auto",
            "colorMode": "value",
            "graphMode": "area"
        }

    for idx, t in enumerate(targets):
        ref_id = chr(65 + idx)
        target_obj = {
            "refId": ref_id,
            "expr": t["expr"],
            "legendFormat": t.get("legendFormat", ""),
            "datasource": {"type": "prometheus", "uid": "prom"}
        }
        panel["targets"].append(target_obj)
        
    return panel

def create_row_panel(panel_id, title, y):
    return {
        "id": panel_id,
        "title": title,
        "type": "row",
        "gridPos": {"x": 0, "y": y, "w": 24, "h": 1},
        "collapsed": False,
        "panels": []
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
                    "description": "Baseline ingest p95 latency (ms) for Event-Driven variant at minimal load",
                    "hide": 0,
                    "label": "Baseline Event p95 (ms)",
                    "name": "base_event",
                    "options": [{"selected": True, "text": "5", "value": "5"}],
                    "query": "5",
                    "skipUrlSync": False,
                    "type": "textbox"
                },
                {
                    "current": {"selected": False, "text": "5", "value": "5"},
                    "description": "Baseline ingest p95 latency (ms) for Polling variant at minimal load",
                    "hide": 0,
                    "label": "Baseline Polling p95 (ms)",
                    "name": "base_polling",
                    "options": [{"selected": True, "text": "5", "value": "5"}],
                    "query": "5",
                    "skipUrlSync": False,
                    "type": "textbox"
                }
            ]
        },
        "time": {"from": "now-30m", "to": "now"},
        "timepicker": {
            "refresh_intervals": ["5s", "10s", "30s", "1m", "5m"]
        },
        "timezone": "browser",
        "title": "ECS351: Event-Driven vs Polling Architectural Comparison",
        "uid": "event-vs-polling",
        "version": 1
    }

    # Top Text Panel
    top_text = {
        "id": 1,
        "title": "ECS351 Architectural Evaluation: Event-Driven Push (SSE) vs Client Polling (5s)",
        "type": "text",
        "gridPos": {"x": 0, "y": 0, "w": 24, "h": 4},
        "options": {
            "mode": "markdown",
            "content": (
                "### Architectural Trade-off Study: Event-Driven vs. Polling\n"
                "- **Architectural Difference Tested**: Push (Server-Sent Events backed by in-process EventBus) vs. Pull (Client interval polling every 5 s).\n"
                "- **Color Encoding**: <span style=\"color:#3274D9; font-weight:bold;\">Event-Driven (Blue)</span> vs. <span style=\"color:#FF9830; font-weight:bold;\">Polling (Orange)</span> across all panels.\n"
                "- **How to Read a Load Step**: Always read steady-state values from the **middle flat section** of each step (e.g. 10, 50, 100, 200, 400 clients), avoiding ramp-up or ramp-down spikes.\n"
                "- **Baseline Textboxes**: Enter the lowest-load (10 clients) p95 ingest latency in `$base_event` and `$base_polling` (in ms, default: 5) to calculate degradation %."
            )
        }
    }
    dashboard["panels"].append(top_text)

    # ---------------- Row 1: Responsiveness ----------------
    dashboard["panels"].append(create_row_panel(2, "Row 1: Responsiveness (Headline Result)", 4))

    # Panel 1: Notification delivery latency p50/p95/p99
    p1_targets = [
        {"expr": "histogram_quantile(0.50, sum by(le) (rate(notify_delivery_seconds_bucket{variant=\"event\"}[1m])))", "legendFormat": "event p50"},
        {"expr": "histogram_quantile(0.95, sum by(le) (rate(notify_delivery_seconds_bucket{variant=\"event\"}[1m])))", "legendFormat": "event p95"},
        {"expr": "histogram_quantile(0.99, sum by(le) (rate(notify_delivery_seconds_bucket{variant=\"event\"}[1m])))", "legendFormat": "event p99"},
        {"expr": "histogram_quantile(0.50, sum by(le) (rate(notify_delivery_seconds_bucket{variant=\"polling\"}[1m])))", "legendFormat": "polling p50"},
        {"expr": "histogram_quantile(0.95, sum by(le) (rate(notify_delivery_seconds_bucket{variant=\"polling\"}[1m])))", "legendFormat": "polling p95"},
        {"expr": "histogram_quantile(0.99, sum by(le) (rate(notify_delivery_seconds_bucket{variant=\"polling\"}[1m])))", "legendFormat": "polling p99"},
    ]
    dashboard["panels"].append(create_panel(
        3, "Notification Delivery Latency (p50, p95, p99)", "timeseries",
        0, 5, 10, 8, p1_targets, unit="s",
        description="Time from step telemetry ingestion until client receives notification (p50, p95, p99)"
    ))

    # Panel 2: Mean delivery latency per variant + notify_timeouts rate
    p2_targets = [
        {"expr": "sum by(variant)(rate(notify_delivery_seconds_sum[1m])) / sum by(variant)(rate(notify_delivery_seconds_count[1m]))", "legendFormat": "{{variant}} mean delivery latency (s)"},
        {"expr": "sum by(variant)(rate(notify_timeouts_total[1m]))", "legendFormat": "{{variant}} timeouts/s"}
    ]
    dashboard["panels"].append(create_panel(
        4, "Mean Delivery Latency & Notification Timeout Rate", "timeseries",
        10, 5, 8, 8, p2_targets, unit="s",
        description="Average delivery latency and notification delivery timeout rate"
    ))

    # Panel 3: Simulated Clients
    p3_targets = [
        {"expr": "max by(variant)(loadgen_clients)", "legendFormat": "{{variant}} clients"}
    ]
    dashboard["panels"].append(create_panel(
        5, "Simulated Clients (loadgen_clients)", "timeseries",
        18, 5, 6, 8, p3_targets, unit="none",
        description="Number of concurrent virtual clients active in each load stage"
    ))

    # ---------------- Row 2: Performance and Scalability ----------------
    dashboard["panels"].append(create_row_panel(6, "Row 2: Performance and Scalability", 13))

    # Panel 4: Ingest latency p50/p95/p99 per variant
    p4_targets = [
        {"expr": "histogram_quantile(0.50, sum by(le) (rate(http_request_duration_seconds_bucket{variant=\"event\",method=\"POST\",route=\"/telemetry/steps\"}[30s])))", "legendFormat": "event ingest p50"},
        {"expr": "histogram_quantile(0.95, sum by(le) (rate(http_request_duration_seconds_bucket{variant=\"event\",method=\"POST\",route=\"/telemetry/steps\"}[30s])))", "legendFormat": "event ingest p95"},
        {"expr": "histogram_quantile(0.99, sum by(le) (rate(http_request_duration_seconds_bucket{variant=\"event\",method=\"POST\",route=\"/telemetry/steps\"}[30s])))", "legendFormat": "event ingest p99"},
        {"expr": "histogram_quantile(0.50, sum by(le) (rate(http_request_duration_seconds_bucket{variant=\"polling\",method=\"POST\",route=\"/steps/:userId\"}[30s])))", "legendFormat": "polling ingest p50"},
        {"expr": "histogram_quantile(0.95, sum by(le) (rate(http_request_duration_seconds_bucket{variant=\"polling\",method=\"POST\",route=\"/steps/:userId\"}[30s])))", "legendFormat": "polling ingest p95"},
        {"expr": "histogram_quantile(0.99, sum by(le) (rate(http_request_duration_seconds_bucket{variant=\"polling\",method=\"POST\",route=\"/steps/:userId\"}[30s])))", "legendFormat": "polling ingest p99"}
    ]
    dashboard["panels"].append(create_panel(
        7, "Ingest Latency (p50, p95, p99)", "timeseries",
        0, 14, 8, 8, p4_targets, unit="s",
        description="Telemetry step ingestion API latency (event: /telemetry/steps, polling: /steps/:userId)"
    ))

    # Panel 5: Throughput (non-5xx requests/s) per variant
    p5_targets = [
        {"expr": "sum(rate(http_request_duration_seconds_count{variant=\"event\",status!~\"5..\"}[30s]))", "legendFormat": "event non-5xx req/s"},
        {"expr": "sum(rate(http_request_duration_seconds_count{variant=\"polling\",status!~\"5..\"}[30s]))", "legendFormat": "polling non-5xx req/s"}
    ]
    dashboard["panels"].append(create_panel(
        8, "Throughput (non-5xx req/s)", "timeseries",
        8, 14, 8, 8, p5_targets, unit="reqps",
        description="Successful request throughput across all HTTP endpoints (non-5xx)"
    ))

    # Panel 6: Error rate % (5xx share of all requests)
    p6_targets = [
        {"expr": "100 * sum(rate(http_request_duration_seconds_count{variant=\"event\",status=~\"5..\"}[30s])) / sum(rate(http_request_duration_seconds_count{variant=\"event\"}[30s]))", "legendFormat": "event error %"},
        {"expr": "100 * sum(rate(http_request_duration_seconds_count{variant=\"polling\",status=~\"5..\"}[30s])) / sum(rate(http_request_duration_seconds_count{variant=\"polling\"}[30s]))", "legendFormat": "polling error %"}
    ]
    dashboard["panels"].append(create_panel(
        9, "Error Rate % (5xx Share)", "timeseries",
        16, 14, 8, 8, p6_targets, unit="percent",
        thresholds={"mode": "absolute", "steps": [{"color": "green", "value": None}, {"color": "red", "value": 1}]},
        description="Percentage of requests returning 5xx status codes"
    ))

    # Panel 7: Latency degradation % of ingest p95 vs baseline
    p7_targets = [
        {
            "expr": "100 * ((histogram_quantile(0.95, sum by(le) (rate(http_request_duration_seconds_bucket{variant=\"event\",method=\"POST\",route=\"/telemetry/steps\"}[30s])))) - ($base_event / 1000)) / ($base_event / 1000)",
            "legendFormat": "event p95 degradation %"
        },
        {
            "expr": "100 * ((histogram_quantile(0.95, sum by(le) (rate(http_request_duration_seconds_bucket{variant=\"polling\",method=\"POST\",route=\"/steps/:userId\"}[30s])))) - ($base_polling / 1000)) / ($base_polling / 1000)",
            "legendFormat": "polling p95 degradation %"
        }
    ]
    dashboard["panels"].append(create_panel(
        10, "Latency Degradation % of Ingest p95 vs Baseline", "timeseries",
        0, 22, 12, 8, p7_targets, unit="percent",
        thresholds={"mode": "absolute", "steps": [{"color": "green", "value": None}, {"color": "red", "value": 20}]},
        description="Relative latency growth compared to minimal load baseline ($base_event, $base_polling in ms)"
    ))

    # Panel 8: Event-loop lag p99
    p8_targets = [
        {"expr": "max by(variant)(nodejs_eventloop_lag_p99_seconds{variant=\"event\"})", "legendFormat": "event event-loop lag p99"},
        {"expr": "max by(variant)(nodejs_eventloop_lag_p99_seconds{variant=\"polling\"})", "legendFormat": "polling event-loop lag p99"}
    ]
    dashboard["panels"].append(create_panel(
        11, "Event-Loop Lag p99", "timeseries",
        12, 22, 12, 8, p8_targets, unit="s",
        description="Node.js event loop lag (p99) exposing SSE listener fan-out and main thread blocking"
    ))

    # ---------------- Row 3: Resource Efficiency and Cost ----------------
    dashboard["panels"].append(create_row_panel(12, "Row 3: Resource Efficiency and Cost", 30))

    # Panel 9: CPU cores used per app
    p9_targets = [
        {"expr": "sum by(variant)(rate(process_cpu_seconds_total{job=\"event-app\"}[30s]))", "legendFormat": "event CPU cores"},
        {"expr": "sum by(variant)(rate(process_cpu_seconds_total{job=\"polling-app\"}[30s]))", "legendFormat": "polling CPU cores"}
    ]
    dashboard["panels"].append(create_panel(
        13, "CPU Cores Used per App", "timeseries",
        0, 31, 8, 8, p9_targets, unit="none",
        description="Node.js process CPU cores utilized (rate of process_cpu_seconds_total)"
    ))

    # Panel 10: Memory RSS per app
    p10_targets = [
        {"expr": "sum by(variant)(process_resident_memory_bytes{job=\"event-app\"})", "legendFormat": "event RSS memory"},
        {"expr": "sum by(variant)(process_resident_memory_bytes{job=\"polling-app\"})", "legendFormat": "polling RSS memory"}
    ]
    dashboard["panels"].append(create_panel(
        14, "Memory RSS per App", "timeseries",
        8, 31, 8, 8, p10_targets, unit="bytes",
        description="Resident Set Size (RSS) memory consumption in bytes"
    ))

    # Panel 11: Throughput per CPU core
    p11_targets = [
        {
            "expr": "sum by(variant)(rate(http_request_duration_seconds_count{variant=\"event\"}[30s])) / sum by(variant)(rate(process_cpu_seconds_total{job=\"event-app\"}[30s]))",
            "legendFormat": "event throughput/core"
        },
        {
            "expr": "sum by(variant)(rate(http_request_duration_seconds_count{variant=\"polling\"}[30s])) / sum by(variant)(rate(process_cpu_seconds_total{job=\"polling-app\"}[30s]))",
            "legendFormat": "polling throughput/core"
        }
    ]
    dashboard["panels"].append(create_panel(
        15, "Throughput per CPU Core (req/s / core)", "timeseries",
        16, 31, 8, 8, p11_targets, unit="ops",
        description="Request throughput delivered per single CPU core consumed"
    ))

    # Panel 12: CPU-ms per request
    p12_targets = [
        {
            "expr": "1000 * sum by(variant)(rate(process_cpu_seconds_total{job=\"event-app\"}[30s])) / sum by(variant)(rate(http_request_duration_seconds_count{variant=\"event\"}[30s]))",
            "legendFormat": "event CPU-ms/req"
        },
        {
            "expr": "1000 * sum by(variant)(rate(process_cpu_seconds_total{job=\"polling-app\"}[30s])) / sum by(variant)(rate(http_request_duration_seconds_count{variant=\"polling\"}[30s]))",
            "legendFormat": "polling CPU-ms/req"
        }
    ]
    dashboard["panels"].append(create_panel(
        16, "CPU-ms per Request", "timeseries",
        0, 39, 8, 8, p12_targets, unit="ms",
        description="Average CPU execution time expended per HTTP transaction"
    ))

    # Panel 13: DB operations/s by op (stacked), reads vs writes per variant
    p13_targets = [
        {"expr": "sum by(op)(rate(db_operations_total{variant=\"event\",op=~\"find|findOne|countDocuments|aggregate\"}[30s]))", "legendFormat": "event read: {{op}}"},
        {"expr": "sum by(op)(rate(db_operations_total{variant=\"event\",op=~\"save|findOneAndUpdate|updateOne|updateMany|deleteOne\"}[30s]))", "legendFormat": "event write: {{op}}"},
        {"expr": "sum by(op)(rate(db_operations_total{variant=\"polling\",op=~\"find|findOne|countDocuments|aggregate\"}[30s]))", "legendFormat": "polling read: {{op}}"},
        {"expr": "sum by(op)(rate(db_operations_total{variant=\"polling\",op=~\"save|findOneAndUpdate|updateOne|updateMany|deleteOne\"}[30s]))", "legendFormat": "polling write: {{op}}"}
    ]
    dashboard["panels"].append(create_panel(
        17, "DB Operations/s by Op (Reads vs Writes)", "timeseries",
        8, 39, 8, 8, p13_targets, unit="ops",
        description="Database read and write operation rates categorized by Mongoose operation"
    ))

    # Panel 14: DB operations per delivered notification
    p14_targets = [
        {
            "expr": "sum by(variant)(rate(db_operations_total{variant=\"event\"}[1m])) / on(variant) sum by(variant)(rate(notify_delivered_total{variant=\"event\"}[1m]))",
            "legendFormat": "event DB ops/notification"
        },
        {
            "expr": "sum by(variant)(rate(db_operations_total{variant=\"polling\"}[1m])) / on(variant) sum by(variant)(rate(notify_delivered_total{variant=\"polling\"}[1m]))",
            "legendFormat": "polling DB ops/notification"
        }
    ]
    dashboard["panels"].append(create_panel(
        18, "DB Operations per Delivered Notification", "timeseries",
        16, 39, 8, 8, p14_targets, unit="ops",
        description="Database work needed to successfully deliver a single notification event"
    ))

    # Panel 15: cAdvisor CPU and memory (Linux only)
    p15_targets = [
        {"expr": "sum by(name)(rate(container_cpu_usage_seconds_total{name=~\".*event-app.*\"}[30s]))", "legendFormat": "event container CPU"},
        {"expr": "sum by(name)(rate(container_cpu_usage_seconds_total{name=~\".*polling-app.*\"}[30s]))", "legendFormat": "polling container CPU"},
        {"expr": "sum by(name)(container_memory_working_set_bytes{name=~\".*event-app.*\"})", "legendFormat": "event container Memory"},
        {"expr": "sum by(name)(container_memory_working_set_bytes{name=~\".*polling-app.*\"})", "legendFormat": "polling container Memory"}
    ]
    dashboard["panels"].append(create_panel(
        19, "cAdvisor CPU and Memory (Linux only)", "timeseries",
        0, 47, 24, 8, p15_targets, unit="none",
        description="Container resource metrics recorded by cAdvisor (available on Linux / cgroups)"
    ))

    # ---------------- Row 4: Mechanism Panels ----------------
    dashboard["panels"].append(create_row_panel(20, "Row 4: Mechanism Panels (Why Numbers Differ)", 55))

    # Panel 16: Polling: poll requests/s and empty-poll %
    p16_targets = [
        {"expr": "sum(rate(http_request_duration_seconds_count{variant=\"polling\",route=\"/notifications/:userId/poll\"}[30s]))", "legendFormat": "polling app poll req/s"},
        {"expr": "100 * sum(rate(poll_responses_total{variant=\"polling\",has_new=\"false\"}[30s])) / sum(rate(poll_responses_total{variant=\"polling\"}[30s]))", "legendFormat": "polling app empty-poll %"},
        {"expr": "sum(rate(poll_requests_total{variant=\"polling\"}[1m]))", "legendFormat": "loadgen poll req/s"},
        {"expr": "100 * sum(rate(poll_empty_total{variant=\"polling\"}[1m])) / sum(rate(poll_requests_total{variant=\"polling\"}[1m]))", "legendFormat": "loadgen empty-poll %"}
    ]
    dashboard["panels"].append(create_panel(
        21, "Polling Mechanism: Poll Requests & Empty-Poll %", "timeseries",
        0, 56, 12, 8, p16_targets, unit="ops",
        description="Polling request intensity and proportion of wasteful empty polls (has_new=false)"
    ))

    # Panel 17: Event: events published/s and notification listeners
    p17_targets = [
        {"expr": "sum by(event)(rate(events_published_total{variant=\"event\"}[30s]))", "legendFormat": "event published: {{event}}"},
        {"expr": "max(notification_listeners{variant=\"event\"})", "legendFormat": "event notification_listeners (SSE clients)"}
    ]
    dashboard["panels"].append(create_panel(
        22, "Event Mechanism: Events Published & SSE Listeners", "timeseries",
        12, 56, 12, 8, p17_targets, unit="ops",
        description="EventBus publishing throughput and active open Server-Sent Event listener count"
    ))

    return dashboard

def validate_brackets(expr):
    stack = []
    pairs = {')': '(', ']': '[', '}': '{'}
    for char in expr:
        if char in "([{":
            stack.append(char)
        elif char in ")]}":
            if not stack or stack[-1] != pairs[char]:
                return False
            stack.pop()
    return len(stack) == 0

def extract_metric_names(expr):
    # Match Prometheus metric identifiers
    # Identifiers: [a-zA-Z_:][a-zA-Z0-9_:]*
    tokens = re.findall(r'[a-zA-Z_][a-zA-Z0-9_]*', expr)
    keywords = {
        'histogram_quantile', 'sum', 'rate', 'by', 'le', 'max', 'min', 'avg',
        'count', 'on', 'or', 'and', 'unless', 'vector', 'method', 'route',
        'status', 'variant', 'job', 'op', 'name', 'has_new', 'event', 'POST',
        'base_event', 'base_polling'
    }
    metrics = []
    for t in tokens:
        if t in keywords:
            continue
        if t.isdigit():
            continue
        if t in ALLOWED_METRICS:
            metrics.append(t)
        else:
            # Check if it could be a sub-token or function
            pass
    return metrics

def validate_dashboard(dashboard):
    errors = []
    panel_ids = set()
    
    for panel in dashboard["panels"]:
        pid = panel["id"]
        if pid in panel_ids:
            errors.append(f"Duplicate panel ID: {pid}")
        panel_ids.add(pid)
        
        # Check datasource if present
        if "datasource" in panel:
            ds = panel["datasource"]
            if ds.get("uid") != "prom":
                errors.append(f"Panel {pid} ({panel.get('title')}) datasource uid is not 'prom': {ds}")

        for target in panel.get("targets", []):
            tds = target.get("datasource", {})
            if tds.get("uid") != "prom":
                errors.append(f"Target {target.get('refId')} in panel {pid} datasource uid is not 'prom': {tds}")
                
            expr = target.get("expr", "")
            if not validate_brackets(expr):
                errors.append(f"Unbalanced brackets in expr: {expr}")
                
            # Verify metric names in expr
            # Extract raw metric tokens matching [a-zA-Z_][a-zA-Z0-9_]* before { or [
            candidate_metrics = re.findall(r'([a-zA-Z_][a-zA-Z0-9_]*)\s*[\{\[]', expr)
            for m in candidate_metrics:
                if m not in ALLOWED_METRICS and m not in {'rate', 'sum', 'by', 'max', 'min', 'avg', 'histogram_quantile'}:
                    errors.append(f"Disallowed metric '{m}' used in expr: {expr}")
                    
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
        
    print(f"[OK] Dashboard generated and validated successfully: {out_file}")
    print(f"Total panels: {len(dash['panels'])}")
