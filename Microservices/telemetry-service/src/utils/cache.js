const Redis = require("ioredis");

const redis = new Redis(process.env.REDIS_URL, {
  connectTimeout: 10000,
  lazyConnect: false,
  retryStrategy(attempt) {
    if (attempt > 5) return null;
    return Math.min(attempt * 200, 2000);
  },
});

redis.on("error", (error) => {
  if (process.env.QUIET !== "1") {
    console.error(JSON.stringify({
      ts: new Date().toISOString(),
      level: "error",
      service: process.env.SERVICE_NAME || "telemetry",
      variant: process.env.VARIANT || "micro",
      msg: `Redis error: ${error.message}`,
    }));
  }
});

module.exports = {
  async get(key) {
    const value = await redis.get(key);
    return value ? JSON.parse(value) : null;
  },
  async set(key, value) {
    const ttl = Number.parseInt(process.env.CACHE_TTL || "300", 10);
    await redis.set(key, JSON.stringify(value), "EX", ttl);
  },
  async del(key) {
    await redis.del(key);
  },
  close() {
    return redis.quit();
  },
};
