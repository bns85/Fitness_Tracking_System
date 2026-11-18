const API_BASE = "http://localhost:5002/api";
const POLL_INTERVAL_MS = 5000;
const RING_LENGTH = 546.64;

const $ = (id) => document.getElementById(id);
const formatNumber = (value) => new Intl.NumberFormat("en-US").format(Math.round(Number(value) || 0));
const formatDate = (date) => {
  if (!date) return "Today";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(date));
};
const formatSleep = (minutes) => `${Math.floor((minutes || 0) / 60)}h ${String(Math.round((minutes || 0) % 60)).padStart(2, "0")}m`;
const formatNotificationDate = (date) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(date));

// POLLING STATE
let pollTimer = null;
let pollCountdown = POLL_INTERVAL_MS / 1000;
let pollCount = 0;
let isPolling = true;

// TOAST
function showToast(message, isError = false) {
  const toast = $("toast");
  toast.textContent = message;
  toast.className = "toast show" + (isError ? " error" : "");
  setTimeout(() => (toast.className = "toast"), 3000);
}

// POLL LOG
function addLog(message, type = "event") {
  const log = $("poll-log");
  const time = new Date().toLocaleTimeString();
  const div = document.createElement("div");
  div.innerHTML = `<span class="log-time">[${time}]</span> <span class="log-${type}">${message}</span>`;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
  // Keep only last 50 entries
  while (log.children.length > 50) log.removeChild(log.firstChild);
}

function setProgress(current, target) {
  const percent = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
  $("goal-ring").style.strokeDashoffset = RING_LENGTH - (RING_LENGTH * percent) / 100;
  $("goal-percent").textContent = `${percent}%`;
  $("steps-value").textContent = formatNumber(current);
  $("steps-target").textContent = formatNumber(target);
  $("steps-left").textContent = formatNumber(Math.max(0, target - current));
  $("goal-message").textContent = percent >= 100 ? "You reached your daily target." : percent >= 70 ? "You are nearly there. Keep moving." : "Your next walk is waiting.";
}

const GOAL_META = {
  steps: { icon: "⌁", unit: "steps" },
  calories: { icon: "✦", unit: "calories" },
  distance: { icon: "➚", unit: "km" },
  workouts: { icon: "◉", unit: "workouts" },
};

function goalCardHtml(goal) {
  const meta = GOAL_META[goal.type] || { icon: "◎", unit: "" };
  const percent = Math.min(100, Math.max(0, Number(goal.percentage) || 0));
  const period = goal.period === "weekly" ? "Weekly" : "Daily";
  const typeLabel = goal.type.charAt(0).toUpperCase() + goal.type.slice(1);
  const completed = goal.status === "completed" || goal.achieved;
  const status = completed ? "completed" : "active";
  const statusLabel = completed ? "Completed" : "Active";
  const current = formatNumber(goal.current);
  const target = formatNumber(goal.target);
  const remaining = formatNumber(goal.remaining ?? Math.max(0, (Number(goal.target) || 0) - (Number(goal.current) || 0)));
  return `<div class="goal-card">
    <div class="goal-card-top">
      <span class="goal-row-icon">${meta.icon}</span>
      <div class="goal-card-heading">
        <span class="goal-card-title">${period} ${typeLabel} Goal</span>
        <span class="goal-card-period">${period} &middot; Target ${target} ${meta.unit}</span>
      </div>
      <span class="goal-status-chip ${status}">${statusLabel}</span>
    </div>
    <span class="goal-card-nums">${current} / ${target}<span>${meta.unit}</span></span>
    <div class="goal-row-bar"><span style="width:${percent}%"></span></div>
    <div class="goal-card-meta"><span>${percent}% completed</span><span>${remaining} ${meta.unit} remaining</span></div>
  </div>`;
}

function renderGoals(goals) {
  $("goal-count").textContent = `${goals.length} ${goals.length === 1 ? "goal" : "goals"}`;
  if (!goals.length) {
    $("goals-list").innerHTML = '<div class="empty-goals">No active goals found for this user. Use "+ Set New Goal" to create one.</div>';
    return;
  }
  $("goals-list").innerHTML = goals.map(goalCardHtml).join("");
}

