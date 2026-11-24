const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { requestJson } = require("../../shared/httpClient");

test("internal client forwards correlation IDs and retries a server error once", async () => {
  const requestIds = [];
  let attempts = 0;
  const server = http.createServer((req, res) => {
    requestIds.push(req.headers["x-request-id"]);
    attempts += 1;
    res.statusCode = attempts === 1 ? 503 : 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();

  try {
    const result = await requestJson(`http://127.0.0.1:${address.port}/internal`, {
      method: "GET",
      from: "goal",
      to: "telemetry",
      requestId: "journey-1",
    });

    assert.deepEqual(result, { ok: true });
    assert.equal(attempts, 2);
    assert.deepEqual(requestIds, ["journey-1", "journey-1"]);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
