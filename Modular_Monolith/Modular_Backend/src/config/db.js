const mongoose = require("mongoose");
const config = require("./index");

mongoose.set("bufferTimeoutMS", 2000);

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(config.mongoUri, {
      serverSelectionTimeoutMS: 3000,
    });
    if (!config.quiet) {
      console.log(`MongoDB connected: ${conn.connection.host}`);
    }
  } catch (error) {
    console.warn("⚠️ MongoDB connection warning:", error.message);
    if (!config.quiet) {
      console.log("ℹ️ Server will continue running in degraded mode.");
    }
  }
};

module.exports = connectDB;
