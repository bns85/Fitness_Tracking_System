const test = require("node:test");
const assert = require("node:assert/strict");
const {
  periodBounds,
  buildGoalView,
  sortGoalViews,
  GOAL_STRATEGIES,
} = require("../src/utils/periodUtils");

test("daily bounds cover the local calendar day", () => {
  const bounds = periodBounds("daily", new Date(2024, 0, 3, 14, 30));

  assert.equal(bounds.start.getFullYear(), 2024);
  assert.equal(bounds.start.getMonth(), 0);
  assert.equal(bounds.start.getDate(), 3);
  assert.equal(bounds.start.getHours(), 0);
  assert.equal(bounds.end.getDate(), 4);
  assert.equal(bounds.key, "2024-01-03");
});

test("weekly bounds run Monday through the following Monday", () => {
  const bounds = periodBounds("weekly", new Date(2024, 0, 3, 14, 30));

  assert.equal(bounds.start.getDay(), 1);
  assert.equal(bounds.start.getDate(), 1);
  assert.equal(bounds.end.getDay(), 1);
  assert.equal(bounds.end.getDate(), 8);
  assert.equal(bounds.key, "2024-W01");
});

test("goal views report completion and sort active goals first", () => {
  const active = buildGoalView({ _id: "a", type: "steps", target: 100, period: "daily" }, 40);
  const completed = buildGoalView({ _id: "b", type: "calories", target: 50, period: "daily" }, 80);

  assert.equal(completed.status, "completed");
  assert.equal(completed.percentage, 100);
  assert.deepEqual(sortGoalViews([completed, active]), [active, completed]);
});

test("goal strategies read their owned telemetry fields and units", () => {
  assert.equal(GOAL_STRATEGIES.steps.current({ totalSteps: 450 }), 450);
  assert.equal(GOAL_STRATEGIES.calories.current({ calories: 300 }), 300);
  assert.equal(GOAL_STRATEGIES.distance.current({ totalDistance: 2.5 }), 2.5);
  assert.equal(GOAL_STRATEGIES.distance.unit, "km");
});