function renderDashboard(payload) {
  const data = payload.data || {};
  const activity = data.latestActivity || {};
  const averages = data.weeklyAverages || {};
  const goals = data.goals || [];
  const stepsGoal =
    goals.find((goal) => goal.type === "steps" && goal.period === "daily") ||
    goals.find((goal) => goal.type === "steps") ||
    null;
  const calories = activity.activeCalories ?? activity.calories ?? 0;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const displayName = data.userId || "User";
  document.querySelector(".welcome-row h1").innerHTML = `${greeting}, <em id="welcome-name">${displayName}</em>`;
  $("profile-name").textContent = displayName;

  // The hero ring follows the user's saved steps goal (daily preferred);
  // it only falls back to the built-in 10,000 target when no steps goal exists.
  if (stepsGoal) {
    $("goal-kicker").textContent = `${(stepsGoal.period || "daily").toUpperCase()} STEPS`;
    setProgress(Number(stepsGoal.current) || 0, Number(stepsGoal.target) || 10000);
  } else {
    $("goal-kicker").textContent = "DAILY STEPS";
    setProgress(activity.steps || 0, 10000);
  }
  $("metric-steps").textContent = formatNumber(activity.steps);
  $("metric-calories").textContent = formatNumber(calories);
  $("metric-distance").textContent = (Number(activity.distance) || 0).toFixed(2);
  $("activity-date").textContent = formatDate(activity.date);
  $("average-steps").textContent = formatNumber(averages.steps);
  $("active-minutes").textContent = formatNumber(averages.activeMinutes);
  $("sleep-hours-display").textContent = formatSleep((data.sleep || {}).avgMinutesAsleep);

  const sourceLabel = "Poll";
  $("updated-label").textContent = `${sourceLabel} | Poll #${pollCount}`;
  $("sync-label").textContent = "Data synced";
  renderGoals(data.goals || []);
}

function renderNotifications(notifications) {
  const unread = notifications.filter((n) => !n.read).length;
  $("notification-count").textContent = unread;
  $("notification-count").hidden = unread === 0;
  $("notification-label").textContent = unread ? `${unread} unread` : "All caught up";
  $("notifications-list").innerHTML = notifications.length
    ? notifications.map((n) => `<article class="notification-item ${n.read ? "" : "unread"}"><strong>${n.title}</strong><p>${n.message}</p><time>${formatNotificationDate(n.createdAt)}</time></article>`).join("")
    : '<p class="notification-empty">No notifications for this user.</p>';
}

async function fetchNotifications() {
  const userId = $("user-id").value.trim();
  if (!userId) return;
  try {
    const response = await fetch(`${API_BASE}/notifications/${encodeURIComponent(userId)}/poll`);
    if (!response.ok) throw new Error("Notification request failed");
    const payload = await response.json();
    renderNotifications(payload.notifications || []);
  } catch (e) {
    $("notification-label").textContent = "Unavailable";
    $("notifications-list").innerHTML = '<p class="notification-empty">Notifications could not be loaded.</p>';
  }
}

// ==================== POLLING: FETCH DATA ====================

async function fetchDashboard() {
  const userId = $("user-id").value.trim();
  if (!userId) return;
  const statusDot = document.querySelector(".status-dot");
  const error = $("error-message");
  statusDot.classList.remove("error");
  $("sync-label").textContent = "Polling...";
  error.textContent = "";
  try {
    const response = await fetch(`${API_BASE}/dashboard/${encodeURIComponent(userId)}`);
    if (!response.ok) throw new Error(`Request failed (${response.status})`);
    renderDashboard(await response.json());
  } catch (e) {
    statusDot.classList.add("error");
    $("sync-label").textContent = "Could not sync data";
    $("updated-label").textContent = "API unavailable";
    error.textContent = `Could not load dashboard data. Make sure the backend is running on port 5002.`;
  }
}

