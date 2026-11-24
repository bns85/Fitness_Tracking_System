const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { InMemoryHub } = require("../src/notifications/NotificationHub");

class MockResponse extends EventEmitter {
  constructor() {
    super();
    this.headers = {};
    this.writes = [];
  }

  setHeader(name, value) {
    this.headers[name] = value;
  }

  flushHeaders() {}

  write(value) {
    this.writes.push(value);
  }

  end() {
    this.emit("close");
  }
}

test("in-memory adapter publishes the contract SSE event to the matching user", async () => {
  const hub = new InMemoryHub({ heartbeatIntervalMs: 60000 });
  const response = new MockResponse();
  const notification = { _id: "n1", userId: "user-1", type: "GOAL_REACHED" };

  hub.register("user-1", response);
  await hub.publish("user-1", notification, "request-1");

  assert.equal(response.headers["Content-Type"], "text/event-stream");
  assert.equal(response.writes.join(""), `event: notification\ndata: ${JSON.stringify(notification)}\n\n`);
  assert.equal(hub.connections.get("user-1").size, 1);

  hub.close();
  assert.equal(hub.connections.size, 0);
});
