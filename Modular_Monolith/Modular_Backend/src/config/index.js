try {
  require("dotenv").config();
} catch (_) {}

module.exports = {
  port: parseInt(process.env.PORT, 10) || 5011,
  mongoUri:
    process.env.MONGO_URI ||
    process.env.MONGODB_URI ||
    "mongodb://127.0.0.1:27017/fitness_modular",
  redisUrl:
    process.env.REDIS_URL ||
    (process.env.REDIS_HOST
      ? `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT || 6379}`
      : "redis://127.0.0.1:6379"),
  cacheTTL: parseInt(process.env.CACHE_TTL, 10) || 300,
  quiet: process.env.QUIET === "1",
  variant: process.env.VARIANT || "modular",
  serviceName: process.env.SERVICE_NAME || "app",
  goalCpuMs:
    process.env.GOAL_CPU_MS !== undefined
      ? parseInt(process.env.GOAL_CPU_MS, 10)
      : 10,
  faultNotifications: process.env.FAULT_NOTIFICATIONS === "1",
};
