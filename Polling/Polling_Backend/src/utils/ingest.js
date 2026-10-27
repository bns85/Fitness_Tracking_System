const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");
const mongoose = require("mongoose");
const config = require("../config");
const FitnessData = require("../models/FitnessData");
const HeartRate = require("../models/HeartRate");
const Sleep = require("../models/Sleep");
const Weight = require("../models/Weight");

const DATA_DIR = path.join(
  "C:\\Users\\soura\\OneDrive\\Desktop\\archive\\mturkfitbit_export_4.12.16-5.12.16\\Fitabase Data 4.12.16-5.12.16"
);

function parseDate(dateStr) {
  const parts = dateStr.split("/");
  const month = parseInt(parts[0]) - 1;
  const day = parseInt(parts[1]);
  const yearParts = parts[2].split(" ");
  const year = parseInt(yearParts[0]);
  return new Date(year, month, day);
}

function parseDateTime(dateStr) {
  return new Date(dateStr);
}

async function ingestDailyActivity() {
  return new Promise((resolve, reject) => {
    const results = [];
    console.log("Ingesting dailyActivity_merged.csv...");
    fs.createReadStream(path.join(DATA_DIR, "dailyActivity_merged.csv"))
      .pipe(csv())
      .on("data", (row) => {
        results.push({
          userId: row.Id,
          date: parseDate(row.ActivityDate),
          totalSteps: parseInt(row.TotalSteps) || 0,
          totalDistance: parseFloat(row.TotalDistance) || 0,
          trackerDistance: parseFloat(row.TrackerDistance) || 0,
          loggedActivitiesDistance: parseFloat(row.LoggedActivitiesDistance) || 0,
          veryActiveDistance: parseFloat(row.VeryActiveDistance) || 0,
          moderatelyActiveDistance: parseFloat(row.ModeratelyActiveDistance) || 0,
          lightActiveDistance: parseFloat(row.LightActiveDistance) || 0,
          sedentaryActiveDistance: parseFloat(row.SedentaryActiveDistance) || 0,
          veryActiveMinutes: parseInt(row.VeryActiveMinutes) || 0,
          fairlyActiveMinutes: parseInt(row.FairlyActiveMinutes) || 0,
          lightlyActiveMinutes: parseInt(row.LightlyActiveMinutes) || 0,
          sedentaryMinutes: parseInt(row.SedentaryMinutes) || 0,
          calories: parseInt(row.Calories) || 0,
        });
      })
      .on("end", async () => {
        try {
          const bulkOps = results.map((r) => ({
            updateOne: {
              filter: { userId: r.userId, date: r.date },
              update: { $set: r },
              upsert: true,
            },
          }));
          await FitnessData.bulkWrite(bulkOps);
          console.log(`  -> ${results.length} daily activity records imported`);
          resolve(results.length);
        } catch (err) {
          reject(err);
        }
      })
      .on("error", reject);
  });
}

async function ingestHeartRate() {
  return new Promise((resolve, reject) => {
    const results = [];
    let count = 0;
    console.log("Ingesting heartrate_seconds_merged.csv...");
    fs.createReadStream(path.join(DATA_DIR, "heartrate_seconds_merged.csv"))
      .pipe(csv())
      .on("data", (row) => {
        results.push({
          userId: row.Id,
          timestamp: parseDateTime(row.Time),
          value: parseInt(row.Value) || 0,
        });
        count++;
        if (count % 100000 === 0) console.log(`  -> ${count} heart rate records read...`);
      })
      .on("end", async () => {
        try {
          for (let i = 0; i < results.length; i += 5000) {
            const batch = results.slice(i, i + 5000);
            await HeartRate.insertMany(batch, { ordered: false }).catch(() => {});
          }
          console.log(`  -> ${results.length} heart rate records imported`);
          resolve(results.length);
        } catch (err) {
          reject(err);
        }
      })
      .on("error", reject);
  });
}

async function ingestSleep() {
  return new Promise((resolve, reject) => {
    const results = [];
    console.log("Ingesting sleepDay_merged.csv...");
    fs.createReadStream(path.join(DATA_DIR, "sleepDay_merged.csv"))
      .pipe(csv())
      .on("data", (row) => {
        results.push({
          userId: row.Id,
          date: parseDate(row.SleepDay),
          totalSleepRecords: parseInt(row.TotalSleepRecords) || 1,
          totalMinutesAsleep: parseInt(row.TotalMinutesAsleep) || 0,
          totalTimeInBed: parseInt(row.TotalTimeInBed) || 0,
        });
      })
      .on("end", async () => {
        try {
          const bulkOps = results.map((r) => ({
            updateOne: {
              filter: { userId: r.userId, date: r.date },
              update: { $set: r },
              upsert: true,
            },
          }));
          await Sleep.bulkWrite(bulkOps);
          console.log(`  -> ${results.length} sleep records imported`);
          resolve(results.length);
        } catch (err) {
          reject(err);
        }
      })
      .on("error", reject);
  });
}

async function ingestWeight() {
  return new Promise((resolve, reject) => {
    const results = [];
    console.log("Ingesting weightLogInfo_merged.csv...");
    fs.createReadStream(path.join(DATA_DIR, "weightLogInfo_merged.csv"))
      .pipe(csv())
      .on("data", (row) => {
        results.push({
          userId: row.Id,
          date: parseDateTime(row.Date),
          weightKg: parseFloat(row.WeightKg) || null,
          weightPounds: parseFloat(row.WeightPounds) || null,
          fat: row.Fat ? parseInt(row.Fat) : null,
          bmi: parseFloat(row.BMI) || null,
          isManualReport: row.IsManualReport === "True",
          logId: row.LogId,
        });
      })
      .on("end", async () => {
        try {
          await Weight.insertMany(results);
          console.log(`  -> ${results.length} weight records imported`);
          resolve(results.length);
        } catch (err) {
          reject(err);
        }
      })
      .on("error", reject);
  });
}

async function ingest() {
  try {
    await mongoose.connect(config.mongodbUri);
    console.log("Connected to MongoDB\n");

    await FitnessData.deleteMany({});
    await HeartRate.deleteMany({});
    await Sleep.deleteMany({});
    await Weight.deleteMany({});
    console.log("Cleared existing data\n");

    const dailyCount = await ingestDailyActivity();
    const hrCount = await ingestHeartRate();
    const sleepCount = await ingestSleep();
    const weightCount = await ingestWeight();

    console.log("\n--- Ingestion Summary ---");
    console.log(`Daily Activity: ${dailyCount} records`);
    console.log(`Heart Rate:     ${hrCount} records`);
    console.log(`Sleep:          ${sleepCount} records`);
    console.log(`Weight:         ${weightCount} records`);
    console.log("-------------------------\n");
    console.log("Ingestion complete! (Polling architecture - no event bus)");

    process.exit(0);
  } catch (error) {
    console.error("Ingestion error:", error);
    process.exit(1);
  }
}

ingest();
