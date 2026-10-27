require("dotenv").config();

module.exports = {
  port: process.env.PORT || 5002,
  mongodbUri: process.env.MONGODB_URI || "mongodb://localhost:27017/fitness_tracker",
  redis: {
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT) || 6379,
  },
  cacheTTL: parseInt(process.env.CACHE_TTL) || 30,
  pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS) || 5000,
};
