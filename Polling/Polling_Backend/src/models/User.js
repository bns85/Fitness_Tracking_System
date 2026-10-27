const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    password: { type: String, required: true },
    age: { type: Number },
    weight: { type: Number },
    height: { type: Number },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
