const Goal = require("./models/Goal");

class GoalRepository {
  async create(data) {
    return await Goal.create(data);
  }

  async findById(id) {
    return await Goal.findById(id);
  }

  async findActiveGoal(userId, type, period) {
    return await Goal.findOne({
      userId,
      type,
      period,
      active: { $ne: false },
    });
  }

  async findGoalsForUser(userId) {
    return await Goal.find({ userId, active: { $ne: false } });
  }

  async findActiveGoalsForUser(userId) {
    return await Goal.find({ userId, active: true });
  }

  async updateGoal(id, updates) {
    return await Goal.findByIdAndUpdate(id, updates, { new: true });
  }

  async findUnachievedOrStale(userId, dailyKey, weeklyKey) {
    const filter = {
      ...(userId ? { userId } : {}),
      active: { $ne: false },
      $or: [
        { achieved: false },
        { achievedPeriodKey: { $nin: [dailyKey, weeklyKey] } },
      ],
    };
    return await Goal.find(filter).lean();
  }

  async claimAchieved(goalId, key, current) {
    return await Goal.findOneAndUpdate(
      { _id: goalId, achievedPeriodKey: { $ne: key } },
      {
        $set: {
          achieved: true,
          achievedPeriodKey: key,
          current,
          lastAchievedAt: new Date(),
        },
      },
      { new: true }
    );
  }

  async bulkWrite(ops) {
    if (!ops || ops.length === 0) return;
    return await Goal.bulkWrite(ops, { ordered: false });
  }
}

module.exports = new GoalRepository();
