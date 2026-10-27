const mongoose = require("mongoose");

const weightSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true },
    date: { type: Date, required: true },
    weightKg: { type: Number },
    weightPounds: { type: Number },
    fat: { type: Number },
    bmi: { type: Number },
    isManualReport: { type: Boolean, default: true },
    logId: { type: String },
  },
  { timestamps: true }
);

weightSchema.index({ userId: 1, date: 1 });

module.exports = mongoose.model("Weight", weightSchema);
