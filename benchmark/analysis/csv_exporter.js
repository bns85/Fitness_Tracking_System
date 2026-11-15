/**
 * CSV exporter — publishes the CSV result files to Prometheus.
 *
 * The CSV files in benchmark/results/ are the single source of truth for the
 * report. This exporter reads them on every scrape and exposes each numeric
 * cell as a gauge, so Grafana can show exactly the same numbers as the CSV.
 *
 * Metric per cell:
 *   csv_result{metric="<column>", exp="<exp>", run="<run_label>",
 *              variant="<variant>", users="<users>"} <value>
 * Plus:
 *   csv_runs_info{runs="run1,run2,run3"} <number of runs>
 *
 * Rules:
 *   - only files named *-levels.csv directly under benchmark/results/
 *   - any path containing "_invalid" is skipped
 *   - only rows with loadgen_version = v2-openloop are used (old runs are wrong)
 *   - non-numeric cells (empty, text) are skipped
 *
 * No dependencies. Start:  node benchmark/analysis/csv_exporter.js
 * Metrics:                 http://localhost:9101/metrics
 */
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = parseInt(process.env.PORT || "9101", 10);
const RESULTS_DIR = process.env.RESULTS_DIR || path.join(__dirname, "..", "results");
const REQUIRED_VERSION = "v2-openloop";

function escapeLabelValue(v) {
  return String(v)
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/"/g, '\\"');
}

function isNumeric(v) {
  if (v === null || v === undefined || v === "") return false;
  return Number.isFinite(Number(v));
}

function listCsvFiles() {
  if (!fs.existsSync(RESULTS_DIR)) return [];
  return fs
    .readdirSync(RESULTS_DIR)
    .filter((name) => name.endsWith("-levels.csv"))
    .map((name) => path.join(RESULTS_DIR, name))
    .filter((file) => !file.includes("_invalid"))
    .sort();
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) return [];
  const header = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    const row = {};
    header.forEach((col, i) => (row[col] = cells[i] !== undefined ? cells[i] : ""));
    return row;
  });
}

// Re-reads every CSV and returns the Prometheus text for /metrics.
function buildMetrics() {
  const series = new Map(); // key = full label set, so one scrape never has duplicates
  const runs = new Set();
  const files = listCsvFiles();

  for (const file of files) {
    let rows;
    try {
      rows = parseCsv(fs.readFileSync(file, "utf8"));
    } catch (err) {
      console.error(`[csv_exporter] cannot read ${file}: ${err.message}`);
      continue;
    }
    for (const row of rows) {
      if (row.loadgen_version !== REQUIRED_VERSION) continue; // old runs must never appear
      const run = row.run_label || "";
      const exp = row.exp || "";
      const variant = row.variant || "";
      const users = row.users || "";
      runs.add(run);

      for (const [column, raw] of Object.entries(row)) {
        if (!isNumeric(raw)) continue; // text columns (exp, variant, ...) are labels only
        const labels =
          `metric="${escapeLabelValue(column)}",` +
          `exp="${escapeLabelValue(exp)}",` +
          `run="${escapeLabelValue(run)}",` +
          `variant="${escapeLabelValue(variant)}",` +
          `users="${escapeLabelValue(users)}"`;
        series.set(labels, Number(raw));
      }
    }
  }

  const out = [];
  out.push("# HELP csv_result One numeric cell from a benchmark/results/*-levels.csv file.");
  out.push("# TYPE csv_result gauge");
  for (const [labels, value] of series) {
    out.push(`csv_result{${labels}} ${value}`);
  }

  const runList = [...runs].filter((r) => r).sort().join(",");
  out.push("# HELP csv_runs_info Runs found in the CSV files (value = run count).");
  out.push("# TYPE csv_runs_info gauge");
  out.push(`csv_runs_info{runs="${escapeLabelValue(runList)}"} ${runs.size}`);

  return out.join("\n") + "\n";
}

const server = http.createServer((req, res) => {
  if (req.url === "/metrics") {
    res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    res.end(buildMetrics());
  } else {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("CSV exporter — metrics at /metrics\n");
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[csv_exporter] reading ${RESULTS_DIR} on every scrape`);
  console.log(`[csv_exporter] http://localhost:${PORT}/metrics`);
});
