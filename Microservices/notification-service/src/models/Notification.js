const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true },
    type: {
      type: String,
      required: true,
      enum: ["GOAL_REACHED", "WORKOUT_COMPLETED", "INACTIVITY"],
    },
    title: { type: String, required: true },
    message: { type: String, required: true },
    read: { type: Boolean, default: false },
    goalId: { type: String },
    periodKey: { type: String },
  },
  { timestamps: true }
);

notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index(
  { userId: 1, type: 1, goalId: 1, periodKey: 1 },
  {
    unique: true,
    partialFilterExpression: {
      type: "GOAL_REACHED",
      goalId: { $exists: true },
      periodKey: { $exists: true },
    },
  }
);

module.exports = mongoose.model("Notification", notificationSchema);
