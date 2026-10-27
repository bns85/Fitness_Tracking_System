const API_BASE = "http://localhost:5001/api";
const RING_LENGTH = 546.64;

const $ = (id) => document.getElementById(id);
const formatNumber = (value) => new Intl.NumberFormat("en-US").format(Math.round(Number(value) || 0));
const formatDate = (date) => {
  if (!date) return "Today";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(date));
};
const formatSleep = (minutes) => `${Math.floor((minutes || 0) / 60)}h ${String(Math.round((minutes || 0) % 60)).padStart(2, "0")}m`;
const formatNotificationDate = (date) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(date));

function setProgress(current, target) {
  const percent = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
  $("goal-ring").style.strokeDashoffset = RING_LENGTH - (RING_LENGTH * percent) / 100;
  $("goal-percent").textContent = `${percent}%`;
  $("steps-value").textContent = formatNumber(current);
  $("steps-target").textContent = formatNumber(target);
  $("steps-left").textContent = formatNumber(Math.max(0, target - current));
  $("goal-message").textContent = percent >= 100 ? "You reached your daily target." : percent >= 70 ? "You are nearly there. Keep moving." : "Your next walk is waiting.";
}

function renderGoals(goals) {
  $("goal-count").textContent = `${goals.length} ${goals.length === 1 ? "goal" : "goals"}`;
  if (!goals.length) {
    $("goals-list").innerHTML = '<div class="empty-goals">No active goals found for this user.</div>';
    return;
  }
  $("goals-list").innerHTML = goals.map((goal) => {
    const percent = Math.min(100, Math.max(0, Number(goal.percentage) || 0));
    const icon = goal.type === "steps" ? "⌁" : goal.type === "calories" ? "✦" : "➚";
    return `<div class="goal-row"><span class="goal-row-icon">${icon}</span><div><span class="goal-row-label">${goal.type}</span><div class="goal-row-bar"><span style="width:${percent}%"></span></div></div><span class="goal-row-percent">${percent}%</span></div>`;
  }).join("");
}

function renderDashboard(payload) {
  const data = payload.data || {};
  const activity = data.latestActivity || {};
  const averages = data.weeklyAverages || {};
  const stepsGoal = (data.goals || []).find((goal) => goal.type === "steps") || { target: 10000, current: activity.steps || 0 };
  const calories = activity.activeCalories ?? activity.calories ?? 0;

  setProgress(activity.steps || stepsGoal.current || 0, stepsGoal.target || 10000);
  $("metric-steps").textContent = formatNumber(activity.steps);
  $("metric-calories").textContent = formatNumber(calories);
  $("metric-distance").textContent = (Number(activity.distance) || 0).toFixed(2);
  $("activity-date").textContent = formatDate(activity.date);
  $("average-steps").textContent = formatNumber(averages.steps);
  $("active-minutes").textContent = formatNumber(averages.activeMinutes);
  $("sleep-hours").textContent = formatSleep((data.sleep || {}).avgMinutesAsleep);
  $("updated-label").textContent = payload.source === "cache" ? "Updated from cache" : "Updated just now";
  $("sync-label").textContent = payload.source === "cache" ? "Fast cached sync" : "Live data synced";
  renderGoals(data.goals || []);
}

function renderNotifications(notifications) {
  const unread = notifications.filter((notification) => !notification.read).length;
  $("notification-count").textContent = unread;
  $("notification-count").hidden = unread === 0;
  $("notification-label").textContent = unread ? `${unread} unread` : "All caught up";
  $("notifications-list").innerHTML = notifications.length
    ? notifications.map((notification) => `<article class="notification-item ${notification.read ? "" : "unread"}"><strong>${notification.title}</strong><p>${notification.message}</p><time>${formatNotificationDate(notification.createdAt)}</time></article>`).join("")
    : '<p class="notification-empty">No notifications for this user.</p>';
}

async function loadNotifications() {
  const userId = $("user-id").value.trim();
  if (!userId) return;
  try {
    const response = await fetch(`${API_BASE}/notifications/${encodeURIComponent(userId)}`);
    if (!response.ok) throw new Error("Notification request failed");
    const payload = await response.json();
    renderNotifications(payload.notifications || []);
  } catch (requestError) {
    $("notification-label").textContent = "Unavailable";
    $("notifications-list").innerHTML = '<p class="notification-empty">Notifications could not be loaded.</p>';
  }
}

