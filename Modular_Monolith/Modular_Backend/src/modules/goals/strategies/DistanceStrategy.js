class DistanceStrategy {
  constructor() {
    this.type = "distance";
    this.field = "totalDistance";
    this.unit = "km";
  }

  extractValue(totals) {
    return totals ? Number(totals.totalDistance) || 0 : 0;
  }
}

module.exports = DistanceStrategy;
