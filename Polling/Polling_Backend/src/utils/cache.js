const redis = require("../config/redis");
const config = require("../config");

// Pure polling-based cache: no event-driven invalidation.
// Data is fetched on demand and expires after TTL.
// The frontend polls at a fixed interval to stay updated.

const inMemoryCache = new Map();

const cache = {
  async get(key) {
    try {
      const data = await redis.get(key);
      if (data) return JSON.parse(data);
    } catch (e) {
      // Fallback to in-memory
    }
    const item = inMemoryCache.get(key);
    if (item && item.expiry > Date.now()) {
      return item.value;
    }
    return null;
  },

  async set(key, value, ttl = config.cacheTTL) {
    try {
      await redis.set(key, JSON.stringify(value), "EX", ttl);
    } catch (e) {
      // Fallback to in-memory
    }
    inMemoryCache.set(key, {
      value,
      expiry: Date.now() + ttl * 1000,
    });
  },

  async del(key) {
    try {
      await redis.del(key);
    } catch (e) {}
    inMemoryCache.delete(key);
  },

  async flushAll() {
    try {
      await redis.flushall();
    } catch (e) {}
    inMemoryCache.clear();
  },
};

module.exports = cache;
