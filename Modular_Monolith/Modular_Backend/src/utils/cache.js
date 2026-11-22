const redis = require("../config/redis");
const config = require("../config");

const inMemoryCache = new Map();

const cache = {
  async get(key) {
    if (redis) {
      try {
        const data = await redis.get(key);
        if (data) return JSON.parse(data);
      } catch (e) {
        // Fallback to in-memory
      }
    }
    const item = inMemoryCache.get(key);
    if (item && item.expiry > Date.now()) {
      return item.value;
    }
    return null;
  },

  async set(key, value, ttl = config.cacheTTL) {
    if (redis) {
      try {
        await redis.set(key, JSON.stringify(value), "EX", ttl);
      } catch (e) {
        // Fallback to in-memory
      }
    }
    inMemoryCache.set(key, {
      value,
      expiry: Date.now() + ttl * 1000,
    });
  },

  async del(key) {
    if (redis) {
      try {
        await redis.del(key);
      } catch (e) {}
    }
    inMemoryCache.delete(key);
  },

  async delPattern(pattern) {
    if (redis) {
      try {
        const keys = await redis.keys(pattern);
        if (keys.length > 0) await redis.del(...keys);
      } catch (e) {}
    }
  },
};

module.exports = cache;
