const mongoose = require("mongoose");
const FitnessData = require("../models/FitnessData");
const Sleep = require("../models/Sleep");
const Weight = require("../models/Weight");
const cache = require("../utils/cache");

// Import memStore from dashboard controller for shared in-memory state
const { memStore } = require("./dashboardController");

// In-memory active walk sessions
const activeWalks = new Map();

function isDBConnected() {
  return mongoose.connection.readyState === 1;
}

function todayStart() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

const logSleep = async (req, res) => {
  try {
    const { userId } = req.params;
    const { minutesAsleep, timeInBed } = req.body;

    if (!minutesAsleep || minutesAsleep <= 0) {
      return res.status(400).json({ error: "minutesAsleep is required and must be > 0" });
    }

    const today = todayStart();

    if (isDBConnected()) {
      await Sleep.findOneAndUpdate(
        { userId, date: today },
        {
          totalMinutesAsleep: minutesAsleep,
          totalTimeInBed: timeInBed || minutesAsleep + 15,
          totalSleepRecords: 1,
        },
        { upsert: true, new: true }
      );
    } else {
      // In-memory: replace existing for today
      memStore.sleep = memStore.sleep.filter(
        (s) => !(s.userId === userId && new Date(s.date).getTime() >= today.getTime())
      );
      memStore.sleep.unshift({
        userId,
        date: today,
        totalMinutesAsleep: minutesAsleep,
        totalTimeInBed: timeInBed || minutesAsleep + 15,
      });
    }

    await cache.del(`dashboard:${userId}`);

    console.log(`[POLL] Sleep logged for ${userId}: ${minutesAsleep}min`);
    res.json({ success: true, data: { userId, minutesAsleep } });
  } catch (error) {
    console.error("Log sleep error:", error);
    res.status(500).json({ error: "Failed to log sleep" });
  }
};

const startWalk = async (req, res) => {
  try {
    const { userId } = req.params;

    if (activeWalks.has(userId)) {
      return res.status(400).json({ error: "Walk already in progress. Stop it first." });
    }

    activeWalks.set(userId, { startTime: new Date() });

    console.log(`[POLL] Walk started for ${userId}`);
    res.json({ success: true, message: "Walk started", startTime: new Date().toISOString() });
  } catch (error) {
    console.error("Start walk error:", error);
    res.status(500).json({ error: "Failed to start walk" });
  }
};

const stopWalk = async (req, res) => {
  try {
    const { userId } = req.params;

    const walkSession = activeWalks.get(userId);
    if (!walkSession) {
      return res.status(400).json({ error: "No active walk session found" });
    }

    const durationMs = Date.now() - walkSession.startTime.getTime();
    const durationMinutes = Math.max(1, Math.round(durationMs / 60000));
    const steps = Math.round(durationMinutes * 100);
    const distance = Math.round((steps * 0.0008) * 100) / 100;
    const caloriesBurned = Math.round(steps * 0.04);

    const today = todayStart();

    if (isDBConnected()) {
      await FitnessData.findOneAndUpdate(
        { userId, date: today },
        {
          $inc: {
            totalSteps: steps,
            totalDistance: distance,
            calories: caloriesBurned,
            veryActiveMinutes: durationMinutes,
          },
          $setOnInsert: { userId, date: today },
        },
        { upsert: true, new: true }
      );
    } else {
      // In-memory: add or update today's entry
      let entry = memStore.fitnessData.find(
        (e) => e.userId === userId && new Date(e.date).getTime() >= today.getTime()
      );
      if (entry) {
        entry.totalSteps += steps;
        entry.totalDistance += distance;
        entry.calories += caloriesBurned;
        entry.veryActiveMinutes += durationMinutes;
      } else {
        memStore.fitnessData.unshift({
          userId,
          date: new Date(),
          totalSteps: steps,
          totalDistance: distance,
          calories: caloriesBurned,
          veryActiveMinutes: durationMinutes,
          sedentaryMinutes: 0,
        });
      }
    }

    activeWalks.delete(userId);
    await cache.del(`dashboard:${userId}`);

    console.log(`[POLL] Walk stopped for ${userId}: ${durationMinutes}min -> ${steps} steps, ${distance}km`);
    res.json({
      success: true,
      message: "Walk logged",
      summary: { steps, durationMinutes, distance, caloriesBurned },
    });
  } catch (error) {
    console.error("Stop walk error:", error);
    res.status(500).json({ error: "Failed to stop walk" });
  }
};

const logCalories = async (req, res) => {
  try {
    const { userId } = req.params;
    const { calories } = req.body;

    if (!calories || calories <= 0) {
      return res.status(400).json({ error: "calories is required and must be > 0" });
    }

    const today = todayStart();

    if (isDBConnected()) {
      await FitnessData.findOneAndUpdate(
        { userId, date: today },
        { $inc: { calories }, $setOnInsert: { userId, date: today } },
        { upsert: true, new: true }
      );
    } else {
      let entry = memStore.fitnessData.find(
        (e) => e.userId === userId && new Date(e.date).getTime() >= today.getTime()
      );
      if (entry) {
        entry.calories += calories;
      } else {
        memStore.fitnessData.unshift({
          userId, date: new Date(), totalSteps: 0, totalDistance: 0,
          calories, veryActiveMinutes: 0, sedentaryMinutes: 0,
        });
      }
    }

    await cache.del(`dashboard:${userId}`);
    console.log(`[POLL] Calories logged for ${userId}: +${calories}kcal`);
    res.json({ success: true, data: { userId, calories } });
  } catch (error) {
    console.error("Log calories error:", error);
    res.status(500).json({ error: "Failed to log calories" });
  }
};

const logWeight = async (req, res) => {
  try {
    const { userId } = req.params;
    const { weightKg, bmi } = req.body;

    if (!weightKg || weightKg <= 0) {
      return res.status(400).json({ error: "weightKg is required and must be > 0" });
    }

    const today = todayStart();

    if (isDBConnected()) {
      await Weight.findOneAndUpdate(
        { userId, date: today },
        {
          weightKg,
          weightPounds: Math.round(weightKg * 2.20462 * 100) / 100,
          bmi: bmi || null,
          isManualReport: true,
        },
        { upsert: true, new: true }
      );
    } else {
      memStore.weight = memStore.weight.filter(
        (w) => !(w.userId === userId && new Date(w.date).getTime() >= today.getTime())
      );
      memStore.weight.unshift({
        userId, date: new Date(), weightKg,
        weightPounds: Math.round(weightKg * 2.20462 * 100) / 100,
        bmi: bmi || null, isManualReport: true,
      });
    }

    await cache.del(`dashboard:${userId}`);
    console.log(`[POLL] Weight logged for ${userId}: ${weightKg}kg`);
    res.json({ success: true, data: { userId, weightKg } });
  } catch (error) {
    console.error("Log weight error:", error);
    res.status(500).json({ error: "Failed to log weight" });
  }
};

const getActiveWalk = async (req, res) => {
  try {
    const { userId } = req.params;
    const walkSession = activeWalks.get(userId);

    if (!walkSession) {
      return res.json({ active: false });
    }

    const elapsed = Math.round((Date.now() - walkSession.startTime.getTime()) / 60000);
    res.json({
      active: true,
      startTime: walkSession.startTime,
      elapsedMinutes: elapsed,
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to get walk status" });
  }
};

module.exports = { logSleep, startWalk, stopWalk, logCalories, logWeight, getActiveWalk };
