class StepsStrategy {
  constructor() {
    this.type = "steps";
    this.field = "totalSteps";
    this.unit = "steps";
  }

  extractValue(totals) {
    return totals ? Number(totals.totalSteps) || 0 : 0;
  }
}

module.exports = StepsStrategy;
