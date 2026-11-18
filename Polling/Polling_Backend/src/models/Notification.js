const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
    },

    type: {
      type: String,
      required: true,
      enum: ["GOAL_REACHED", "WORKOUT_COMPLETED", "INACTIVITY"],
    },

    title: {
      type: String,
      required: true,
    },

    message: {
      type: String,
      required: true,
    },

    read: {
      type: Boolean,
      default: false,
    },

    // Optional goal correlation fields used for GOAL_REACHED de-duplication
    // (one notification per goal per goal period)
    goalId: {
      type: String,
    },

    periodKey: {
      type: String,
    },
  },
  { timestamps: true }
);

notificationSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model("Notification", notificationSchema);