async function fetchWalkStatus() {
  const userId = $("user-id").value.trim();
  if (!userId) return;
  try {
    const res = await fetch(`${API_BASE}/walk/${encodeURIComponent(userId)}/status`);
    if (!res.ok) return;
    const data = await res.json();
    if (data.active) {
      $("card-walk").classList.add("active");
      $("walk-status").textContent = `Walking: ${data.elapsedMinutes}min`;
      $("walk-status").className = "card-status status-active";
      $("btn-start-walk").disabled = true;
      $("btn-stop-walk").disabled = false;
    } else {
      $("card-walk").classList.remove("active");
      $("walk-status").textContent = "Inactive";
      $("walk-status").className = "card-status status-idle";
      $("btn-start-walk").disabled = false;
      $("btn-stop-walk").disabled = true;
    }
  } catch (e) {}
}

// ==================== POLLING: USER ACTIONS ====================

async function postAction(endpoint, body, cardId, statusId, statusText) {
  const userId = $("user-id").value.trim();
  if (!userId) { showToast("Enter a User ID first", true); return; }

  try {
    const res = await fetch(`${API_BASE}/${endpoint}/${encodeURIComponent(userId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Request failed");

    $(statusId).textContent = statusText;
    $(statusId).className = "card-status status-active";
    $(cardId).classList.add("active");
    showToast(`${endpoint} logged successfully`);
    addLog(`POST /${endpoint} -> ${statusText}`);

    // Trigger immediate poll to refresh dashboard
    fetchDashboard();
  } catch (e) {
    showToast(e.message, true);
    addLog(`POST /${endpoint} FAILED: ${e.message}`, "event");
  }
}

// SLEEP
$("btn-log-sleep").addEventListener("click", () => {
  const hours = parseInt($("sleep-hours").value) || 0;
  const mins = parseInt($("sleep-minutes").value) || 0;
  const totalMinutes = hours * 60 + mins;
  if (totalMinutes <= 0) { showToast("Enter sleep duration", true); return; }
  postAction("sleep", { minutesAsleep: totalMinutes, timeInBed: totalMinutes + 15 }, "card-sleep", "sleep-status", `${hours}h ${mins}m logged`);
});

// WALK START
$("btn-start-walk").addEventListener("click", async () => {
  const userId = $("user-id").value.trim();
  if (!userId) { showToast("Enter a User ID first", true); return; }
  try {
    const res = await fetch(`${API_BASE}/walk/${encodeURIComponent(userId)}/start`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    $("card-walk").classList.add("active");
    $("walk-status").textContent = "Walking...";
    $("walk-status").className = "card-status status-active";
    $("btn-start-walk").disabled = true;
    $("btn-stop-walk").disabled = false;
    $("walk-steps-row").style.display = "flex";
    showToast("Walk started!");
    addLog("POST /walk/start -> Walk session active");
  } catch (e) {
    showToast(e.message, true);
  }
});

// WALK STOP
$("btn-stop-walk").addEventListener("click", async () => {
  const userId = $("user-id").value.trim();
  if (!userId) { showToast("Enter a User ID first", true); return; }
  try {
    const res = await fetch(`${API_BASE}/walk/${encodeURIComponent(userId)}/stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    $("card-walk").classList.remove("active");
    $("walk-status").textContent = `Logged: ${data.summary.steps} steps (${data.summary.durationMinutes}min)`;
    $("walk-status").className = "card-status status-idle";
    $("btn-start-walk").disabled = false;
    $("btn-stop-walk").disabled = true;
    showToast(`Walk ended: ${data.summary.steps} steps, ${data.summary.distance}km in ${data.summary.durationMinutes}min`);
    addLog(`POST /walk/stop -> ${data.summary.steps} steps, ${data.summary.durationMinutes}min`);
    fetchDashboard();
  } catch (e) {
    showToast(e.message, true);
  }
});

// CALORIES
$("btn-log-calories").addEventListener("click", () => {
  const calories = parseInt($("log-calories").value) || 0;
  if (calories <= 0) { showToast("Enter calories", true); return; }
  postAction("calories", { calories }, "card-calories", "calories-status", `+${calories}kcal logged`);
});

// ==================== POLLING CONTROLLER ====================

