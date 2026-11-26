#!/usr/bin/env node
"use strict";

/**
 * benchmark/analysis/aggregate.js — PulseFlow Benchmark Aggregation Script
 *
 * Implements the Professor's core analysis rules:
 *   - Calculates MEDIAN (primary) and MEAN over multiple runs (e.g. 3 runs) per (variant, users).
 *   - Never reports average of percentiles as a headline.
 *   - Measures degradation % strictly against each variant's OWN 10-client baseline.
 *   - Aggregates delivery & ingest latencies, CPU time, CPU per notification, memory RSS,
 *     timeout rates, and container counts.
 *   - Outputs benchmark/results/summary.csv and benchmark/results/summary.md.
 *
 * Usage:
 *   node benchmark/analysis/aggregate.js [resultsDir]
 */

const fs = require("fs");
const path = require("path");

const RESULTS_DIR = process.argv[2] || path.join(__dirname, "..", "results");

function parseCsv(filepath) {
  const content = fs.readFileSync(filepath, "utf8").trim();
  if (!content) return [];
  const lines = content.split("\n");
  const headers = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = line.split(",").map((v) => v.trim());
    return Object.fromEntries(headers.map((h, i) => [h, values[i]]));
  });
}

function median(arr) {
  if (!arr.length) return null;
  const sorted = arr.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mean(arr) {
  if (!arr.length) return null;
  return arr.reduce((sum, val) => sum + val, 0) / arr.length;
}

function round(val, d = 4) {
  if (val === null || val === undefined || Number.isNaN(val)) return "";
  const factor = 10 ** d;
  return String(Math.round(val * factor) / factor);
}

function runAggregation() {
  console.log(`Scanning results directory: ${RESULTS_DIR}`);

  if (!fs.existsSync(RESULTS_DIR)) {
    console.error(`Error: Results directory does not exist: ${RESULTS_DIR}`);
    process.exit(1);
  }

  const files = fs.readdirSync(RESULTS_DIR).filter((f) => {
    return f.endsWith("-levels.csv") && !f.startsWith("_");
  });

  if (!files.length) {
    console.log("No level CSV files found in results directory. Generating empty summary templates.");
  } else {
    console.log(`Found ${files.length} benchmark CSV file(s): ${files.join(", ")}`);
  }

  const allRows = [];
  for (const file of files) {
    const rows = parseCsv(path.join(RESULTS_DIR, file));
    allRows.push(...rows);
  }

  // Group by (variant, users)
  const groups = new Map();
  for (const row of allRows) {
    const variant = row.variant;
    const users = parseInt(row.users, 10);
    if (!variant || isNaN(users)) continue;

    const key = `${variant}__${users}`;
    if (!groups.has(key)) {
      groups.set(key, { variant, users, runs: [] });
    }
    groups.get(key).runs.push(row);
  }

  // Sort groups by variant and users ascending
  const sortedKeys = Array.from(groups.keys()).sort((a, b) => {
    const [varA, userA] = a.split("__");
    const [varB, userB] = b.split("__");
    if (varA !== varB) return varA.localeCompare(varB);
    return parseInt(userA, 10) - parseInt(userB, 10);
  });

  // Calculate baselines (10 users) for each variant
  const baselines = {};
  for (const key of sortedKeys) {
    const group = groups.get(key);
    if (group.users === 10) {
      const p95s = group.runs.map((r) => parseFloat(r.delivery_p95_s)).filter((n) => !isNaN(n));
      const ingestP95s = group.runs.map((r) => parseFloat(r.ingest_p95_s)).filter((n) => !isNaN(n));
      baselines[group.variant] = {
        delivery_p95: median(p95s),
        ingest_p95: median(ingestP95s),
      };
    }
  }

  // Compute aggregated summaries
  const summaries = [];
  for (const key of sortedKeys) {
    const group = groups.get(key);
    const runs = group.runs;

    const num = (col) => runs.map((r) => parseFloat(r[col])).filter((n) => !isNaN(n));

    const delivery_p50 = median(num("delivery_p50_s"));
    const delivery_p95 = median(num("delivery_p95_s"));
    const delivery_p99 = median(num("delivery_p99_s"));
    const delivery_mean = mean(num("delivery_mean_s"));

    const ingest_p50 = median(num("ingest_p50_s"));
    const ingest_p95 = median(num("ingest_p95_s"));
    const ingest_p99 = median(num("ingest_p99_s"));

    const cpu_delta = median(num("app_cpu_delta_s"));
    const rss_bytes = median(num("app_rss_bytes"));
    const delivered = median(num("notify_delivered"));
    const timeouts = median(num("delivery_timeouts"));
    const errors = median(num("ingest_errors"));

    const cpu_per_notif_ms =
      cpu_delta != null && delivered && delivered > 0
        ? (cpu_delta * 1000) / delivered
        : null;

    // Degradation vs own 10-client baseline
    let degradation_pct = null;
    if (baselines[group.variant] && baselines[group.variant].delivery_p95) {
      const base = baselines[group.variant].delivery_p95;
      degradation_pct = delivery_p95 ? ((delivery_p95 - base) / base) * 100 : null;
    }

    const containers = runs[0].containers || "";
    const replicas = runs[0].replicas || "";

    summaries.push({
      variant: group.variant,
      users: group.users,
      run_count: runs.length,
      delivery_p50_s: delivery_p50,
      delivery_p95_s: delivery_p95,
      delivery_p99_s: delivery_p99,
      delivery_mean_s: delivery_mean,
      ingest_p50_s: ingest_p50,
      ingest_p95_s: ingest_p95,
      ingest_p99_s: ingest_p99,
      cpu_delta_s: cpu_delta,
      cpu_per_notif_ms: cpu_per_notif_ms,
      rss_mb: rss_bytes ? rss_bytes / (1024 * 1024) : null,
      delivered: delivered,
      timeouts: timeouts,
      errors: errors,
      degradation_pct: degradation_pct,
      containers,
      replicas,
    });
  }

  // 1. Output summary.csv
  const csvHeaders = [
    "variant",
    "users",
    "run_count",
    "delivery_p50_s",
    "delivery_p95_s",
    "delivery_p99_s",
    "delivery_mean_s",
    "ingest_p50_s",
    "ingest_p95_s",
    "ingest_p99_s",
    "cpu_delta_s",
    "cpu_per_notif_ms",
    "rss_mb",
    "delivered",
    "timeouts",
    "errors",
    "degradation_pct",
    "containers",
    "replicas",
  ];

  const csvRows = summaries.map((s) => [
    s.variant,
    s.users,
    s.run_count,
    round(s.delivery_p50_s, 4),
    round(s.delivery_p95_s, 4),
    round(s.delivery_p99_s, 4),
    round(s.delivery_mean_s, 4),
    round(s.ingest_p50_s, 4),
    round(s.ingest_p95_s, 4),
    round(s.ingest_p99_s, 4),
    round(s.cpu_delta_s, 3),
    round(s.cpu_per_notif_ms, 2),
    round(s.rss_mb, 1),
    round(s.delivered, 0),
    round(s.timeouts, 0),
    round(s.errors, 0),
    round(s.degradation_pct, 2),
    s.containers,
    s.replicas,
  ]);

  const summaryCsvPath = path.join(RESULTS_DIR, "summary.csv");
  const csvContent = [csvHeaders.join(","), ...csvRows.map((r) => r.join(","))].join("\n") + "\n";
  fs.writeFileSync(summaryCsvPath, csvContent, "utf8");
  console.log(`[OK] Generated CSV summary: ${summaryCsvPath}`);

  // 2. Output summary.md
  const mdRows = summaries.map((s) => {
    return `| **${s.variant}** | ${s.users} | ${s.run_count} | ${round(s.delivery_p50_s * 1000, 1)} ms | ${round(s.delivery_p95_s * 1000, 1)} ms | ${round(s.ingest_p95_s * 1000, 1)} ms | ${round(s.cpu_per_notif_ms, 1)} ms | ${round(s.rss_mb, 1)} MB | ${s.timeouts || 0} | ${round(s.degradation_pct, 1)}% |`;
  });

  const summaryMdPath = path.join(RESULTS_DIR, "summary.md");
  const mdContent = `# PulseFlow Benchmark Summary (Median of Multi-Run Trials)

> Aggregated across benchmark level runs according to the architectural evaluation methodology.
> Values represent the **MEDIAN** of recorded trials per stage.

| Variant | Users | Runs | Delivery p50 | Delivery p95 | Ingest p95 | CPU / Notif | Memory RSS | Timeouts | Degradation vs 10u |
|:---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
${mdRows.join("\n")}

---
*Report auto-generated by \`benchmark/analysis/aggregate.js\` on ${new Date().toISOString().slice(0, 10)}.*
`;

  fs.writeFileSync(summaryMdPath, mdContent, "utf8");
  console.log(`[OK] Generated Markdown summary: ${summaryMdPath}`);
}

runAggregation();
