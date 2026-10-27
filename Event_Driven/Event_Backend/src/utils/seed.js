const mongoose = require("mongoose");
const config = require("../config");
const User = require("../models/User");
const FitnessData = require("../models/FitnessData");
const Goal = require("../models/Goal");
const Workout = require("../models/Workout");
const Notification = require("../models/Notification");

const seed = async () => {
  try {
    await mongoose.connect(config.mongodbUri);
    console.log("Connected to MongoDB");

    // Clear existing data
    await User.deleteMany({});
    await FitnessData.deleteMany({});
    await Goal.deleteMany({});
    await Workout.deleteMany({});
    await Notification.deleteMany({});

    // Create a test user
    const user = await User.create({
      name: "Sourabha",
      email: "sourabha@test.com",
      password: "password123",
      age: 21,
      weight: 65,
      height: 170,
    });
    console.log(`User created: ${user.name} (${user._id})`);

    // Seed today's fitness data (multiple entries throughout the day)
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const fitnessEntries = [
      {
        userId: user._id,
        date: new Date(today.getTime() + 8 * 3600000), // 8 AM
        steps: 2000,
        heartRate: { current: 85, resting: 62 },
        distance: 1.5,
        caloriesBurned: 100,
        activeCalories: 60,
      },
      {
        userId: user._id,
        date: new Date(today.getTime() + 12 * 3600000), // 12 PM
        steps: 3500,
        heartRate: { current: 110, resting: 62 },
        distance: 2.8,
        caloriesBurned: 250,
        activeCalories: 180,
        workout: {
          type: "Running",
          duration: 30,
          intensity: "medium",
          caloriesBurned: 200,
        },
      },
      {
        userId: user._id,
        date: new Date(today.getTime() + 17 * 3600000), // 5 PM
        steps: 2800,
        heartRate: { current: 95, resting: 62 },
        distance: 2.1,
        caloriesBurned: 150,
        activeCalories: 100,
      },
    ];

    await FitnessData.insertMany(fitnessEntries);
    console.log(`${fitnessEntries.length} fitness entries created`);

    // Seed goals
    const goals = [
      { userId: user._id, type: "steps", target: 10000, current: 0 },
      { userId: user._id, type: "calories", target: 500, current: 0 },
      { userId: user._id, type: "distance", target: 8, current: 0 },
    ];

    await Goal.insertMany(goals);
    console.log(`${goals.length} goals created`);

    // Seed completed workout sessions (Member 3 - Siddharth: Workout Database)
    const workouts = [
      {
        userId: user._id,
        workoutType: "running",
        status: "completed",
        startTime: new Date(today.getTime() - 86400000 + 7 * 3600000), // Yesterday 7:00 AM
        endTime: new Date(today.getTime() - 86400000 + 7.75 * 3600000), // Yesterday 7:45 AM
        durationMinutes: 45,
        caloriesBurned: 420,
        steps: 5400,
        distanceKm: 4.8,
        avgHeartRate: 154,
        maxHeartRate: 172,
        recommendations: [
          "High cardiovascular strain detected. Ensure proper rehydration with electrolytes and prioritize 24h muscle recovery.",
          "Outstanding calorie expenditure! Replenish with balanced carbohydrates and lean protein.",
        ],
      },
      {
        userId: user._id,
        workoutType: "walking",
        status: "completed",
        startTime: new Date(today.getTime() + 9 * 3600000), // Today 9:00 AM
        endTime: new Date(today.getTime() + 9.5 * 3600000), // Today 9:30 AM
        durationMinutes: 30,
        caloriesBurned: 160,
        steps: 3200,
        distanceKm: 2.4,
        avgHeartRate: 125,
        maxHeartRate: 138,
        recommendations: [
          "Optimal aerobic fat-burn zone maintained! Great cardiovascular endurance session.",
        ],
      },
    ];

    await Workout.insertMany(workouts);
    console.log(`${workouts.length} workout records seeded`);

    // Seed a workout notification
    await Notification.create({
      userId: user._id,
      type: "WORKOUT_COMPLETED",
      title: "🏋️ Workout Completed!",
      message: "Finished 45m running (420 kcal, avg HR 154 bpm). Check your recommendations!",
      read: false,
    });
    console.log("Workout completion notification seeded");

    console.log(`\nSeeding complete! Use userId: ${user._id}`);
    console.log(`Test endpoint: GET /api/dashboard/${user._id}`);

    process.exit(0);
  } catch (error) {
    console.error("Seed error:", error);
    process.exit(1);
  }
};

seed();
