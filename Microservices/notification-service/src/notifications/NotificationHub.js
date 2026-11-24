const Redis = require("ioredis");
const { logJourneyStep } = require("../../../shared/logger");
const { notificationListeners } = require("../../../shared/metrics");

class NotificationHub {
  constructor({ heartbeatIntervalMs = 30000 } = {}) {
    this.heartbeatIntervalMs = heartbeatIntervalMs;
    this.connections = new Map();
  }

  register(userId, res) {
    if (!userId || !res) throw new Error("userId and response are required");
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.flushHeaders();

    const timer = setInterval(() => res.write(": heartbeat\n\n"), this.heartbeatIntervalMs);
    const connection = { res, timer };
    if (!this.connections.has(userId)) this.connections.set(userId, new Set());
    this.connections.get(userId).add(connection);
    notificationListeners.inc();
    res.on("close", () => this.unregister(userId, res));
  }

  unregister(userId, res) {
    const userConnections = this.connections.get(userId);
    if (!userConnections) return;
    for (const connection of userConnections) {
      if (connection.res === res) {
        clearInterval(connection.timer);
        userConnections.delete(connection);
        notificationListeners.dec();
        break;
      }
    }
    if (userConnections.size === 0) this.connections.delete(userId);
  }

  deliverLocal(userId, notification, requestId) {
    const userConnections = this.connections.get(userId);
    if (!userConnections) return 0;
    let delivered = 0;
    for (const connection of userConnections) {
      try {
        connection.res.write(`event: notification\ndata: ${JSON.stringify(notification)}\n\n`);
        delivered += 1;
        logJourneyStep({
          requestId,
          service: "notification",
          step: "sse_sent",
          userId,
          msg: "Notification sent to SSE client",
        });
      } catch (error) {
        console.error(JSON.stringify({
          ts: new Date().toISOString(),
          level: "error",
          requestId,
          service: "notification",
          variant: "micro",
          userId,
          msg: `SSE write failed: ${error.message}`,
        }));
        this.unregister(userId, connection.res);
      }
    }
    return delivered;
  }

  publish() {
    throw new Error("publish() must be implemented by a NotificationHub adapter");
  }

  close() {
    for (const [userId, connections] of this.connections) {
      for (const connection of Array.from(connections)) {
        this.unregister(userId, connection.res);
        connection.res.end();
      }
    }
  }
}

class InMemoryHub extends NotificationHub {
  async publish(userId, notification, requestId) {
    return this.deliverLocal(userId, notification, requestId);
  }
}

class RedisHub extends NotificationHub {
  constructor(options = {}) {
    super(options);
    const redisUrl = options.redisUrl || process.env.REDIS_URL;
    if (!redisUrl) throw new Error("REDIS_URL must be configured for RedisHub");
    this.channel = options.channel || "notifications";
    this.publisher = options.publisher || new Redis(redisUrl);
    this.subscriber = options.subscriber || new Redis(redisUrl);
    this.subscriber.on("error", (error) => this.logRedisError(error));
    this.publisher.on("error", (error) => this.logRedisError(error));
    this.subscriber.on("message", (channel, rawMessage) => {
      if (channel !== this.channel) return;
      let payload;
      try {
        payload = JSON.parse(rawMessage);
      } catch (error) {
        this.logRedisError(error);
        return;
      }
      this.deliverLocal(payload.userId, payload.notification, payload.requestId);
    });
    this.ready = this.subscriber.subscribe(this.channel);
  }

  logRedisError(error) {
    console.error(JSON.stringify({
      ts: new Date().toISOString(),
      level: "error",
      requestId: null,
      service: "notification",
      variant: "micro",
      msg: `Notification Redis error: ${error.message}`,
    }));
  }

  async publish(userId, notification, requestId) {
    await this.ready;
    return this.publisher.publish(this.channel, JSON.stringify({
      userId,
      notification,
      requestId: requestId || null,
    }));
  }

  async close() {
    super.close();
    await this.subscriber.unsubscribe(this.channel);
    await Promise.all([this.subscriber.quit(), this.publisher.quit()]);
  }
}

function createNotificationHub(options = {}) {
  return options.useRedis === false || (!options.redisUrl && !process.env.REDIS_URL)
    ? new InMemoryHub(options)
    : new RedisHub(options);
}

module.exports = { NotificationHub, InMemoryHub, RedisHub, createNotificationHub };
