const test = require("node:test");
const assert = require("node:assert/strict");
const { mergeActivityDays, averageField } = require("../src/utils/activityReadModel");

test("dashboard activity merges workout totals into their local fitness day", () => {
  const day = new Date(2026, 10, 24, 16);
  const merged = mergeActivityDays(
    [{ date: day, totalSteps: 100, totalDistance: 1.5, calories: 40, veryActiveMinutes: 5 }],
    [{ date: new Date(2026, 10, 24, 19), totalSteps: 20, totalDistance: 0.5, calories: 10, veryActiveMinutes: 8 }]
  );

  assert.equal(merged.length, 1);
  assert.equal(merged[0].totalSteps, 120);
  assert.equal(merged[0].totalDistance, 2);
  assert.equal(merged[0].calories, 50);
  assert.equal(merged[0].veryActiveMinutes, 13);
});

test("dashboard averages use the merged days", () => {
  const days = mergeActivityDays(
    [
      { date: new Date(2026, 10, 24), totalSteps: 100 },
      { date: new Date(2026, 10, 23), totalSteps: 300 },
    ],
    [{ date: new Date(2026, 10, 24, 18), totalSteps: 100 }]
  );

  assert.equal(averageField(days, "totalSteps"), 250);
});
