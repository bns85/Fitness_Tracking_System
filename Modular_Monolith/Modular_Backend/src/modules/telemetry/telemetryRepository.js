const TelemetryData = require("./models/TelemetryData");

class TelemetryRepository {
  async saveSteps({ userId, steps, calories = 0, distance = 0, date = new Date() }) {
    const today = new Date(date);
    today.setHours(0, 0, 0, 0);

    const stepsNum = Number(steps) || 0;
    const caloriesNum = Number(calories) || 0;
    const distanceNum = Number(distance) || 0;

    return await TelemetryData.findOneAndUpdate(
      { userId, date: { $gte: today } },
      {
        $inc: {
          totalSteps: stepsNum,
          calories: caloriesNum,
          totalDistance: distanceNum,
        },
        $setOnInsert: {
          userId,
          date: new Date(),
          trackerDistance: distanceNum,
          loggedActivitiesDistance: 0,
          veryActiveDistance: 0,
          moderatelyActiveDistance: 0,
          lightActiveDistance: 0,
          sedentaryActiveDistance: 0,
          veryActiveMinutes: 0,
          fairlyActiveMinutes: 0,
          lightlyActiveMinutes: 0,
          sedentaryMinutes: 0,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }

  async incrementActivity(userId, { steps = 0, calories = 0, distance = 0, activeMinutes = 0 }) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return await TelemetryData.findOneAndUpdate(
      { userId, date: { $gte: today } },
      {
        $inc: {
          totalSteps: Number(steps) || 0,
          calories: Number(calories) || 0,
          totalDistance: Number(distance) || 0,
          veryActiveMinutes: Number(activeMinutes) || 0,
        },
        $setOnInsert: {
          userId,
          date: new Date(),
          trackerDistance: Number(distance) || 0,
          loggedActivitiesDistance: 0,
          veryActiveDistance: 0,
          moderatelyActiveDistance: 0,
          lightActiveDistance: 0,
          sedentaryActiveDistance: 0,
          fairlyActiveMinutes: 0,
          lightlyActiveMinutes: 0,
          sedentaryMinutes: 0,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }

  async getLatestActivity(userId) {
    return await TelemetryData.findOne({ userId }).sort({ date: -1 });
  }

  async getWeeklyAverages(userId) {
    const rows = await TelemetryData.aggregate([
      { $match: { userId } },
      { $sort: { date: -1 } },
      { $limit: 7 },
      {
        $group: {
          _id: null,
          avgSteps: { $avg: "$totalSteps" },
          avgCalories: { $avg: "$calories" },
          avgDistance: { $avg: "$totalDistance" },
          avgVeryActiveMinutes: { $avg: "$veryActiveMinutes" },
          avgSedentaryMinutes: { $avg: "$sedentaryMinutes" },
        },
      },
    ]);
    return rows[0] || {};
  }

  async sumActivity(userId, fieldName, bounds) {
    if (!userId || !fieldName) return 0;
    const docs = await TelemetryData.find(
      { userId, date: { $gte: bounds.start, $lt: bounds.end } },
      { [fieldName]: 1 }
    );
    return docs.reduce((sum, doc) => sum + (Number(doc[fieldName]) || 0), 0);
  }

  async activityTotalsByUser(bounds, userId) {
    const match = { date: { $gte: bounds.start, $lt: bounds.end } };
    if (userId) match.userId = userId;
    const rows = await TelemetryData.aggregate([
      { $match: match },
      {
        $group: {
          _id: "$userId",
          totalSteps: { $sum: "$totalSteps" },
          calories: { $sum: "$calories" },
          totalDistance: { $sum: "$totalDistance" },
        },
      },
    ]);
    const map = new Map();
    for (const row of rows) map.set(String(row._id), row);
    return map;
  }
}

module.exports = new TelemetryRepository();
