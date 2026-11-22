class CaloriesStrategy {
  constructor() {
    this.type = "calories";
    this.field = "calories";
    this.unit = "calories";
  }

  extractValue(totals) {
    return totals ? Number(totals.calories) || 0 : 0;
  }
}

module.exports = CaloriesStrategy;
