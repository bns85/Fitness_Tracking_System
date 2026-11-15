#!/usr/bin/env node
"use strict";
// check_panels.js — run every query of the Grafana dashboard against Prometheus
// for a time window and print OK / EMPTY / ERROR for each panel and query.
//
// Usage:
//   node benchmark/analysis/check_panels.js <start-ISO> <end-ISO>
//   node benchmark/analysis/check_panels.js --last 30m
//
// Exit code 0 only when there are no ERROR panels and the only EMPTY panels
// are the cAdvisor ones (cAdvisor is Linux only and always empty here).
const fs = require("fs");
const path = require("path");

const PROM = process.env.PROM_URL || "http://localhost:9090";
const DASH = path.join(__dirname, "..", "grafana", "dashboards", "event-vs-polling.json");
const STEP = 15; // seconds between points, as asked

function usage(code) {
  console.error("Usage: node benchmark/analysis/check_panels.js <start-ISO> <end-ISO>");
  console.error("       node benchmark/analysis/check_panels.js --last 30m");
  process.exit(code);
}

// "30m", "45s", "1h30m" -> seconds. Returns null when it cannot parse.
function parseDuration(s) {
  if (!/^(?:\d+[smh])+$/.test(s)) return null;
  let sec = 0;
  for (const m of s.matchAll(/(\d+)([smh])/g)) {
    sec += Number(m[1]) * (m[2] === "s" ? 1 : m[2] === "m" ? 60 : 3600);
  }
  return sec;
}

function humanDuration(sec) {
  if (sec % 3600 === 0) return `${sec / 3600}h`;
  if (sec % 60 === 0) return `${sec / 60}m`;
  return `${sec}s`;
}

function parseArgs(argv) {
  if (argv[0] === "--last") {
    if (argv.length !== 2) usage(2);
    const sec = parseDuration(argv[1]);
    if (sec === null || sec <= 0) {
      console.error(`bad duration: ${argv[1]} (examples: 30m, 45s, 1h30m)`);
      usage(2);
    }
    const end = Date.now();
    return { startMs: end - sec * 1000, endMs: end };
  }
  if (argv.length !== 2) usage(2);
  const startMs = Date.parse(argv[0]);
  const endMs = Date.parse(argv[1]);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    console.error(`bad ISO time: ${Number.isNaN(startMs) ? argv[0] : argv[1]}`);
    usage(2);
  }
  if (startMs >= endMs) {
    console.error("start must be before end");
    usage(2);
  }
  return { startMs, endMs };
}

// Replace Grafana/dashboard variables with sensible concrete values.
function makeVarMap(dashboard, startMs, endMs) {
  const map = {
    $run: "run1",
    $__range: humanDuration(Math.round((endMs - startMs) / 1000)),
    $__rate_interval: "1m",
  };
  for (const v of (dashboard.templating && dashboard.templating.list) || []) {
    if (!v.name) continue;
    const cur = v.current;
    const val = cur && (cur.value !== undefined ? cur.value : cur.text);
    if (val !== undefined && val !== null && !Array.isArray(val)) map[`$${v.name}`] = String(val);
  }
  return map;
}

function substitute(expr, map) {
  // Longest names first so $x never eats a prefix of a longer name.
  const names = Object.keys(map).sort((a, b) => b.length - a.length);
  let out = expr;
  for (const name of names) {
    out = out.split(name).join(map[name]);
  }
  return out;
}

async function queryRange(expr, startMs, endMs) {
  const url = new URL(`${PROM}/api/v1/query_range`);
  url.search = new URLSearchParams({
    query: expr,
    start: String(startMs / 1000),
    end: String(endMs / 1000),
    step: String(STEP),
  }).toString();
  let body;
  try {
    const res = await fetch(url);
    body = await res.json();
  } catch (e) {
    return { status: "ERROR", detail: `request failed: ${e.message}` };
  }
  if (!body || body.status !== "success") {
    const detail = body
      ? body.error || body.errorType || "unknown Prometheus error"
      : "no response";
    return { status: "ERROR", detail: String(detail).slice(0, 200) };
  }
  const series = (body.data && body.data.result) || [];
  const hasPoints = series.some((s) => (s.values && s.values.length > 0) || (s.value && s.value.length > 0));
  return { status: hasPoints ? "OK" : "EMPTY", points: series.length };
}

function shortExpr(s) {
  const flat = String(s).replace(/\s+/g, " ").trim();
  return flat.length > 110 ? `${flat.slice(0, 107)}...` : flat;
}

async function main() {
  const { startMs, endMs } = parseArgs(process.argv.slice(2));
  let dashboard;
  try {
    dashboard = JSON.parse(fs.readFileSync(DASH, "utf8"));
  } catch (e) {
    console.error(`cannot read dashboard ${DASH}: ${e.message}`);
    process.exit(2);
  }
  const map = makeVarMap(dashboard, startMs, endMs);

  console.log(`dashboard : ${dashboard.title || DASH}`);
  console.log(`window    : ${new Date(startMs).toISOString()} -> ${new Date(endMs).toISOString()} (step ${STEP}s)`);
  console.log(`prometheus: ${PROM}`);
  console.log("");

  const tally = { OK: 0, EMPTY: 0, ERROR: 0, SKIP: 0 };
  const emptyTitles = [];
  const errorTitles = [];

  for (const panel of dashboard.panels || []) {
    const targets = (panel.targets || []).filter((t) => t && t.expr);
    if (targets.length === 0) {
      tally.SKIP += 1; // row / text panels have nothing to query
      continue;
    }
    const results = await Promise.all(
      targets.map((t) => queryRange(substitute(t.expr, map), startMs, endMs))
    );
    let panelStatus = "OK";
    if (results.some((r) => r.status === "ERROR")) panelStatus = "ERROR";
    else if (!results.some((r) => r.status === "OK")) panelStatus = "EMPTY";
    tally[panelStatus] += 1;
    if (panelStatus === "EMPTY") emptyTitles.push(panel.title || `id ${panel.id}`);
    if (panelStatus === "ERROR") errorTitles.push(panel.title || `id ${panel.id}`);

    const nOk = results.filter((r) => r.status === "OK").length;
    console.log(
      `${panelStatus.padEnd(5)} #${String(panel.id).padStart(2)} ${panel.title || "(no title)"} (${nOk}/${results.length} queries OK)`
    );
    results.forEach((r, i) => {
      const label = r.status === "ERROR" ? `  ERROR ${r.detail}` : `  ${r.status}`;
      console.log(`${label}  ${shortExpr(targets[i].expr)}`);
    });
  }

  const onlyCadvisorEmpty =
    errorTitles.length === 0 && emptyTitles.every((t) => t.toLowerCase().includes("cadvisor"));
  const skipped = tally.SKIP;
  console.log("");
  console.log(
    `Summary: ${tally.OK} OK, ${tally.EMPTY} EMPTY, ${tally.ERROR} ERROR panels` +
      (skipped ? ` (${skipped} row/text panels without queries skipped)` : "")
  );
  if (emptyTitles.length) console.log(`EMPTY panels: ${emptyTitles.join(" | ")}`);
  if (errorTitles.length) console.log(`ERROR panels: ${errorTitles.join(" | ")}`);
  const pass = tally.ERROR === 0 && onlyCadvisorEmpty;
  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL (only cAdvisor panels may be EMPTY and no ERROR panels allowed)");
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
