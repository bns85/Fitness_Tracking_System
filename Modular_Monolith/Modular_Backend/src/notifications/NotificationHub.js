const { logJourneyStep } = require("../utils/logger");
const config = require("../config");

let Redis = null;
function getRedisClass() {
  if (!Redis) {
    try {
      Redis = require("ioredis");
    } catch (e) {
      // ioredis might not be installed in pure unit-test environment
    }
  }
  return Redis;
}

let notificationListenersGauge = null;
try {
  const metrics = require("../metrics");
  notificationListenersGauge = metrics.notificationListeners;
} catch (e) {
  // Metrics optional during isolated unit testing
}

/**
 * Base NotificationHub (Adapter interface)
 */
class NotificationHub {
  constructor(options = {}) {
    this.variant = options.variant || config.variant || "modular";
    this.serviceName = options.serviceName || config.serviceName || "app";
    this.heartbeatIntervalMs = options.heartbeatIntervalMs || 30000;
    this.gauge =
      options.gauge !== undefined ? options.gauge : notificationListenersGauge;

    // Map: userId -> Set of connection objects: { res, timer }
    this.connections = new Map();
  }

  /**
   * Register an SSE response connection for a user.
   *
   * @param {string} userId
   * @param {import("http").ServerResponse} res
   */
  register(userId, res) {
    if (!userId || !res) return;

    // Send SSE response headers if not already sent
    if (!res.headersSent) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("Access-Control-Allow-Origin", "*");
      if (typeof res.flushHeaders === "function") {
        res.flushHeaders();
      }
    }

    if (!config.quiet) {
      console.log(`📡 [SSE] Client connected for user ${userId}`);
    }

    if (this.gauge) {
      try {
        this.gauge.inc();
      } catch (_) {}
    }

    // Heartbeat every 30 seconds
    const timer = setInterval(() => {
      try {
        res.write(": heartbeat\n\n");
      } catch (err) {
        this.unregister(userId, res);
      }
    }, this.heartbeatIntervalMs);

    const connectionRecord = { res, timer };

    if (!this.connections.has(userId)) {
      this.connections.set(userId, new Set());
    }
    this.connections.get(userId).add(connectionRecord);

    // Auto-cleanup on client close
    const onClose = () => {
      this.unregister(userId, res);
    };

    res.on("close", onClose);
    res.on("finish", onClose);
  }

  /**
   * Unregister an SSE response connection for a user.
   *
   * @param {string} userId
   * @param {import("http").ServerResponse} res
   */
  unregister(userId, res) {
    if (!userId || !this.connections.has(userId)) return;

    const userConns = this.connections.get(userId);
    for (const record of userConns) {
      if (record.res === res) {
        clearInterval(record.timer);
        userConns.delete(record);

        if (!config.quiet) {
          console.log(`🔌 [SSE] Client disconnected for user ${userId}`);
        }

        if (this.gauge) {
          try {
            this.gauge.dec();
          } catch (_) {}
        }
        break;
      }
    }

    if (userConns.size === 0) {
      this.connections.delete(userId);
    }
  }

  /**
   * Deliver notification to local SSE connections for userId.
   *
   * @param {string} userId
   * @param {Object} notification
   * @param {string} [requestId]
   */
  deliverLocal(userId, notification, requestId) {
    if (!userId || !this.connections.has(userId)) return 0;

    const userConns = this.connections.get(userId);
    let deliveredCount = 0;

    for (const record of userConns) {
      try {
        record.res.write("event: notification\n");
        record.res.write(`data: ${JSON.stringify(notification)}\n\n`);
        deliveredCount++;

        logJourneyStep({
          level: "info",
          requestId: requestId || null,
          service: this.serviceName,
          variant: this.variant,
          step: "sse_sent",
          userId,
          msg: "Notification pushed to client via SSE",
        });
      } catch (err) {
        this.unregister(userId, record.res);
      }
    }

    return deliveredCount;
  }

  /**
   * Abstract publish method — overridden by subclasses.
   */
  publish(userId, notification, requestId) {
    throw new Error("publish() must be implemented by adapter");
  }

  /**
   * Close hub and clear all connections/timers.
   */
  close() {
    for (const [userId, userConns] of this.connections.entries()) {
      for (const record of userConns) {
        clearInterval(record.timer);
        try {
          record.res.end();
        } catch (_) {}
      }
    }
    this.connections.clear();
  }
}

