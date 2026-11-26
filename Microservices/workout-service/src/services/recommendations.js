const Redis = require("ioredis");

const redis = process.env.REDIS_URL
  ? new Redis(process.env.REDIS_URL, {
      connectTimeout: 10000,
      lazyConnect: false,
      retryStrategy(attempt) {
        if (attempt > 5) return null;
        return Math.min(attempt * 200, 2000);
      },
    })
  : null;

if (redis) {
  redis.on("error", (error) => {
    if (process.env.QUIET !== "1") {
      console.error(JSON.stringify({
        ts: new Date().toISOString(),
        level: "error",
        service: process.env.SERVICE_NAME || "workout",
        variant: process.env.VARIANT || "micro",
        msg: `Redis error: ${error.message}`,
      }));
    }
  });
}

function buildRecommendations({ avgHeartRate = 0, caloriesBurned = 0, durationMinutes = 0 }) {
  const recommendations = [];
  if (avgHeartRate >= 150) {
    recommendations.push("High cardiovascular strain detected. Ensure proper rehydration with electrolytes and prioritize 24h muscle recovery.");
  } else if (avgHeartRate >= 120) {
    recommendations.push("Optimal aerobic fat-burn zone maintained! Great cardiovascular endurance session.");
  }
  if (caloriesBurned >= 400) {
    recommendations.push("Outstanding calorie expenditure! Replenish with balanced carbohydrates and lean protein.");
  }
  if (durationMinutes > 0 && durationMinutes < 15) {
    recommendations.push("Quick burst session completed. Consider extending tomorrow's routine to 30 minutes for endurance building.");
  }
  if (recommendations.length === 0) {
    recommendations.push("Solid session logged. Keep a consistent pace tomorrow to build on today's progress.");
  }
  return recommendations;
}

async function getRecommendations(input, client = redis) {
  if (!client) throw new Error("REDIS_URL must be configured for recommendation caching");
  const key = `recommendations:${input.avgHeartRate || 0}:${input.caloriesBurned || 0}:${input.durationMinutes || 0}`;
  let cached;
  try {
    cached = await client.get(key);
  } catch (error) {
    logCacheFailure(error);
    return buildRecommendations(input);
  }
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (error) {
      logCacheFailure(error);
    }
  }

  const recommendations = buildRecommendations(input);
  const configuredTtl = Number.parseInt(process.env.CACHE_TTL || "300", 10);
  const ttl = Number.isFinite(configuredTtl) && configuredTtl > 0 ? configuredTtl : 300;
  try {
    await client.set(key, JSON.stringify(recommendations), "EX", ttl);
  } catch (error) {
    logCacheFailure(error);
  }
  return recommendations;
}

function logCacheFailure(error) {
  console.error(JSON.stringify({
    ts: new Date().toISOString(),
    level: "error",
    service: process.env.SERVICE_NAME || "workout",
    variant: process.env.VARIANT || "micro",
    msg: `Recommendation cache failed: ${error.message}`,
  }));
}

async function closeRedis() {
  if (redis && redis.status !== "end") await redis.quit();
}

module.exports = { buildRecommendations, getRecommendations, closeRedis };
