const mongoose = require("mongoose");
const config = require("../config");
const Goal = require("../models/Goal");

const seedGoals = async () => {
  try {
    await mongoose.connect(config.mongodbUri);
    console.log("Connected to MongoDB");

    await Goal.deleteMany({});
    console.log("Cleared existing goals");

    // Add goals for the test user
    const goals = await Goal.insertMany([
      { userId: "1503960366", type: "steps", target: 10000 },
      { userId: "1503960366", type: "calories", target: 2000 },
      { userId: "1503960366", type: "distance", target: 8 },
    ]);

    console.log(`Created ${goals.length} goals for user 1503960366`);
    process.exit(0);
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
};

seedGoals();
