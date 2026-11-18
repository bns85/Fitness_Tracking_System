const mongoose = require("mongoose");

const goalSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      required: true,
      enum: ["steps", "calories", "distance", "workouts"],
    },
    target: { type: Number, required: true },
    current: { type: Number, default: 0 },
    period: { type: String, enum: ["daily", "weekly"], default: "daily" },
    startDate: { type: Date, default: Date.now },
    endDate: { type: Date },
    achieved: { type: Boolean, default: false },
    achievedPeriodKey: { type: String, default: null },
    lastAchievedAt: { type: Date },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

goalSchema.index({ userId: 1, achieved: 1 });
goalSchema.index({ userId: 1, type: 1, period: 1 });

module.exports = mongoose.model("Goal", goalSchema);