async function loadDashboard() {
  const userId = $("user-id").value.trim();
  if (!userId) return;
  const statusDot = document.querySelector(".status-dot");
  const error = $("error-message");
  statusDot.classList.remove("error");
  $("sync-label").textContent = "Syncing latest data";
  error.textContent = "";
  try {
    const response = await fetch(`${API_BASE}/dashboard/${encodeURIComponent(userId)}`);
    if (!response.ok) throw new Error(`Request failed (${response.status})`);
    renderDashboard(await response.json());
  } catch (requestError) {
    statusDot.classList.add("error");
    $("sync-label").textContent = "Could not sync data";
    $("updated-label").textContent = "API unavailable";
    error.textContent = `Could not load dashboard data. Make sure the backend is running on port 5001.`;
  }
}

$("refresh-button").addEventListener("click", loadDashboard);
$("user-id").addEventListener("change", () => { loadDashboard(); loadNotifications(); });
$("notification-button").addEventListener("click", () => {
  const popover = $("notification-popover");
  popover.hidden = !popover.hidden;
  $("notification-button").setAttribute("aria-expanded", String(!popover.hidden));
  if (!popover.hidden) loadNotifications();
});
loadDashboard();
loadNotifications();

// ============================================================
// Workout session (Sprint 2 - Story 3) — Event-Driven flow
// ============================================================
let activeWorkout = null;
let activeWorkoutId = null;
let liveInterval = null;
let durationInterval = null;

const WORKOUT_ZONES = {
  running: [145, 168], cycling: [128, 152], walking: [95, 115], strength: [120, 142],
  hiit: [150, 172], yoga: [75, 95], swimming: [125, 148], other: [110, 132],
};
const CALORIES_PER_TICK = { running: 7, cycling: 6, walking: 3, strength: 5, hiit: 8, yoga: 2, swimming: 6, other: 4 };
const STEPS_PER_TICK = { running: 32, walking: 28, hiit: 24, other: 0 };

const currentUserId = () => $("user-id").value.trim();
const workoutError = (message) => { $("workout-error").textContent = message || ""; };

async function workoutRequest(path, options = {}) {
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
    const body = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, body };
  } catch (requestError) {
    return { ok: false, status: 0, body: { message: "Backend unreachable. Make sure the server is running on port 5001." } };
  }
}

