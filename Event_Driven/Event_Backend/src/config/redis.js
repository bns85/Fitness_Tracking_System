const Redis = require("ioredis");
const config = require("../config");

const redis = new Redis({
  host: config.redis.host,
  port: config.redis.port,
  retryStrategy(times) {
    if (times > 3) return null;
    return Math.min(times * 200, 2000);
  },
});

redis.on("connect", () => console.log("Redis connected"));
redis.on("error", (err) => console.error("Redis error:", err.message));

module.exports = redis;
