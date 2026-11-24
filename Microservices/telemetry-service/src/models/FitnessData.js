const mongoose = require("mongoose");

const fitnessDataSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true },
    date: { type: Date, required: true },
    totalSteps: { type: Number, default: 0 },
    totalDistance: { type: Number, default: 0 },
    trackerDistance: { type: Number, default: 0 },
    loggedActivitiesDistance: { type: Number, default: 0 },
    veryActiveDistance: { type: Number, default: 0 },
    moderatelyActiveDistance: { type: Number, default: 0 },
    lightActiveDistance: { type: Number, default: 0 },
    sedentaryActiveDistance: { type: Number, default: 0 },
    veryActiveMinutes: { type: Number, default: 0 },
    fairlyActiveMinutes: { type: Number, default: 0 },
    lightlyActiveMinutes: { type: Number, default: 0 },
    sedentaryMinutes: { type: Number, default: 0 },
    calories: { type: Number, default: 0 },
  },
  { timestamps: true }
);

fitnessDataSchema.index({ userId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model("FitnessData", fitnessDataSchema);
