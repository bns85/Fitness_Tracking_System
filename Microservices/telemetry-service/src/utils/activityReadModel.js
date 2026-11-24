function localDayKey(date) {
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

function mergeActivityDays(fitnessDays, workoutDays) {
  const days = new Map();
  const fields = ["totalSteps", "totalDistance", "calories", "veryActiveMinutes", "sedentaryMinutes"];

  function add(record) {
    const key = localDayKey(record.date);
    if (!days.has(key)) {
      days.set(key, {
        date: new Date(key),
        totalSteps: 0,
        totalDistance: 0,
        calories: 0,
        veryActiveMinutes: 0,
        sedentaryMinutes: 0,
      });
    }
    const day = days.get(key);
    fields.forEach((field) => {
      day[field] += Number(record[field]) || 0;
    });
  }

  fitnessDays.forEach(add);
  workoutDays.forEach(add);
  return Array.from(days.values()).sort((a, b) => b.date - a.date).slice(0, 7);
}

function averageField(days, field) {
  if (!days.length) return 0;
  return days.reduce((sum, day) => sum + (Number(day[field]) || 0), 0) / days.length;
}

module.exports = { mergeActivityDays, averageField };