function startPolling() {
  if (pollTimer) return;
  isPolling = true;
  pollCountdown = POLL_INTERVAL_MS / 1000;
  $("poll-status").innerHTML = "● Polling active";
  $("poll-status").style.color = "#81c784";
  $("poll-toggle").textContent = "Pause";

  pollTimer = setInterval(() => {
    pollCountdown--;
    $("poll-timer").textContent = `Next: ${pollCountdown}s`;

    if (pollCountdown <= 0) {
      pollCount++;
      $("poll-counter").textContent = `${pollCount} polls`;
      pollCountdown = POLL_INTERVAL_MS / 1000;
      fetchDashboard();
      fetchWalkStatus();
      fetchNotifications();
    }
  }, 1000);
}

function stopPolling() {
  isPolling = false;
  clearInterval(pollTimer);
  pollTimer = null;
  $("poll-status").innerHTML = "● Polling paused";
  $("poll-status").style.color = "#ff9800";
  $("poll-timer").textContent = "Paused";
  $("poll-toggle").textContent = "Resume";
  addLog("Polling PAUSED", "event");
}

// ==================== EVENT LISTENERS ====================

$("refresh-button").addEventListener("click", () => {
  pollCount++;
  $("poll-counter").textContent = `${pollCount} polls`;
  addLog(`Manual refresh -> poll #${pollCount}`);
  fetchDashboard();
});

$("poll-toggle").addEventListener("click", () => {
  if (isPolling) {
    stopPolling();
  } else {
    startPolling();
    fetchDashboard();
  }
});

$("user-id").addEventListener("change", () => {
  pollCount = 0;
  $("poll-counter").textContent = "0 polls";
  addLog(`User changed -> resetting poll counter`);
  fetchDashboard();
  fetchWalkStatus();
  fetchNotifications();
});

$("notification-button").addEventListener("click", () => {
  const popover = $("notification-popover");
  popover.hidden = !popover.hidden;
  $("notification-button").setAttribute("aria-expanded", String(!popover.hidden));
  if (!popover.hidden) fetchNotifications();
});

// ==================== SET NEW GOAL (MODAL) ====================

function openGoalModal() {
  $("goal-modal").hidden = false;
  $("goal-form-error").textContent = "";
  $("goal-target").value = "";
  $("goal-start-date").value = new Date().toISOString().slice(0, 10);
  $("goal-target").focus();
}

function closeGoalModal() {
  $("goal-modal").hidden = true;
  $("goal-form-error").textContent = "";
}

$("add-goal-button").addEventListener("click", openGoalModal);
$("goal-modal-close").addEventListener("click", closeGoalModal);
$("goal-cancel").addEventListener("click", closeGoalModal);
$("goal-modal").addEventListener("click", (event) => {
  if (event.target === $("goal-modal")) closeGoalModal();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !$("goal-modal").hidden) closeGoalModal();
});

$("goal-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const error = $("goal-form-error");
  error.textContent = "";

  const userId = $("user-id").value.trim();
  const type = $("goal-type").value;
  const period = $("goal-period").value;
  const target = Number($("goal-target").value);
  const startDate = $("goal-start-date").value || undefined;

  if (!userId) { error.textContent = "Enter a user id first."; return; }
  if (!Number.isFinite(target) || target <= 0) { error.textContent = "Target value must be a positive number."; return; }

  const saveButton = $("goal-save");
  saveButton.disabled = true;
  try {
    const response = await fetch(`${API_BASE}/goals`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, type, target, period, startDate }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      error.textContent = body.message || `Could not save goal (${response.status}).`;
      return;
    }
    closeGoalModal();
    addLog(`POST /goals -> ${period} ${type} goal (${target}) saved`);
    showToast("Goal saved");
    await fetchDashboard();
    await fetchNotifications();
  } catch (requestError) {
    error.textContent = "Backend unreachable. Make sure the server is running on port 5002.";
  } finally {
    saveButton.disabled = false;
  }
});

// ==================== INIT ====================
addLog("Polling system initialized");
fetchDashboard();
fetchWalkStatus();
fetchNotifications();
startPolling();
