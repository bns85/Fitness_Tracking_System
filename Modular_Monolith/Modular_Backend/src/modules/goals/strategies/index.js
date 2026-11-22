const StepsStrategy = require("./StepsStrategy");
const CaloriesStrategy = require("./CaloriesStrategy");
const DistanceStrategy = require("./DistanceStrategy");

const strategies = {
  steps: new StepsStrategy(),
  calories: new CaloriesStrategy(),
  distance: new DistanceStrategy(),
};

function getStrategy(type) {
  return strategies[type] || null;
}

function supportedGoalTypes() {
  return Object.keys(strategies);
}

module.exports = {
  strategies,
  getStrategy,
  supportedGoalTypes,
};
