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

const pages = {
  alarms: "page-alarms",
  stopwatch: "page-stopwatch",
  timer: "page-timer",
  minigames: "page-minigames",
};

const GAME_START_DELAY_MIN_MS = 1000;
const GAME_START_DELAY_MAX_MS = 2000;
const FLAPPY_GATES_TO_WIN = 8;
const FLAPPY_LIVES = 4;
const MATH_REQUIRED_CORRECT = 8;
const MEMORY_MAX_ROUND = 6;

const STORAGE_KEY = "better-alarm.alarms.v1";
const SNOOZE_MS = 5 * 60 * 1000;
let alarms = [];
let activeAlarmId = null;
let audioContext = null;
let ringIntervalId = null;
let activeGameCleanup = null;
let editingAlarmId = null;
let freeplayCleanup = null;

let swRunning = false;
let swBaseElapsed = 0;
let swStartPerf = 0;
let swRaf = 0;
const swLaps = [];

let timerTotalMs = 5 * 60 * 1000;
let timerRemainingMs = 5 * 60 * 1000;
let timerRunning = false;
let timerEndAt = 0;
let timerTickId = null;
let timerFinished = false;
let timerBeepId = null;

function showPage(name) {
  if (name !== "minigames" && freeplayCleanup) {
    freeplayCleanup();
    freeplayCleanup = null;
  }
  for (const [key, id] of Object.entries(pages)) {
    const el = byId(id);
    el.classList.toggle("page--hidden", key !== name);
  }
  document.querySelectorAll(".nav-tab").forEach((btn) => {
    if (!(btn instanceof HTMLElement)) return;
    const isActive = btn.dataset.page === name;
    btn.classList.toggle("nav-tab--active", isActive);
  });
}

function startMinigameForAlarm(alarmId) {
  console.log("startMinigameForAlarm", alarmId);
  showPage("minigames");
}

