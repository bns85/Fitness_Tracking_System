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

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const displayName = data.userId || "User";
  document.querySelector(".welcome-row h1").innerHTML = `${greeting}, <em id="welcome-name">${displayName}</em>`;
  $("profile-name").textContent = displayName;

  setProgress(activity.steps || stepsGoal.current || 0, stepsGoal.target || 10000);
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
});

$("notification-button").addEventListener("click", () => {
  const popover = $("notification-popover");
  popover.hidden = !popover.hidden;
  $("notification-button").setAttribute("aria-expanded", String(!popover.hidden));
});

// ==================== INIT ====================
addLog("Polling system initialized");
fetchDashboard();
fetchWalkStatus();
startPolling();
