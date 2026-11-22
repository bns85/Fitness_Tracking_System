const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const {
  InMemoryHub,
  RedisHub,
  createNotificationHub,
} = require("../../src/notifications/NotificationHub");

class MockResponse extends EventEmitter {
  constructor() {
    super();
    this.headers = {};
    this.headersSent = false;
    this.chunks = [];
    this.ended = false;
  }

  setHeader(key, value) {
    this.headers[key] = value;
  }

  flushHeaders() {
    this.headersSent = true;
  }

  write(chunk) {
    this.chunks.push(chunk);
    return true;
  }

  end() {
    this.ended = true;
    this.emit("close");
  }
}

class MockGauge {
  constructor() {
    this.val = 0;
  }
  inc() {
    this.val++;
  }
  dec() {
    this.val--;
  }
}

class MockRedisClient extends EventEmitter {
  constructor() {
    super();
    this.subscribedChannels = [];
    this.publishedMessages = [];
  }

  subscribe(channel, cb) {
    this.subscribedChannels.push(channel);
    if (cb) cb(null);
  }

  unsubscribe(channel) {
    this.subscribedChannels = this.subscribedChannels.filter((c) => c !== channel);
    return Promise.resolve();
  }

  publish(channel, message) {
    this.publishedMessages.push({ channel, message });
    return Promise.resolve(1);
  }

  disconnect() {}
}

describe("NotificationHub - InMemoryHub", () => {
  let gauge;
  let hub;

  beforeEach(() => {
    gauge = new MockGauge();
    hub = new InMemoryHub({ gauge, heartbeatIntervalMs: 50 });
  });

  test("registers client and sets SSE headers and increments gauge", () => {
    const res = new MockResponse();
    hub.register("user-1", res);

    assert.equal(res.headers["Content-Type"], "text/event-stream");
    assert.equal(res.headers["Cache-Control"], "no-cache");
    assert.equal(res.headers["Connection"], "keep-alive");
    assert.equal(res.headers["Access-Control-Allow-Origin"], "*");
    assert.equal(gauge.val, 1);

    hub.close();
  });

  test("publishes notification to registered user", () => {
    const res = new MockResponse();
    hub.register("user-1", res);

    const notification = {
      _id: "notif-1",
      userId: "user-1",
      type: "GOAL_REACHED",
      title: "Goal Reached",
      message: "You did it!",
    };

    const count = hub.publish("user-1", notification, "req-123");
    assert.equal(count, 1);

    const output = res.chunks.join("");
    assert.match(output, /event: notification\n/);
    assert.match(output, /data: .*"title":"Goal Reached"/);

    hub.close();
  });

  test("does not deliver notifications to other users", () => {
    const res = new MockResponse();
    hub.register("user-1", res);

    const notification = {
      _id: "notif-2",
      userId: "user-2",
      type: "GOAL_REACHED",
      title: "Goal Reached",
      message: "For user 2",
    };

    const count = hub.publish("user-2", notification, "req-456");
    assert.equal(count, 0);
    assert.equal(res.chunks.length, 0);

    hub.close();
  });

  test("unregisters client on close and decrements gauge", () => {
    const res = new MockResponse();
    hub.register("user-1", res);
    assert.equal(gauge.val, 1);

    res.end();
    assert.equal(gauge.val, 0);

    const count = hub.publish("user-1", { title: "Test" });
    assert.equal(count, 0);

    hub.close();
  });

  test("sends heartbeat periodically", async () => {
    const res = new MockResponse();
    hub.register("user-1", res);

    await new Promise((resolve) => setTimeout(resolve, 80));
    const output = res.chunks.join("");
    assert.match(output, /: heartbeat\n\n/);

    hub.close();
  });
});

describe("NotificationHub - RedisHub", () => {
  let mockPub;
  let mockSub;
  let gauge;
  let hub;

  beforeEach(() => {
    mockPub = new MockRedisClient();
    mockSub = new MockRedisClient();
    gauge = new MockGauge();
    hub = new RedisHub({
      redisPub: mockPub,
      redisSub: mockSub,
      gauge,
      heartbeatIntervalMs: 50,
    });
  });

  test("subscribes to notifications channel on creation", () => {
    assert.ok(mockSub.subscribedChannels.includes("notifications"));
    hub.close();
  });

  test("publish sends serialized message to Redis channel", async () => {
    const notification = {
      _id: "notif-3",
      userId: "user-3",
      type: "GOAL_REACHED",
      title: "10k steps!",
    };

    await hub.publish("user-3", notification, "req-789");

    assert.equal(mockPub.publishedMessages.length, 1);
    assert.equal(mockPub.publishedMessages[0].channel, "notifications");
    const payload = JSON.parse(mockPub.publishedMessages[0].message);
    assert.equal(payload.userId, "user-3");
    assert.equal(payload.requestId, "req-789");
    assert.equal(payload.notification.title, "10k steps!");

    hub.close();
  });

  test("delivers notification locally when Redis message received", () => {
    const res = new MockResponse();
    hub.register("user-3", res);

    const incomingPayload = JSON.stringify({
      userId: "user-3",
      notification: {
        _id: "notif-4",
        type: "GOAL_REACHED",
        title: "From Redis Sub",
      },
      requestId: "req-abc",
    });

    mockSub.emit("message", "notifications", incomingPayload);

    const output = res.chunks.join("");
    assert.match(output, /event: notification\n/);
    assert.match(output, /"title":"From Redis Sub"/);

    hub.close();
  });
});

describe("createNotificationHub factory", () => {
  test("returns InMemoryHub when no Redis options provided", () => {
    const hub = createNotificationHub({ useRedis: false });
    assert.ok(hub instanceof InMemoryHub);
    hub.close();
  });

  test("returns RedisHub when mock clients provided", () => {
    const mockPub = new MockRedisClient();
    const mockSub = new MockRedisClient();
    const hub = createNotificationHub({ redisPub: mockPub, redisSub: mockSub, useRedis: true });
    assert.ok(hub instanceof RedisHub);
    hub.close();
  });
});