function formatStopwatchMs(totalMs) {
  const ms = Math.floor(totalMs % 1000);
  let rest = Math.floor(totalMs / 1000);
  const s = rest % 60;
  rest = Math.floor(rest / 60);
  const m = rest % 60;
  const h = Math.floor(rest / 60);
  const pad = (n, w) => String(n).padStart(w, "0");
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}.${pad(ms, 3)}`;
}

function formatTimerRemainingMs(ms) {
  if (ms < 0) ms = 0;
  const whole = Math.floor(ms);
  const frac = whole % 1000;
  let rest = Math.floor(whole / 1000);
  const s = rest % 60;
  rest = Math.floor(rest / 60);
  const m = rest % 60;
  const h = Math.floor(rest / 60);
  const pad = (n, w) => String(n).padStart(w, "0");
  if (h > 0) {
    return `${h}:${pad(m, 2)}:${pad(s, 2)}.${pad(frac, 3)}`;
  }
  return `${pad(m, 2)}:${pad(s, 2)}.${pad(frac, 3)}`;
}

/**
 * Runs 1–2s countdown in rootEl, then calls startMount().
 * Returns teardown that clears timers and empties root if still in countdown.
 */
function runGameStartCountdown(rootEl, startMount) {
  const delayMs =
    GAME_START_DELAY_MIN_MS +
    Math.random() * (GAME_START_DELAY_MAX_MS - GAME_START_DELAY_MIN_MS);
  const endAt = Date.now() + delayMs;
  const msg = document.createElement("p");
  msg.className = "muted game-countdown";
  msg.id = "game-countdown";
  msg.textContent = "Starting…";
  rootEl.replaceChildren(msg);

  const tick = () => {
    const left = Math.max(0, endAt - Date.now());
    const sec = Math.ceil(left / 1000);
    msg.textContent = sec > 0 ? `Starting in ${sec}…` : "Go!";
  };
  tick();
  const intervalId = window.setInterval(tick, 120);

  const timeoutId = window.setTimeout(() => {
    window.clearInterval(intervalId);
    startMount();
  }, delayMs);

  return () => {
    window.clearInterval(intervalId);
    window.clearTimeout(timeoutId);
  };
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

function getAlarmScheduledMs(alarm, now) {
  const [hhRaw, mmRaw] = String(alarm.time).split(":");
  const hh = Number(hhRaw);
  const mm = Number(mmRaw);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  const scheduled = new Date(now);
  scheduled.setHours(hh, mm, 0, 0);
  if (scheduled.getTime() <= now.getTime()) {
    scheduled.setDate(scheduled.getDate() + 1);
  }
  return scheduled.getTime();
}

function getAlarmNextRingInfo(alarm, now) {
  if (!alarm.enabled) return null;
  const nowMs = now.getTime();
  const scheduledMs = getAlarmScheduledMs(alarm, now);
  const hasFutureSnooze =
    typeof alarm.snoozeUntil === "number" && alarm.snoozeUntil > nowMs;
  const snoozeMs = hasFutureSnooze ? alarm.snoozeUntil : null;

  if (snoozeMs !== null && (scheduledMs === null || snoozeMs <= scheduledMs)) {
    return { whenMs: snoozeMs, source: "snooze" };
  }
  if (scheduledMs !== null) {
    return { whenMs: scheduledMs, source: "schedule" };
  }
  return null;
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
        minigame: (() => {
          const rawType = String(item.minigame || "");
          if (rawType === "flappy5") return "flappy10";
          if (["flappy10", "math3", "memory4", "none"].includes(rawType)) {
            return rawType;
          }
          return "flappy10";
        })(),
        enabled: Boolean(item.enabled),
        lastTriggeredDate: item.lastTriggeredDate
          ? String(item.lastTriggeredDate)
          : null,
        snoozeUntil:
          typeof item.snoozeUntil === "number" ? item.snoozeUntil : null,
      }))
      .filter((item) => /^\d{2}:\d{2}$/.test(item.time));
  } catch {
    return [];
  }
}

function getNextAlarm(now) {
  let next = null;
  for (const alarm of alarms) {
    const info = getAlarmNextRingInfo(alarm, now);
    if (!info) continue;
    if (!next || info.whenMs < next.whenMs) {
      next = { alarm, ...info };
    }
  }
  return next;
}

function getMinigameLabel(type) {
  switch (type) {
    case "flappy10":
      return "Flappy Sprint";
    case "math3":
      return "Quick Math";
    case "memory4":
      return "Memory Tap";
    case "none":
      return "No Game";
    default:
      return "Flappy Sprint";
  }
}

function updateHeaderStatus(now) {
  const status = byId("app-status");
  const current = formatNowStatus(now);
  if (activeAlarmId) {
    status.textContent = `Now: ${current} • Ringing`;
    return;
  }
  const next = getNextAlarm(now);
  if (!next) {
    status.textContent = `Now: ${current} • No alarms enabled`;
    return;
  }
  const when = new Date(next.whenMs);
  const timeLabel = when.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  const isTomorrow = when.toDateString() !== now.toDateString();
  const suffix = next.source === "snooze" ? " (snoozed)" : isTomorrow ? " (tomorrow)" : "";
  status.textContent = `Now: ${current} • Next: ${timeLabel}${suffix}`;
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
  message.textContent = `${formatTime24To12(alarm.time)} • ${alarm.label} • ${getMinigameLabel(
    alarm.minigame
  )}`;
  byId("ring-game-root").innerHTML = "";
  byId("btn-start-challenge").textContent =
    alarm.minigame === "none" ? "Dismiss Alarm" : "Start Challenge";
  modal.classList.remove("modal--hidden");
  byId("btn-start-challenge").focus();
}

function closeRingModal() {
  byId("ring-modal").classList.add("modal--hidden");
  byId("ring-game-root").innerHTML = "";
}

function triggerAlarm(alarm, now, source = "schedule") {
  activeAlarmId = alarm.id;
  if (source === "schedule") {
    alarm.lastTriggeredDate = getTodayKey(now);
  }
  alarm.snoozeUntil = null;
  saveAlarms();
  renderAlarms();
  openRingModal(alarm);
  startRinging();
}

function dismissActiveAlarm() {
  if (activeGameCleanup) {
    activeGameCleanup();
    activeGameCleanup = null;
  }
  activeAlarmId = null;
  stopRinging();
  closeRingModal();
  updateHeaderStatus(new Date());
}

function snoozeActiveAlarm() {
  if (!activeAlarmId) return;
  if (activeGameCleanup) {
    activeGameCleanup();
    activeGameCleanup = null;
  }
  const alarm = alarms.find((item) => item.id === activeAlarmId);
  if (!alarm) return;
  alarm.snoozeUntil = Date.now() + SNOOZE_MS;
  saveAlarms();
  renderAlarms();
  activeAlarmId = null;
  stopRinging();
  closeRingModal();
  updateHeaderStatus(new Date());
}

function checkForAlarmTrigger(now) {
  if (activeAlarmId) return;
  const nowMs = now.getTime();
  const snoozedAlarm = alarms
    .filter(
      (alarm) =>
        alarm.enabled &&
        typeof alarm.snoozeUntil === "number" &&
        alarm.snoozeUntil <= nowMs
    )
    .sort((a, b) => a.snoozeUntil - b.snoozeUntil)[0];
  if (snoozedAlarm) {
    triggerAlarm(snoozedAlarm, now, "snooze");
    return;
  }
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
  const now = new Date();

  const sorted = [...alarms].sort(sortAlarmsByTime);
  empty.style.display = sorted.length === 0 ? "block" : "none";

  list.innerHTML = sorted
    .map((alarm) => {
      const timeText = formatTime24To12(alarm.time);
      const label = escapeHtml(alarm.label || "Alarm");
      const minigame = escapeHtml(getMinigameLabel(alarm.minigame));
      const enabled = alarm.enabled ? "checked" : "";
      const hasFutureSnooze =
        alarm.enabled &&
        typeof alarm.snoozeUntil === "number" &&
        alarm.snoozeUntil > now.getTime();
      const snoozeLabel = hasFutureSnooze
        ? `<span class="pill">Snoozed until ${escapeHtml(
            new Date(alarm.snoozeUntil).toLocaleTimeString([], {
              hour: "numeric",
              minute: "2-digit",
            })
          )}</span>`
        : "";

      return `
        <li class="alarm-item" data-alarm-id="${alarm.id}">
          <div class="alarm-item__meta">
            <div class="alarm-item__time">${timeText}</div>
            <div class="alarm-item__sub">
              <span>${label}</span>
              <span class="pill">Minigame: ${minigame}</span>
              ${snoozeLabel}
            </div>
          </div>
          <div class="alarm-item__actions">
            <button type="button" class="btn" data-alarm-edit>
              Edit
            </button>
            <button type="button" class="btn btn--danger" data-alarm-delete>
              Delete
            </button>
            <label class="switch" aria-label="Enable alarm">
              <input type="checkbox" data-alarm-toggle ${enabled} />
              <span class="switch__track" aria-hidden="true">
                <span class="switch__thumb"></span>
              </span>
            </label>
          </div>
        </li>
      `;
    })
    .join("");
}

function openAlarmModal() {
  const modal = byId("alarm-modal");
  const title = byId("alarm-modal-title");
  if (editingAlarmId) {
    const alarm = alarms.find((item) => item.id === editingAlarmId);
    if (alarm) {
      byId("alarm-form").elements.time.value = alarm.time;
      byId("alarm-form").elements.label.value = alarm.label || "";
      byId("alarm-form").elements.minigame.value = alarm.minigame || "flappy10";
      title.textContent = "Edit Alarm";
    }
  } else {
    title.textContent = "Alarm";
  }
  modal.classList.remove("modal--hidden");
  byId("alarm-form").querySelector('input[name="time"]')?.focus();
  ensureAudioContext();
}

function closeAlarmModal() {
  const modal = byId("alarm-modal");
  modal.classList.add("modal--hidden");
  editingAlarmId = null;
  byId("alarm-form").reset();
  byId("alarm-modal-title").textContent = "Alarm";
  byId("btn-add-alarm").focus();
}

function mountFlappySprint(rootEl, onWin) {
  const wrapper = document.createElement("div");
  wrapper.className = "game-stack";
  wrapper.innerHTML =
    '<p id="flappy-progress" class="game-progress"></p><p class="muted">Click or press Space to flap.</p>';
  const canvas = document.createElement("canvas");
  canvas.width = 420;
  canvas.height = 200;
  wrapper.appendChild(canvas);
  const restartButton = document.createElement("button");
  restartButton.type = "button";
  restartButton.className = "btn";
  restartButton.textContent = "Retry";
  restartButton.style.display = "none";
  wrapper.appendChild(restartButton);
  rootEl.replaceChildren(wrapper);

  const progressEl = wrapper.querySelector("#flappy-progress");
  const updateProgress = () => {
    if (progressEl) {
      progressEl.textContent = `Gates: ${passed}/${FLAPPY_GATES_TO_WIN}`;
    }
  };

  const ctx = canvas.getContext("2d");
  if (!ctx) return () => {};

  let raf = 0;
  let finished = false;
  let birdY = 100;
  let birdVy = 0;
  const birdX = 80;
  let passed = 0;
  let gateX = 420;
  let gateGapY = 100;
  let scoredThisGate = false;
  let isDead = false;
  let lives = FLAPPY_LIVES;
  let invulnFrames = 0;

  const flap = () => {
    if (isDead) return;
    birdVy = -4.8;
  };
  const onKey = (e) => {
    if (e.code === "Space") {
      e.preventDefault();
      flap();
    }
  };

  canvas.addEventListener("pointerdown", flap);
  document.addEventListener("keydown", onKey);

  const resetGate = () => {
    gateX = 420;
    gateGapY = 70 + Math.random() * 70;
    scoredThisGate = false;
  };
  const resetRun = () => {
    birdY = 100;
    birdVy = 0;
    passed = 0;
    lives = FLAPPY_LIVES;
    invulnFrames = 0;
    gateX = 420;
    gateGapY = 70 + Math.random() * 70;
    scoredThisGate = false;
    isDead = false;
    restartButton.style.display = "none";
    updateProgress();
  };
  const die = () => {
    isDead = true;
    restartButton.style.display = "inline-block";
  };
  restartButton.addEventListener("click", () => {
    resetRun();
  });

  updateProgress();

  const loop = () => {
    if (finished) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!isDead) {
      birdVy += 0.28;
      birdY += birdVy;
      gateX -= 2.25;
      if (invulnFrames > 0) invulnFrames -= 1;
    }

    const gapHalf = 54;
    const gateWidth = 52;
    const topGateH = gateGapY - gapHalf;
    const bottomGateY = gateGapY + gapHalf;

    const birdR = 10;
    if (
      !isDead &&
      !scoredThisGate &&
      gateX + gateWidth < birdX - birdR
    ) {
      scoredThisGate = true;
      passed += 1;
      updateProgress();
      if (passed >= FLAPPY_GATES_TO_WIN) {
        finished = true;
        onWin();
        return;
      }
    }

    if (!isDead && gateX + gateWidth < 0) resetGate();

    const hitTop = birdY - birdR <= 0;
    const hitBottom = birdY + birdR >= canvas.height;
    const inGateX = birdX + birdR > gateX && birdX - birdR < gateX + gateWidth;
    const inTopGate = birdY - birdR < topGateH;
    const inBottomGate = birdY + birdR > bottomGateY;
    const hitGate = inGateX && (inTopGate || inBottomGate);
    if (!isDead && invulnFrames <= 0 && (hitTop || hitBottom || hitGate)) {
      lives -= 1;
      if (lives <= 0) {
        die();
      } else {
        birdY = 100;
        birdVy = 0;
        gateX = 420;
        gateGapY = 70 + Math.random() * 70;
        scoredThisGate = false;
        invulnFrames = 95;
      }
    }

    ctx.fillStyle = "#b7c3ff";
    ctx.fillRect(gateX, 0, gateWidth, topGateH);
    ctx.fillRect(gateX, bottomGateY, gateWidth, canvas.height - bottomGateY);

    ctx.beginPath();
    ctx.fillStyle = invulnFrames > 0 ? "#ffe693" : "#ffd94f";
    ctx.arc(birdX, birdY, birdR, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "rgba(231,234,243,0.9)";
    ctx.font = "13px system-ui";
    ctx.fillText(`Lives: ${lives}`, 12, 20);
    updateProgress();

    if (isDead) {
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "rgba(231,234,243,0.98)";
      ctx.font = "bold 20px system-ui";
      ctx.textAlign = "center";
      ctx.fillText("You crashed", canvas.width / 2, canvas.height / 2 - 8);
      ctx.font = "14px system-ui";
      ctx.fillText("Press Retry", canvas.width / 2, canvas.height / 2 + 18);
      ctx.textAlign = "start";
    }

    raf = requestAnimationFrame(loop);
  };
  loop();

  return () => {
    finished = true;
    cancelAnimationFrame(raf);
    canvas.removeEventListener("pointerdown", flap);
    document.removeEventListener("keydown", onKey);
    restartButton.remove();
    rootEl.innerHTML = "";
  };
}

function mountQuickMath(rootEl, onWin) {
  const wrapper = document.createElement("div");
  wrapper.className = "game-stack";
  wrapper.innerHTML = `
    <p id="math-progress" class="game-progress"></p>
    <p class="muted">Solve the prompt.</p>
    <p id="math-question"></p>
    <input id="math-input" class="field__control" type="number" />
    <button id="math-submit" class="btn btn--primary" type="button">Answer</button>
    <p id="math-status" class="muted"></p>
  `;
  rootEl.replaceChildren(wrapper);

  const q = wrapper.querySelector("#math-question");
  const input = wrapper.querySelector("#math-input");
  const submit = wrapper.querySelector("#math-submit");
  const status = wrapper.querySelector("#math-status");
  const progressEl = wrapper.querySelector("#math-progress");
  if (!(q && input && submit && status)) return () => {};

  let solved = 0;
  let a = 0;
  let b = 0;
  let op = "+";
  let answer = 0;
  let done = false;
  const requiredCorrect = MATH_REQUIRED_CORRECT;

  const updateMathProgress = () => {
    if (progressEl) {
      progressEl.textContent = `Correct: ${solved}/${requiredCorrect}`;
    }
  };

  const pickOp = () => {
    const r = Math.random();
    if (r < 0.55) return "*";
    if (r < 0.775) return "+";
    return "-";
  };

  const next = () => {
    op = pickOp();
    if (op === "*") {
      a = Math.floor(4 + Math.random() * 9);
      b = Math.floor(4 + Math.random() * 9);
      if (Math.random() < 0.35) {
        a = Math.floor(6 + Math.random() * 7);
        b = Math.floor(6 + Math.random() * 7);
      }
    } else {
      a = Math.floor(12 + Math.random() * 35);
      b = Math.floor(3 + Math.random() * 22);
    }
    if (op === "-" && b > a) [a, b] = [b, a];
    if (op === "+") answer = a + b;
    if (op === "-") answer = a - b;
    if (op === "*") answer = a * b;
    q.textContent = `${a} ${op} ${b} = ?`;
    status.textContent = "";
    input.value = "";
    input.focus();
    updateMathProgress();
  };
  const onSubmit = () => {
    if (done) return;
    if (Number(input.value) === answer) {
      solved += 1;
      updateMathProgress();
      if (solved >= requiredCorrect) {
        done = true;
        onWin();
        return;
      }
      next();
    } else {
      solved = Math.max(0, solved - 1);
      updateMathProgress();
      status.textContent = "Wrong. Try another.";
      next();
    }
  };

  submit.addEventListener("click", onSubmit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") onSubmit();
  });
  updateMathProgress();
  next();

  return () => {
    done = true;
    rootEl.innerHTML = "";
  };
}

function mountMemoryTap(rootEl, onWin) {
  const colors = ["#4f83ff", "#ff7f7f", "#7ee787", "#ffd166"];
  const wrapper = document.createElement("div");
  wrapper.className = "game-stack";
  wrapper.innerHTML = `
    <p id="mem-progress" class="game-progress"></p>
    <p class="muted">Repeat the pattern.</p>
    <p id="mem-status" class="muted">Watch...</p>
    <div class="game-pad-grid"></div>
  `;
  rootEl.replaceChildren(wrapper);
  const grid = wrapper.querySelector(".game-pad-grid");
  const status = wrapper.querySelector("#mem-status");
  const memProgress = wrapper.querySelector("#mem-progress");
  if (!(grid && status)) return () => {};

  let round = 1;
  const maxRound = MEMORY_MAX_ROUND;

  const updateMemProgress = () => {
    if (memProgress) {
      memProgress.textContent = `Round ${Math.min(round, MEMORY_MAX_ROUND)}/${MEMORY_MAX_ROUND}`;
    }
  };

  const padOffColor = "#111111";
  const pads = colors.map((color, idx) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "game-pad";
    btn.style.background = padOffColor;
    btn.dataset.color = color;
    btn.dataset.idx = String(idx);
    btn.dataset.active = "false";
    grid.appendChild(btn);
    return btn;
  });

  let sequence = [];
  let userIndex = 0;
  let locked = true;
  let cancelled = false;
  let timeouts = [];

  const clearTimers = () => {
    timeouts.forEach((id) => clearTimeout(id));
    timeouts = [];
  };

  const flash = (idx, delay) => {
    timeouts.push(
      setTimeout(() => {
        const pad = pads[idx];
        pad.dataset.active = "true";
        pad.style.background = pad.dataset.color || padOffColor;
        setTimeout(() => {
          pad.dataset.active = "false";
          pad.style.background = padOffColor;
        }, 220);
      }, delay)
    );
  };

  const showSequence = () => {
    locked = true;
    status.textContent = "Watch...";
    updateMemProgress();
    clearTimers();
    sequence.forEach((idx, i) => flash(idx, i * 360));
    timeouts.push(
      setTimeout(() => {
        locked = false;
        userIndex = 0;
        status.textContent = "Your turn";
      }, sequence.length * 360 + 120)
    );
  };

  const nextRound = () => {
    if (cancelled) return;
    if (round > maxRound) {
      onWin();
      return;
    }
    updateMemProgress();
    sequence = Array.from({ length: round + 1 }, () =>
      Math.floor(Math.random() * 4)
    );
    showSequence();
  };

  const onPad = (e) => {
    if (locked) return;
    const target = e.currentTarget;
    const idx = Number(target.dataset.idx);
    target.style.background = target.dataset.color || padOffColor;
    setTimeout(() => {
      target.style.background = padOffColor;
    }, 120);
    if (idx !== sequence[userIndex]) {
      status.textContent = "Wrong pattern. Restarting round.";
      userIndex = 0;
      locked = true;
      timeouts.push(setTimeout(showSequence, 500));
      return;
    }
    userIndex += 1;
    if (userIndex >= sequence.length) {
      round += 1;
      locked = true;
      timeouts.push(setTimeout(nextRound, 420));
    }
  };

  pads.forEach((pad) => pad.addEventListener("click", onPad));
  updateMemProgress();
  nextRound();

  return () => {
    cancelled = true;
    clearTimers();
    pads.forEach((pad) => pad.removeEventListener("click", onPad));
    rootEl.innerHTML = "";
  };
}

function startChallengeForActiveAlarm() {
  if (!activeAlarmId) return;
  const alarm = alarms.find((item) => item.id === activeAlarmId);
  if (!alarm) return;
  if (activeGameCleanup) {
    activeGameCleanup();
    activeGameCleanup = null;
  }
  const root = byId("ring-game-root");
  const onWin = () => {
    if (activeGameCleanup) {
      activeGameCleanup();
      activeGameCleanup = null;
    }
    dismissActiveAlarm();
  };
  if (alarm.minigame === "none") {
    dismissActiveAlarm();
    return;
  }

  let countdownTeardown = null;
  let gameTeardown = null;
  const stopChallengeUi = () => {
    if (countdownTeardown) {
      countdownTeardown();
      countdownTeardown = null;
    }
    if (gameTeardown) {
      gameTeardown();
      gameTeardown = null;
    }
    root.innerHTML = "";
  };

  countdownTeardown = runGameStartCountdown(root, () => {
    countdownTeardown = null;
    switch (alarm.minigame) {
      case "math3":
        gameTeardown = mountQuickMath(root, onWin);
        break;
      case "memory4":
        gameTeardown = mountMemoryTap(root, onWin);
        break;
      case "flappy10":
      default:
        gameTeardown = mountFlappySprint(root, onWin);
        break;
    }
  });

  activeGameCleanup = stopChallengeUi;
}

function stopTimerBeeps() {
  if (timerBeepId !== null) {
    clearInterval(timerBeepId);
    timerBeepId = null;
  }
}

function startTimerBeeps() {
  stopTimerBeeps();
  beepOnce();
  timerBeepId = setInterval(beepOnce, 850);
}

function swCurrentMs() {
  let ms = swBaseElapsed;
  if (swRunning) {
    ms += performance.now() - swStartPerf;
  }
  return ms;
}

function swUpdateDisplay() {
  byId("stopwatch-display").textContent = formatStopwatchMs(swCurrentMs());
}

function swLoop() {
  swUpdateDisplay();
  if (swRunning) {
    swRaf = requestAnimationFrame(swLoop);
  }
}

function renderSwLaps() {
  const ul = byId("stopwatch-laps");
  ul.innerHTML = swLaps
    .map(
      (lap, i) =>
        `<li class="lap-item"><span class="lap-num">#${i + 1}</span> ${formatStopwatchMs(
          lap
        )}</li>`
    )
    .join("");
}

function timerUpdateDisplay() {
  byId("timer-display").textContent = formatTimerRemainingMs(timerRemainingMs);
}

function timerTick() {
  if (!timerRunning) return;
  timerRemainingMs = Math.max(0, timerEndAt - Date.now());
  timerUpdateDisplay();
  if (timerRemainingMs <= 0) {
    timerRunning = false;
    timerFinished = true;
    if (timerTickId !== null) {
      clearInterval(timerTickId);
      timerTickId = null;
    }
    byId("btn-timer-start").disabled = false;
    byId("btn-timer-pause").disabled = true;
    byId("timer-status").textContent = "Time's up";
    startTimerBeeps();
    ensureAudioContext();
  }
}

function readCustomTimerMs() {
  const m = Math.max(0, Number(byId("timer-min").value) || 0);
  const s = Math.max(0, Math.min(59, Number(byId("timer-sec").value) || 0));
  return (m * 60 + s) * 1000;
}

function syncTimerInputsFromMs(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  byId("timer-min").value = String(Math.floor(totalSec / 60));
  byId("timer-sec").value = String(totalSec % 60);
}

function applyTimerPresetSeconds(sec) {
  stopTimerBeeps();
  if (timerTickId !== null) {
    clearInterval(timerTickId);
    timerTickId = null;
  }
  timerRunning = false;
  timerFinished = false;
  timerTotalMs = sec * 1000;
  timerRemainingMs = timerTotalMs;
  syncTimerInputsFromMs(timerTotalMs);
  timerUpdateDisplay();
  byId("timer-status").textContent = "";
  byId("btn-timer-start").disabled = false;
  byId("btn-timer-pause").disabled = true;
}

function startFreeplay(type) {
  if (freeplayCleanup) {
    freeplayCleanup();
    freeplayCleanup = null;
  }
  const root = byId("freeplay-root");
  root.innerHTML = "";

  const onDone = () => {
    if (freeplayCleanup) {
      freeplayCleanup();
      freeplayCleanup = null;
    }
    root.innerHTML = '<p class="muted">Completed.</p>';
  };

  let countdownTeardown = null;
  let gameTeardown = null;
  const stop = () => {
    if (countdownTeardown) {
      countdownTeardown();
      countdownTeardown = null;
    }
    if (gameTeardown) {
      gameTeardown();
      gameTeardown = null;
    }
    root.innerHTML = "";
  };

  countdownTeardown = runGameStartCountdown(root, () => {
    countdownTeardown = null;
    switch (type) {
      case "math3":
        gameTeardown = mountQuickMath(root, onDone);
        break;
      case "memory4":
        gameTeardown = mountMemoryTap(root, onDone);
        break;
      case "flappy10":
      default:
        gameTeardown = mountFlappySprint(root, onDone);
        break;
    }
  });

  freeplayCleanup = stop;
}

function init() {
  const addAlarmButton = byId("btn-add-alarm");
  const form = byId("alarm-form");
  const modal = byId("alarm-modal");
  const alarmList = byId("alarm-items");
  const startChallengeButton = byId("btn-start-challenge");
  const snoozeButton = byId("btn-snooze-alarm");

  alarms = loadAlarms();

  document.querySelectorAll(".nav-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn instanceof HTMLElement && btn.dataset.page) {
        showPage(btn.dataset.page);
      }
    });
  });

  addAlarmButton.addEventListener("click", () => {
    editingAlarmId = null;
    openAlarmModal();
  });

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
    if (isRingModalOpen) snoozeActiveAlarm();
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

  alarmList.addEventListener("click", (e) => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    const row = target.closest("[data-alarm-id]");
    if (!(row instanceof HTMLElement)) return;
    const id = row.dataset.alarmId;
    if (!id) return;

    if (target.closest("[data-alarm-edit]")) {
      editingAlarmId = id;
      openAlarmModal();
      return;
    }
    if (!target.closest("[data-alarm-delete]")) return;

    alarms = alarms.filter((alarm) => alarm.id !== id);
    if (activeAlarmId === id) {
      dismissActiveAlarm();
    }
    saveAlarms();
    renderAlarms();
    updateHeaderStatus(new Date());
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const time = String(fd.get("time") || "").trim();
    const label = String(fd.get("label") || "").trim() || "Alarm";
    const minigame = String(fd.get("minigame") || "").trim() || "flappy10";

    if (!time) return;

    const safeMinigame = ["flappy10", "math3", "memory4", "none"].includes(
      minigame
    )
      ? minigame
      : "flappy10";

    if (editingAlarmId) {
      const alarm = alarms.find((item) => item.id === editingAlarmId);
      if (alarm) {
        alarm.time = time;
        alarm.label = label;
        alarm.minigame = safeMinigame;
      }
    } else {
      alarms.push({
        id: safeUuid(),
        time,
        label,
        minigame: safeMinigame,
        enabled: true,
        lastTriggeredDate: null,
        snoozeUntil: null,
      });
    }

    form.reset();
    saveAlarms();
    renderAlarms();
    closeAlarmModal();
    updateHeaderStatus(new Date());
  });

  startChallengeButton.addEventListener("click", startChallengeForActiveAlarm);
  snoozeButton.addEventListener("click", snoozeActiveAlarm);

  applyTimerPresetSeconds(300);

  byId("btn-sw-start").addEventListener("click", () => {
    if (swRunning) return;
    swStartPerf = performance.now();
    swRunning = true;
    byId("btn-sw-start").disabled = true;
    byId("btn-sw-pause").disabled = false;
    cancelAnimationFrame(swRaf);
    swLoop();
  });
  byId("btn-sw-pause").addEventListener("click", () => {
    if (!swRunning) return;
    swBaseElapsed += performance.now() - swStartPerf;
    swRunning = false;
    cancelAnimationFrame(swRaf);
    swUpdateDisplay();
    byId("btn-sw-start").disabled = false;
    byId("btn-sw-pause").disabled = true;
  });
  byId("btn-sw-reset").addEventListener("click", () => {
    swRunning = false;
    cancelAnimationFrame(swRaf);
    swBaseElapsed = 0;
    swLaps.length = 0;
    renderSwLaps();
    swUpdateDisplay();
    byId("btn-sw-start").disabled = false;
    byId("btn-sw-pause").disabled = true;
  });
  byId("btn-sw-lap").addEventListener("click", () => {
    swLaps.push(swCurrentMs());
    renderSwLaps();
  });
  swUpdateDisplay();

  document.querySelectorAll("[data-timer-preset]").forEach((b) => {
    b.addEventListener("click", () => {
      const s = Number(b.getAttribute("data-timer-preset"));
      if (Number.isFinite(s) && s > 0) applyTimerPresetSeconds(s);
    });
  });

  byId("btn-timer-start").addEventListener("click", () => {
    ensureAudioContext();
    stopTimerBeeps();
    if (timerRunning) return;
    if (timerFinished) {
      timerRemainingMs = timerTotalMs;
      timerFinished = false;
    } else if (timerRemainingMs <= 0) {
      const custom = readCustomTimerMs();
      if (custom <= 0) return;
      timerTotalMs = custom;
      timerRemainingMs = custom;
    }
    timerEndAt = Date.now() + timerRemainingMs;
    timerRunning = true;
    byId("btn-timer-start").disabled = true;
    byId("btn-timer-pause").disabled = false;
    byId("timer-status").textContent = "";
    if (timerTickId !== null) clearInterval(timerTickId);
    timerTickId = window.setInterval(timerTick, 50);
    timerTick();
  });

  byId("btn-timer-pause").addEventListener("click", () => {
    if (!timerRunning) return;
    timerRemainingMs = Math.max(0, timerEndAt - Date.now());
    timerRunning = false;
    if (timerTickId !== null) {
      clearInterval(timerTickId);
      timerTickId = null;
    }
    timerUpdateDisplay();
    byId("btn-timer-start").disabled = false;
    byId("btn-timer-pause").disabled = true;
  });

  byId("btn-timer-reset").addEventListener("click", () => {
    stopTimerBeeps();
    timerRunning = false;
    timerFinished = false;
    if (timerTickId !== null) {
      clearInterval(timerTickId);
      timerTickId = null;
    }
    timerRemainingMs = timerTotalMs;
    timerUpdateDisplay();
    byId("timer-status").textContent = "";
    byId("btn-timer-start").disabled = false;
    byId("btn-timer-pause").disabled = true;
  });

  [byId("timer-min"), byId("timer-sec")].forEach((el) => {
    el.addEventListener("input", () => {
      if (timerRunning) return;
      const ms = readCustomTimerMs();
      if (ms > 0) {
        timerTotalMs = ms;
        timerRemainingMs = ms;
        timerFinished = false;
        stopTimerBeeps();
        byId("timer-status").textContent = "";
        timerUpdateDisplay();
      }
    });
  });

  document.querySelectorAll("[data-freeplay]").forEach((b) => {
    b.addEventListener("click", () => {
      const t = b.getAttribute("data-freeplay");
      if (t) startFreeplay(t);
    });
  });

  showPage("alarms");
  renderAlarms();
  startClockLoop();
}

document.addEventListener("DOMContentLoaded", init);

