function byId(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return ch;
    }
  });
}

const views = {
  list: "view-list",
  minigame: "view-minigame",
};

const STORAGE_KEY = "better-alarm.alarms.v1";
let alarms = [];
let activeAlarmId = null;
let audioContext = null;
let ringIntervalId = null;

function showView(name) {
  for (const [key, id] of Object.entries(views)) {
    const el = byId(id);
    el.classList.toggle("view--hidden", key !== name);
  }
}

function startMinigameForAlarm(alarmId) {
  // Placeholder: later this will render a selected minigame and start alarm audio.
  console.log("startMinigameForAlarm", alarmId);
  showView("minigame");
}

function formatTime24To12(time24) {
  const [hhRaw, mmRaw] = String(time24).split(":");
  const hh = Number(hhRaw);
  const mm = Number(mmRaw);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return String(time24);
  const suffix = hh >= 12 ? "PM" : "AM";
  const hour12 = ((hh + 11) % 12) + 1;
  const minutes = String(mm).padStart(2, "0");
  return `${hour12}:${minutes} ${suffix}`;
}

function sortAlarmsByTime(a, b) {
  return String(a.time).localeCompare(String(b.time));
}

function formatNowStatus(now) {
  return now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function getTodayKey(now) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getCurrentTimeHHMM(now) {
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function safeUuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `alarm-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function saveAlarms() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(alarms));
}

function loadAlarms() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item === "object")
      .map((item) => ({
        id: String(item.id || safeUuid()),
        time: String(item.time || ""),
        label: String(item.label || "Alarm"),
        minigame: String(item.minigame || "Placeholder"),
        enabled: Boolean(item.enabled),
        lastTriggeredDate: item.lastTriggeredDate
          ? String(item.lastTriggeredDate)
          : null,
      }))
      .filter((item) => /^\d{2}:\d{2}$/.test(item.time));
  } catch {
    return [];
  }
}

function getNextAlarm() {
  const enabled = alarms.filter((a) => a.enabled).sort(sortAlarmsByTime);
  return enabled[0] || null;
}

function updateHeaderStatus(now) {
  const status = byId("app-status");
  const current = formatNowStatus(now);
  const next = getNextAlarm();
  if (!next) {
    status.textContent = `Now: ${current} • No alarms enabled`;
    return;
  }
  status.textContent = `Now: ${current} • Next: ${formatTime24To12(next.time)}`;
}

function ensureAudioContext() {
  if (!audioContext) {
    const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctx) return null;
    audioContext = new Ctx();
  }
  if (audioContext.state === "suspended") {
    audioContext.resume().catch(() => {});
  }
  return audioContext;
}

function beepOnce() {
  const ctx = ensureAudioContext();
  if (!ctx) return;
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = "square";
  oscillator.frequency.value = 920;
  gain.gain.setValueAtTime(0.001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22);
  oscillator.connect(gain).connect(ctx.destination);
  oscillator.start();
  oscillator.stop(ctx.currentTime + 0.24);
}

function startRinging() {
  stopRinging();
  beepOnce();
  ringIntervalId = window.setInterval(beepOnce, 900);
}

function stopRinging() {
  if (ringIntervalId !== null) {
    clearInterval(ringIntervalId);
    ringIntervalId = null;
  }
}

function openRingModal(alarm) {
  const modal = byId("ring-modal");
  const message = byId("ring-message");
  message.textContent = `${formatTime24To12(alarm.time)} • ${alarm.label}`;
  modal.classList.remove("modal--hidden");
  byId("btn-dismiss-alarm").focus();
}

function closeRingModal() {
  byId("ring-modal").classList.add("modal--hidden");
}

function triggerAlarm(alarm, now) {
  activeAlarmId = alarm.id;
  alarm.lastTriggeredDate = getTodayKey(now);
  saveAlarms();
  renderAlarms();
  openRingModal(alarm);
  startRinging();
}

function dismissActiveAlarm() {
  activeAlarmId = null;
  stopRinging();
  closeRingModal();
}

function checkForAlarmTrigger(now) {
  if (activeAlarmId) return;
  const hhmm = getCurrentTimeHHMM(now);
  const today = getTodayKey(now);
  const dueAlarm = alarms.find(
    (alarm) =>
      alarm.enabled && alarm.time === hhmm && alarm.lastTriggeredDate !== today
  );
  if (dueAlarm) triggerAlarm(dueAlarm, now);
}

function startClockLoop() {
  const tick = () => {
    const now = new Date();
    updateHeaderStatus(now);
    checkForAlarmTrigger(now);
  };
  tick();
  window.setInterval(tick, 1000);
}

function renderAlarms() {
  const list = byId("alarm-items");
  const empty = byId("alarm-empty");

  const sorted = [...alarms].sort(sortAlarmsByTime);
  empty.style.display = sorted.length === 0 ? "block" : "none";

  list.innerHTML = sorted
    .map((alarm) => {
      const timeText = formatTime24To12(alarm.time);
      const label = escapeHtml(alarm.label || "Alarm");
      const minigame = escapeHtml(alarm.minigame || "Placeholder");
      const enabled = alarm.enabled ? "checked" : "";

      return `
        <li class="alarm-item" data-alarm-id="${alarm.id}">
          <div class="alarm-item__meta">
            <div class="alarm-item__time">${timeText}</div>
            <div class="alarm-item__sub">
              <span>${label}</span>
              <span class="pill">Minigame: ${minigame}</span>
            </div>
          </div>
          <label class="switch" aria-label="Enable alarm">
            <input type="checkbox" data-alarm-toggle ${enabled} />
            <span class="switch__track" aria-hidden="true">
              <span class="switch__thumb"></span>
            </span>
          </label>
        </li>
      `;
    })
    .join("");
}

function openAlarmModal() {
  const modal = byId("alarm-modal");
  modal.classList.remove("modal--hidden");
  byId("alarm-form").querySelector('input[name="time"]')?.focus();
  ensureAudioContext();
}

function closeAlarmModal() {
  const modal = byId("alarm-modal");
  modal.classList.add("modal--hidden");
  byId("btn-add-alarm").focus();
}

function init() {
  const addAlarmButton = byId("btn-add-alarm");
  const form = byId("alarm-form");
  const modal = byId("alarm-modal");
  const alarmList = byId("alarm-items");
  const dismissButton = byId("btn-dismiss-alarm");

  alarms = loadAlarms();

  addAlarmButton.addEventListener("click", openAlarmModal);

  modal.addEventListener("click", (e) => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    if (target.closest("[data-modal-close]")) closeAlarmModal();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const isAlarmModalOpen = !byId("alarm-modal").classList.contains("modal--hidden");
    if (isAlarmModalOpen) closeAlarmModal();
    const isRingModalOpen = !byId("ring-modal").classList.contains("modal--hidden");
    if (isRingModalOpen) dismissActiveAlarm();
  });

  alarmList.addEventListener("change", (e) => {
    const target = e.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (!target.matches("[data-alarm-toggle]")) return;
    const row = target.closest("[data-alarm-id]");
    if (!(row instanceof HTMLElement)) return;
    const id = row.dataset.alarmId;
    const alarm = alarms.find((a) => a.id === id);
    if (!alarm) return;
    alarm.enabled = target.checked;
    saveAlarms();
    updateHeaderStatus(new Date());
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const time = String(fd.get("time") || "").trim();
    const label = String(fd.get("label") || "").trim() || "Alarm";
    const minigame =
      String(fd.get("minigame") || "").trim() || "Placeholder";

    if (!time) return;

    alarms.push({
      id: safeUuid(),
      time,
      label,
      minigame,
      enabled: true,
      lastTriggeredDate: null,
    });

    form.reset();
    saveAlarms();
    renderAlarms();
    closeAlarmModal();
    updateHeaderStatus(new Date());
  });

  dismissButton.addEventListener("click", dismissActiveAlarm);

  showView("list");
  renderAlarms();
  startClockLoop();
}

document.addEventListener("DOMContentLoaded", init);

