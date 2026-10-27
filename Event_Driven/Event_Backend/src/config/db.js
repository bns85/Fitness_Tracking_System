const mongoose = require("mongoose");
const config = require("./index");

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(config.mongodbUri, {
      serverSelectionTimeoutMS: 3000,
    });
    console.log(`MongoDB connected: ${conn.connection.host}`);
  } catch (error) {
    console.warn("⚠️ MongoDB connection warning:", error.message);
    console.log("ℹ️ Server will continue running with cache/mock data mode.");
  }
};

module.exports = connectDB;
