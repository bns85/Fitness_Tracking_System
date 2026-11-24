const test = require("node:test");
const assert = require("node:assert/strict");
const { buildRecommendations, getRecommendations } = require("../src/services/recommendations");

test("recommendations cover high strain, calorie, and short-session rules", () => {
  const recommendations = buildRecommendations({
    avgHeartRate: 155,
    caloriesBurned: 450,
    durationMinutes: 10,
  });

  assert.equal(recommendations.length, 3);
  assert.match(recommendations[0], /High cardiovascular strain/);
  assert.match(recommendations[1], /Outstanding calorie expenditure/);
  assert.match(recommendations[2], /Quick burst session/);
});

test("recommendations are cached for CACHE_TTL seconds", async () => {
  const writes = [];
  const client = {
    async get() { return null; },
    async set(...args) { writes.push(args); },
  };
  const recommendations = await getRecommendations({
    avgHeartRate: 80,
    caloriesBurned: 10,
    durationMinutes: 30,
  }, client);

  assert.equal(recommendations.length, 1);
  assert.equal(writes.length, 1);
  assert.equal(writes[0][2], "EX");
  assert.equal(writes[0][3], 300);
});

test("recommendation cache failures are logged and do not prevent rule evaluation", async () => {
  const previousError = console.error;
  const logs = [];
  console.error = (line) => logs.push(JSON.parse(line));
  try {
    const recommendations = await getRecommendations(
      { avgHeartRate: 80, caloriesBurned: 10, durationMinutes: 30 },
      { async get() { throw new Error("Redis unavailable"); } }
    );
    assert.equal(recommendations.length, 1);
    assert.match(logs[0].msg, /Redis unavailable/);
  } finally {
    console.error = previousError;
  }
});
