/**
 * ============================================================================
 * SPRINT 2 - STORY 3: MEMBER 3 (SIDDHARTH)
 * WORKOUT DATABASE MODEL & PERSISTENCE TEST SUITE
 * ============================================================================
 * Task: "Create workout Database"
 *
 * Verifies:
 * 1. Workout schema instantiation and validation
 * 2. Session state persistence ('in-progress' -> 'paused' -> 'completed')
 * 3. Live metrics storage (heart rate, calories, duration, steps, distance)
 * 4. Post-workout recommendations persistence
 * 5. Compound database indexes for session lookups and history
 * ============================================================================
 */

const mongoose = require("mongoose");
const config = require("../src/config");
const Workout = require("../src/models/Workout");

const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  magenta: "\x1b[35m",
  blue: "\x1b[34m",
  bright: "\x1b[1m",
};

const TEST_USER = "siddharth_db_test_user";

async function runWorkoutDatabaseTests() {
  console.log(`${colors.bright}${colors.blue}========================================================================${colors.reset}`);
  console.log(`${colors.bright}${colors.magenta} SPRINT 2 - STORY 3 | WORKOUT DATABASE TEST (SIDDHARTH)${colors.reset}`);
  console.log(`${colors.bright} Task: Create workout Database (Mongoose Schema & Indexing)${colors.reset}`);
  console.log(`${colors.bright}${colors.blue}========================================================================${colors.reset}\n`);

  let passed = 0;
  let total = 0;

  try {
    await mongoose.connect(config.mongodbUri);
    console.log(`${colors.green}✓ [DB] Connected to MongoDB (${config.mongodbUri})${colors.reset}`);

    // Clean up test data
    await Workout.deleteMany({ userId: TEST_USER });

    // TEST 1: Create active workout session
    total++;
    console.log(`\n${colors.cyan}[TEST 1] Create active workout session in DB${colors.reset}`);
    const workout = await Workout.create({
      userId: TEST_USER,
      workoutType: "running",
      status: "in-progress",
      startTime: new Date(),
    });

    if (workout && workout.status === "in-progress" && workout.workoutType === "running") {
      console.log(`${colors.green}✓ Active workout persisted with ID: ${workout._id}${colors.reset}`);
      passed++;
    } else {
      console.log(`${colors.red}✗ Failed to persist active workout${colors.reset}`);
    }

    // TEST 2: Ingest live telemetry into database document
    total++;
    console.log(`\n${colors.cyan}[TEST 2] Append live telemetry and heart rate readings${colors.reset}`);
    workout.heartRateReadings.push({ value: 148, timestamp: new Date() });
    workout.heartRateReadings.push({ value: 156, timestamp: new Date() });
    workout.caloriesBurned = 180;
    workout.steps = 2200;
    workout.distanceKm = 1.8;
    workout.heartRateTotal = 304;
    workout.heartRateCount = 2;
    workout.avgHeartRate = 152;
    await workout.save();

    const updated = await Workout.findById(workout._id);
    if (updated.heartRateReadings.length === 2 && updated.caloriesBurned === 180 && updated.avgHeartRate === 152) {
      console.log(`${colors.green}✓ Live metrics successfully stored in Workout document${colors.reset}`);
      passed++;
    } else {
      console.log(`${colors.red}✗ Metrics update failed${colors.reset}`);
    }

    // TEST 3: Pause and Resume session state validation
    total++;
    console.log(`\n${colors.cyan}[TEST 3] State transition: in-progress -> paused -> completed${colors.reset}`);
    updated.status = "paused";
    updated.pausedAt = new Date();
    await updated.save();

    const pausedWorkout = await Workout.findById(workout._id);
    if (pausedWorkout.status === "paused" && pausedWorkout.pausedAt) {
      console.log(`${colors.green}✓ Workout paused state validated${colors.reset}`);
      passed++;
    } else {
      console.log(`${colors.red}✗ Pause transition failed${colors.reset}`);
    }

    // TEST 4: Complete session with recommendations
    total++;
    console.log(`\n${colors.cyan}[TEST 4] Session completion & recommendations persistence${colors.reset}`);
    pausedWorkout.status = "completed";
    pausedWorkout.endTime = new Date();
    pausedWorkout.durationMinutes = 35;
    pausedWorkout.recommendations = [
      "High cardiovascular strain detected. Ensure proper rehydration with electrolytes and prioritize 24h muscle recovery.",
      "Outstanding calorie expenditure! Replenish with balanced carbohydrates and lean protein.",
    ];
    await pausedWorkout.save();

    const completed = await Workout.findById(workout._id);
    if (completed.status === "completed" && completed.recommendations.length === 2) {
      console.log(`${colors.green}✓ Completed workout saved with recommendations${colors.reset}`);
      passed++;
    } else {
      console.log(`${colors.red}✗ Failed to persist completion data${colors.reset}`);
    }

    // TEST 5: Verify compound indexes
    total++;
    console.log(`\n${colors.cyan}[TEST 5] Verify Database Indexes${colors.reset}`);
    const indexes = await Workout.collection.indexes();
    const indexKeys = indexes.map((idx) => Object.keys(idx.key).join("_"));
    const hasStatusIndex = indexKeys.some((k) => k.includes("userId_status"));

    if (hasStatusIndex) {
      console.log(`${colors.green}✓ Compound index { userId: 1, status: 1 } confirmed${colors.reset}`);
      passed++;
    } else {
      console.log(`${colors.red}✗ Compound index missing${colors.reset}`);
    }

    // Clean up test data
    await Workout.deleteMany({ userId: TEST_USER });

    // Summary
    console.log(`\n${colors.bright}========================================================================${colors.reset}`);
    console.log(`${colors.bright} RESULTS: ${passed}/${total} TESTS PASSED${colors.reset}`);
    console.log(`${colors.bright}========================================================================${colors.reset}\n`);

    await mongoose.disconnect();
    process.exit(passed === total ? 0 : 1);
  } catch (error) {
    console.error(`${colors.red}Test error:${colors.reset}`, error.message);
    if (mongoose.connection.readyState === 1) await mongoose.disconnect();
    process.exit(1);
  }
}

runWorkoutDatabaseTests();
