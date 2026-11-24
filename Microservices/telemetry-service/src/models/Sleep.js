const mongoose = require("mongoose");

const sleepSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true },
    date: { type: Date, required: true },
    totalSleepRecords: { type: Number, default: 1 },
    totalMinutesAsleep: { type: Number, default: 0 },
    totalTimeInBed: { type: Number, default: 0 },
  },
  { timestamps: true }
);

sleepSchema.index({ userId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model("Sleep", sleepSchema);
