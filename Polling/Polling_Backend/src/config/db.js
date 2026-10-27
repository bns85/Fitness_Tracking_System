const mongoose = require("mongoose");
const config = require("./index");

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(config.mongodbUri, {
      serverSelectionTimeoutMS: 3000,
      connectTimeoutMS: 3000,
    });
    console.log(`MongoDB connected: ${conn.connection.host}`);
    return true;
  } catch (error) {
    console.warn("MongoDB unavailable:", error.message);
    console.log("Server running with in-memory data mode.");
    return false;
  }
};

module.exports = connectDB;