function formatClock(ms) {
  const total = Math.floor(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function elapsedMs(workout) {
  const now = Date.now();
  const start = new Date(workout.startTime).getTime();
  let paused = workout.pausedMs || 0;
  if (workout.status === "paused" && workout.pausedAt) {
    paused += now - new Date(workout.pausedAt).getTime();
  }
  return Math.max(0, now - start - paused);
}

function updateDurationDisplay() {
  if (!activeWorkout) return;
  $("live-duration").textContent = formatClock(elapsedMs(activeWorkout));
}

function stopLiveTelemetry() {
  clearInterval(liveInterval);
  liveInterval = null;
}

async function pushLiveMetrics() {
  if (!activeWorkout || activeWorkout.status === "paused") return;
  const type = activeWorkout.workoutType;
  const zone = WORKOUT_ZONES[type] || WORKOUT_ZONES.other;
  const heartRate = Math.round(zone[0] + Math.random() * (zone[1] - zone[0]));

  const res = await workoutRequest("/workout/live-metrics", {
    method: "POST",
    body: JSON.stringify({
      userId: currentUserId(),
      workoutId: activeWorkoutId,
      heartRate,
      calories: CALORIES_PER_TICK[type] || 4,
      steps: STEPS_PER_TICK[type] || 0,
    }),
  });

  if (!res.ok) { workoutError(res.body.message || "Live metrics update failed"); return; }
  workoutError("");
  $("live-hr").textContent = heartRate;
  $("live-avg-hr").textContent = res.body.live.heartRate;
  $("live-calories").textContent = formatNumber(res.body.live.caloriesBurned);
}

function startLiveTelemetry() {
  stopLiveTelemetry();
  pushLiveMetrics();
  liveInterval = setInterval(pushLiveMetrics, 3000);
}

function activateWorkoutUI(workout) {
  activeWorkout = workout;
  activeWorkoutId = workout.workoutId || workout._id;
  const paused = workout.status === "paused";

  $("workout-start").hidden = true;
  $("workout-pause").hidden = false;
  $("workout-pause").textContent = paused ? "Resume" : "Pause";
  $("workout-stop").hidden = false;
  $("workout-type").disabled = true;
  $("workout-live").hidden = false;
  $("workout-live").classList.toggle("paused", paused);
  $("workout-chip").textContent = paused ? "PAUSED" : "IN PROGRESS";
  $("workout-title").textContent = `${workout.workoutType} session in progress`;
  $("workout-status-label").textContent = paused ? "Session paused" : "Session running";
  $("workout-hint").hidden = true;
  $("recommendation-count").textContent = "Pending";
  workoutError("");

  updateDurationDisplay();
  clearInterval(durationInterval);
  durationInterval = setInterval(updateDurationDisplay, 1000);

  if (paused) stopLiveTelemetry();
  else startLiveTelemetry();
}

function resetWorkoutUI() {
  activeWorkout = null;
  activeWorkoutId = null;
  stopLiveTelemetry();
  clearInterval(durationInterval);
  durationInterval = null;

  $("workout-start").hidden = false;
  $("workout-pause").hidden = true;
  $("workout-stop").hidden = true;
  $("workout-type").disabled = false;
  $("workout-live").hidden = true;
  $("workout-live").classList.remove("paused");
  $("workout-chip").textContent = "IDLE";
  $("workout-title").textContent = "Ready when you are";
  $("workout-status-label").textContent = "No active session";
  $("workout-hint").hidden = false;
}

function renderWorkoutSummary(summary, recommendations) {
  if (!summary) return;
  $("workout-summary").hidden = false;
  $("summary-duration").textContent = `${summary.durationMinutes} min`;
  $("summary-calories").textContent = `${Math.round(summary.caloriesBurned)} kcal`;
  $("summary-hr").textContent = `${summary.avgHeartRate} bpm`;
  $("recommendation-count").textContent = `${recommendations.length} tips`;
  $("recommendations-list").innerHTML = recommendations.length
    ? recommendations.map((tip, index) => `<article class="recommendation-item"><strong>TIP ${index + 1}</strong><p>${tip}</p></article>`).join("")
    : '<p class="empty-goals">No recommendations for this session.</p>';
}

async function startWorkoutSession() {
  const userId = currentUserId();
  if (!userId) { workoutError("Enter a user id first."); return; }

  $("workout-start").disabled = true;
  const res = await workoutRequest("/workout/start", {
    method: "POST",
    body: JSON.stringify({ userId, workoutType: $("workout-type").value }),
  });
  $("workout-start").disabled = false;

  if (!res.ok) { workoutError(res.body.message || "Could not start workout"); return; }
  activateWorkoutUI(res.body.workout);
}

async function togglePauseWorkout() {
  if (!activeWorkout) return;
  const paused = activeWorkout.status === "paused";
  const res = await workoutRequest(`/workout/${paused ? "resume" : "pause"}`, {
    method: "POST",
    body: JSON.stringify({ userId: currentUserId(), workoutId: activeWorkoutId }),
  });

  if (!res.ok) { workoutError(res.body.message || "Could not update workout state"); return; }
  activateWorkoutUI(res.body.workout);
}

async function stopWorkoutSession() {
  if (!activeWorkout) return;
  $("workout-stop").disabled = true;
  $("workout-status-label").textContent = "Finishing session...";

  const res = await workoutRequest("/workout/stop", {
    method: "POST",
    body: JSON.stringify({ userId: currentUserId(), workoutId: activeWorkoutId }),
  });
  $("workout-stop").disabled = false;

  if (!res.ok) { workoutError(res.body.message || "Could not stop workout"); return; }

  resetWorkoutUI();
  renderWorkoutSummary(res.body.workoutSummary, res.body.recommendations || []);
  $("workout-status-label").textContent = "Session completed";
  loadDashboard();
  loadNotifications();
}

async function loadWorkoutSession() {
  const userId = currentUserId();
  if (!userId) return;

  const activeRes = await workoutRequest(`/workout/active/${encodeURIComponent(userId)}`);
  if (activeRes.ok && activeRes.body.workout) {
    activateWorkoutUI(activeRes.body.workout);
    return;
  }

  resetWorkoutUI();
  const historyRes = await workoutRequest(`/workout/history/${encodeURIComponent(userId)}?limit=1`);
  const last = historyRes.ok && historyRes.body.workouts && historyRes.body.workouts[0];
  if (last && last.status === "completed") renderWorkoutSummary(last, last.recommendations || []);
}

$("workout-start").addEventListener("click", startWorkoutSession);
$("workout-pause").addEventListener("click", togglePauseWorkout);
$("workout-stop").addEventListener("click", stopWorkoutSession);
$("user-id").addEventListener("change", loadWorkoutSession);
loadWorkoutSession();
