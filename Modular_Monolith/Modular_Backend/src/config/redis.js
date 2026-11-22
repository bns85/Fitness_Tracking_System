const Redis = require("ioredis");
const config = require("./index");

let redis = null;

try {
  redis = new Redis(config.redisUrl, {
    lazyConnect: false,
    retryStrategy(times) {
      if (times > 3) return null;
      return Math.min(times * 200, 2000);
    },
  });

  redis.on("connect", () => {
    if (!config.quiet) console.log("Redis connected");
  });

  redis.on("error", (err) => {
    if (!config.quiet) console.error("Redis error:", err.message);
  });
} catch (err) {
  console.warn("⚠️ Failed to initialize Redis:", err.message);
}

module.exports = redis;
