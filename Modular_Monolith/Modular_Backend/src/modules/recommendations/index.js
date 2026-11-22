const cache = require("../../utils/cache");

/**
 * Rule-based recommendation engine matching Event-Driven rules.
 */
function buildRecommendations({
  avgHeartRate = 0,
  caloriesBurned = 0,
  durationMinutes = 0,
}) {
  const recommendations = [];

  if (avgHeartRate >= 150) {
    recommendations.push(
      "High cardiovascular strain detected. Ensure proper rehydration with electrolytes and prioritize 24h muscle recovery."
    );
  } else if (avgHeartRate >= 120) {
    recommendations.push(
      "Optimal aerobic fat-burn zone maintained! Great cardiovascular endurance session."
    );
  }

  if (caloriesBurned >= 400) {
    recommendations.push(
      "Outstanding calorie expenditure! Replenish with balanced carbohydrates and lean protein."
    );
  }

  if (durationMinutes > 0 && durationMinutes < 15) {
    recommendations.push(
      "Quick burst session completed. Consider extending tomorrow's routine to 30 minutes for endurance building."
    );
  }

  if (recommendations.length === 0) {
    recommendations.push(
      "Solid session logged. Keep a consistent pace tomorrow to build on today's progress."
    );
  }

  return recommendations;
}

async function getWorkoutRecommendations({
  workoutId,
  avgHeartRate = 0,
  caloriesBurned = 0,
  durationMinutes = 0,
}) {
  const cacheKey = `recommendation:${workoutId}`;
  const cached = await cache.get(cacheKey);
  if (cached) return cached;

  const recs = buildRecommendations({
    avgHeartRate,
    caloriesBurned,
    durationMinutes,
  });

  await cache.set(cacheKey, recs);
  return recs;
}

module.exports = {
  buildRecommendations,
  getWorkoutRecommendations,
};
