const mongoose = require("mongoose");
const Workout = require("./models/Workout");

const ACTIVE_STATUSES = ["in-progress", "paused"];

class WorkoutRepository {
  constructor() {
    this.memoryWorkouts = new Map();
  }

  isDbReady() {
    return mongoose.connection && mongoose.connection.readyState === 1;
  }

  async findActiveByUserId(userId) {
    if (this.isDbReady()) {
      return await Workout.findOne({
        userId,
        status: { $in: ACTIVE_STATUSES },
      });
    }
    for (const w of this.memoryWorkouts.values()) {
      if (w.userId === userId && ACTIVE_STATUSES.includes(w.status)) return w;
    }
    return null;
  }

  async findActiveByIdOrUser(userId, workoutId, status) {
    if (this.isDbReady()) {
      const query = { userId };
      if (status) {
        query.status = status;
      } else {
        query.status = { $in: ACTIVE_STATUSES };
      }
      if (workoutId) query._id = workoutId;
      return await Workout.findOne(query);
    }
    for (const w of this.memoryWorkouts.values()) {
      if (w.userId === userId) {
        if (workoutId && String(w._id) !== String(workoutId)) continue;
        if (status && w.status !== status) continue;
        if (!status && !ACTIVE_STATUSES.includes(w.status)) continue;
        return w;
      }
    }
    return null;
  }

  async create(data) {
    if (this.isDbReady()) {
      return await Workout.create(data);
    }
    const doc = {
      _id: new mongoose.Types.ObjectId(),
      status: "in-progress",
      startTime: new Date(),
      pausedAt: null,
      pausedMs: 0,
      durationMinutes: 0,
      caloriesBurned: 0,
      steps: 0,
      distanceKm: 0,
      heartRateTotal: 0,
      heartRateCount: 0,
      avgHeartRate: 0,
      maxHeartRate: 0,
      heartRateReadings: [],
      recommendations: [],
      ...data,
      save: async function () {
        return this;
      },
    };
    this.memoryWorkouts.set(String(doc._id), doc);
    return doc;
  }

  async findById(id) {
    if (this.isDbReady()) {
      return await Workout.findById(id);
    }
    return this.memoryWorkouts.get(String(id)) || null;
  }

  async findHistory(userId, limit = 20) {
    if (this.isDbReady()) {
      return await Workout.find({ userId })
        .sort({ startTime: -1 })
        .limit(Math.min(limit, 100));
    }
    const list = Array.from(this.memoryWorkouts.values()).filter(
      (w) => w.userId === userId
    );
    return list.slice(0, limit);
  }

  async findRecentCompleted(userId, limit = 5) {
    if (this.isDbReady()) {
      return await Workout.find({ userId, status: "completed" })
        .sort({ endTime: -1 })
        .limit(limit);
    }
    const list = Array.from(this.memoryWorkouts.values()).filter(
      (w) => w.userId === userId && w.status === "completed"
    );
    return list.slice(0, limit);
  }
}

module.exports = new WorkoutRepository();
