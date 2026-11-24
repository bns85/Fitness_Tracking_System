const mongoose = require("mongoose");

const workoutContributionSchema = new mongoose.Schema(
  {
    workoutId: { type: String, required: true, unique: true },
    userId: { type: String, required: true },
    date: { type: Date, required: true },
    totalSteps: { type: Number, default: 0 },
    totalDistance: { type: Number, default: 0 },
    calories: { type: Number, default: 0 },
    veryActiveMinutes: { type: Number, default: 0 },
  },
  { timestamps: true }
);

workoutContributionSchema.index({ userId: 1, date: -1 });

module.exports = mongoose.model("WorkoutContribution", workoutContributionSchema);
