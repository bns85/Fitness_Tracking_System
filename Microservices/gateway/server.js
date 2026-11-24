const express = require("express");
const cors = require("cors");
const path = require("node:path");
const http = require("node:http");
const https = require("node:https");
const { requestIdMiddleware } = require("../shared/requestId");
const { register, metricsMiddleware } = require("../shared/metrics");

const app = express();
const PORT = Number.parseInt(process.env.PORT || "5021", 10);
const FRONTEND_DIR = process.env.FRONTEND_DIR || "/Frontend_Shared";
const SERVICES = {
  telemetry: { host: "telemetry-service", port: 5022 },
  goal: { host: "goal-service", port: 5023 },
  notification: { host: "notification-service", port: 5024 },
  workout: { host: "workout-service", port: 5025 },
};

function serviceForPath(pathname) {
  const pathWithoutApi = pathname.startsWith("/api/") ? pathname.slice(4) : pathname;
  if (pathWithoutApi === "/telemetry" || pathWithoutApi.startsWith("/telemetry/")) return SERVICES.telemetry;
  if (pathWithoutApi === "/dashboard" || pathWithoutApi.startsWith("/dashboard/")) return SERVICES.telemetry;
  if (pathWithoutApi === "/goals" || pathWithoutApi.startsWith("/goals/")) return SERVICES.goal;
  if (pathWithoutApi === "/notifications" || pathWithoutApi.startsWith("/notifications/")) return SERVICES.notification;
  if (pathWithoutApi === "/workout" || pathWithoutApi.startsWith("/workout/")) return SERVICES.workout;
  return null;
}

app.use(requestIdMiddleware);
app.use(cors());
app.use(metricsMiddleware);

app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.get("/api/meta", (_req, res) => {
  res.json({
    name: "PulseFlow",
    version: "1.0.0",
    style: "microservices",
    variant: "micro",
  });
});

app.get("/metrics", async (_req, res) => {
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
});

app.use(express.static(FRONTEND_DIR));

app.get("/", (_req, res, next) => {
  res.sendFile(path.join(FRONTEND_DIR, "index.html"), (error) => {
    if (error) next(error);
  });
});

app.use((req, res) => {
  const targetService = serviceForPath(new URL(req.originalUrl, "http://gateway").pathname);
  if (!targetService) {
    res.status(404).send(`<!DOCTYPE html><html><body><pre>Cannot ${req.method} ${req.path}</pre></body></html>`);
    return;
  }

  const protocol = req.protocol === "https" ? https : http;
  const upstream = protocol.request({
    hostname: targetService.host,
    port: targetService.port,
    method: req.method,
    path: req.originalUrl,
    headers: {
      ...req.headers,
      host: `${targetService.host}:${targetService.port}`,
      "x-request-id": req.requestId,
    },
    agent: false,
  }, (upstreamResponse) => {
    const headers = { ...upstreamResponse.headers, "x-request-id": req.requestId };
    delete headers.connection;
    delete headers["keep-alive"];
    res.writeHead(upstreamResponse.statusCode || 502, headers);
    upstreamResponse.pipe(res);
  });

  res.on("close", () => {
    if (!res.writableEnded) upstream.destroy();
  });
  upstream.on("error", (error) => {
    if (res.headersSent) {
      res.destroy(error);
      return;
    }
    res.status(502).json({ success: false, message: "Upstream service unavailable" });
  });
  req.pipe(upstream);
});

app.listen(PORT, "0.0.0.0", () => {
  if (process.env.QUIET !== "1") console.log(`Gateway listening on ${PORT}`);
});
