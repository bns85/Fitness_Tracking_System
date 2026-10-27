const mongoose = require("mongoose");

const workoutSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
    },
    workoutType: {
      type: String,
      required: true,
      enum: [
        "running",
        "cycling",
        "walking",
        "strength",
        "hiit",
        "yoga",
        "swimming",
        "other",
      ],
      default: "other",
    },
    status: {
      type: String,
      enum: ["in-progress", "paused", "completed"],
      default: "in-progress",
    },
    startTime: { type: Date, default: Date.now },
    endTime: { type: Date },
    pausedAt: { type: Date, default: null },
    pausedMs: { type: Number, default: 0 },
    durationMinutes: { type: Number, default: 0 },
    caloriesBurned: { type: Number, default: 0 },
    steps: { type: Number, default: 0 },
    distanceKm: { type: Number, default: 0 },
    heartRateTotal: { type: Number, default: 0 },
    heartRateCount: { type: Number, default: 0 },
    avgHeartRate: { type: Number, default: 0 },
    maxHeartRate: { type: Number, default: 0 },
    heartRateReadings: [
      {
        value: Number,
        timestamp: { type: Date, default: Date.now },
      },
    ],
    recommendations: { type: [String], default: [] },
  },
  { timestamps: true }
);

workoutSchema.index({ userId: 1, status: 1 });
workoutSchema.index({ userId: 1, startTime: -1 });
workoutSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model("Workout", workoutSchema);
