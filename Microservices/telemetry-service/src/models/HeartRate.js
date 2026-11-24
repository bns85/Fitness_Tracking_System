const mongoose = require("mongoose");

const heartRateSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true },
    timestamp: { type: Date, required: true },
    value: { type: Number, required: true },
  },
  { timestamps: true }
);

heartRateSchema.index({ userId: 1, timestamp: 1 });

module.exports = mongoose.model("HeartRate", heartRateSchema);