/**
 * InMemoryHub Adapter: local process-only delivery.
 */
class InMemoryHub extends NotificationHub {
  constructor(options = {}) {
    super(options);
  }

  publish(userId, notification, requestId) {
    return this.deliverLocal(userId, notification, requestId);
  }
}

/**
 * RedisHub Adapter: fan-out across replicas via Redis Pub/Sub.
 */
class RedisHub extends NotificationHub {
  constructor(options = {}) {
    super(options);
    this.channel = options.channel || "notifications";
    this.ownsClients = false;

    if (options.redisPub && options.redisSub) {
      this.redisPub = options.redisPub;
      this.redisSub = options.redisSub;
    } else {
      const RedisClass = options.redisClass || getRedisClass();
      if (!RedisClass) {
        throw new Error("ioredis is required for RedisHub when redisPub/redisSub are not injected");
      }
      const redisUrl = options.redisUrl || config.redisUrl;
      this.redisPub = new RedisClass(redisUrl, {
        lazyConnect: false,
        retryStrategy(times) {
          if (times > 3) return null;
          return Math.min(times * 200, 2000);
        },
      });
      this.redisSub = new RedisClass(redisUrl, {
        lazyConnect: false,
        retryStrategy(times) {
          if (times > 3) return null;
          return Math.min(times * 200, 2000);
        },
      });
      this.ownsClients = true;
    }

    this._setupSubscription();
  }

  _setupSubscription() {
    this.redisSub.subscribe(this.channel, (err) => {
      if (err && !config.quiet) {
        console.error(`⚠️ RedisHub subscription error on channel ${this.channel}:`, err.message);
      }
    });

    this.redisSub.on("message", (channel, message) => {
      if (channel !== this.channel) return;
      try {
        const parsed = JSON.parse(message);
        const { userId, notification, requestId } = parsed;
        this.deliverLocal(userId, notification, requestId);
      } catch (err) {
        if (!config.quiet) {
          console.error("⚠️ RedisHub failed to parse notification message:", err.message);
        }
      }
    });
  }

  async publish(userId, notification, requestId) {
    const payload = JSON.stringify({ userId, notification, requestId: requestId || null });
    try {
      if (this.redisPub && typeof this.redisPub.publish === "function") {
        await this.redisPub.publish(this.channel, payload);
      } else {
        // Fallback to local delivery if publisher unavailable
        this.deliverLocal(userId, notification, requestId);
      }
    } catch (err) {
      if (!config.quiet) {
        console.warn("⚠️ RedisHub publish failed, falling back to local delivery:", err.message);
      }
      this.deliverLocal(userId, notification, requestId);
    }
  }

  async close() {
    super.close();
    if (this.ownsClients) {
      try {
        await this.redisSub.unsubscribe(this.channel);
        this.redisSub.disconnect();
        this.redisPub.disconnect();
      } catch (_) {}
    }
  }
}

/**
 * Factory to create appropriate NotificationHub adapter based on configuration.
 *
 * @param {Object} options
 * @returns {NotificationHub}
 */
function createNotificationHub(options = {}) {
  const useRedis = options.useRedis || options.redisUrl || options.redisPub || process.env.REDIS_URL || process.env.REDIS_HOST;
  if (useRedis) {
    return new RedisHub(options);
  }
  return new InMemoryHub(options);
}

module.exports = {
  NotificationHub,
  InMemoryHub,
  RedisHub,
  createNotificationHub,
};
