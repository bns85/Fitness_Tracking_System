const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { app } = require("../src/server");

describe("Modular Monolith Scaffold Server Endpoints", () => {
  let server;
  let port;

  before(async () => {
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        port = server.address().port;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  function get(path) {
    return new Promise((resolve, reject) => {
      http
        .get(`http://127.0.0.1:${port}${path}`, (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            resolve({
              statusCode: res.statusCode,
              headers: res.headers,
              body: data,
            });
          });
        })
        .on("error", reject);
    });
  }

  test("GET /health returns 200 with ok status", async () => {
    const res = await get("/health");
    assert.equal(res.statusCode, 200);
    const json = JSON.parse(res.body);
    assert.equal(json.status, "ok");
    assert.ok(json.timestamp);
    assert.ok(res.headers["x-request-id"]);
  });

  test("GET /metrics returns 200 and prometheus metrics text", async () => {
    const res = await get("/metrics");
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /http_request_duration_seconds/);
  });

  test("GET /api/meta returns agreed modular-monolith payload", async () => {
    const res = await get("/api/meta");
    assert.equal(res.statusCode, 200);
    const json = JSON.parse(res.body);
    assert.equal(json.name, "PulseFlow");
    assert.equal(json.style, "modular-monolith");
    assert.equal(json.variant, "modular");
    assert.equal(json.version, "1.0.0");
  });
});
