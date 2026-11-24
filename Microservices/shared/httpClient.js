const http = require("node:http");
const https = require("node:https");
const { downstreamCallDuration } = require("./metrics");

class DownstreamError extends Error {
  constructor(message, statusCode, responseBody) {
    super(message);
    this.name = "DownstreamError";
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}

function sendOnce(url, { method, body, requestId, timeoutMs, from, to }) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const transport = target.protocol === "https:" ? https : http;
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const headers = {
      Accept: "application/json",
      "X-Request-Id": requestId,
    };
    if (payload) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = String(payload.length);
    }

    const startedAt = process.hrtime.bigint();
    const request = transport.request(target, {
      method,
      headers,
      agent: false,
      timeout: timeoutMs,
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        downstreamCallDuration.observe({
          from,
          to,
          variant: process.env.VARIANT || "micro",
        }, Number(process.hrtime.bigint() - startedAt) / 1e9);
        const text = Buffer.concat(chunks).toString("utf8");
        let responseBody = text;
        try {
          responseBody = text ? JSON.parse(text) : null;
        } catch (_) {
          responseBody = text;
        }

        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new DownstreamError(
            `HTTP ${response.statusCode} from ${to}`,
            response.statusCode,
            responseBody
          ));
          return;
        }
        resolve(responseBody);
      });
    });

    request.on("timeout", () => request.destroy(new Error(`Timed out calling ${to}`)));
    request.on("error", (error) => {
      downstreamCallDuration.observe({
        from,
        to,
        variant: process.env.VARIANT || "micro",
      }, Number(process.hrtime.bigint() - startedAt) / 1e9);
      reject(error);
    });
    if (payload) request.write(payload);
    request.end();
  });
}

async function requestJson(url, options) {
  const retriesValue = Number.parseInt(process.env.DOWNSTREAM_RETRIES || "1", 10);
  const timeoutValue = Number.parseInt(process.env.DOWNSTREAM_TIMEOUT_MS || "1000", 10);
  const retries = Number.isFinite(retriesValue) && retriesValue >= 0 ? retriesValue : 1;
  const timeoutMs = Number.isFinite(timeoutValue) && timeoutValue > 0 ? timeoutValue : 1000;
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await sendOnce(url, { ...options, timeoutMs });
    } catch (error) {
      lastError = error;
      if (error instanceof DownstreamError && error.statusCode < 500) throw error;
    }
  }
  throw lastError;
}

module.exports = { requestJson, DownstreamError };
