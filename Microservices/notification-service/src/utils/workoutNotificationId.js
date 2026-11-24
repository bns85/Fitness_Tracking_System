const { createHash } = require("node:crypto");
const mongoose = require("mongoose");

function workoutNotificationId(userId, workoutId) {
  const value = createHash("sha256")
    .update(`${userId}:WORKOUT_COMPLETED:${workoutId}`)
    .digest("hex")
    .slice(0, 24);
  return new mongoose.Types.ObjectId(value);
}

module.exports = workoutNotificationId;
