# Better Alarm

Web prototype for an alarm app: alarms with optional minigames to dismiss, plus stopwatch, timer, and practice minigames.

## Features

### Alarms

- Create, **edit**, delete, and toggle alarms; list shows next snooze state when applicable.
- Alarms persist in **`localStorage`** (`better-alarm.alarms.v1`).
- Firing uses the **browser clock** (minute precision for scheduled time; snooze uses exact timestamps).
- **Snooze 5 minutes** from the ringing modal.
- **Difficulty** (per alarm, for minigames): **Easy**, **Normal**, **Hard** — see table below.
- **Minigames** (or **No Game** with direct dismiss):
  - **Flappy Sprint** — gates and lives scale with difficulty.
  - **Quick Math** — required “points” scale with difficulty; **streak rules** on Normal/Hard (see below).
  - **Memory Tap** — number of rounds scales with difficulty.
- After **Start Challenge**, games begin after a **1–2 second** countdown.

### Difficulty scaling (minigames)

**Normal** is the baseline. **Easy** uses ≈ **0.75×** normal for gates, lives, math points, and memory rounds (rounded, minimum 1). **Hard** is **2× easy** (same as **1.5× normal** for those lengths).

|        | Flappy gates / lives | Math points | Memory rounds | Math streak |
| ------ | -------------------- | ----------- | --------------- | ----------- |
| Easy   | 6 / 3                | 6           | 5               | None (each correct +1) |
| Normal | 8 / 4                | 8           | 6               | **2** correct in a row → +1 point |
| Hard   | 12 / 6               | 12          | 10              | **3** correct in a row → +1 point |

Wrong answers on Easy can still reduce your solved count. On Normal/Hard, a wrong answer **resets the streak** (points already earned stay).

### Stopwatch

- **Start / Pause / Reset / Lap**.
- Display: **`HH:MM:SS.mmm`**.

### Timer

- **Presets:** 1 min, 5 min, 10 min, 15 min, 30 min, **1 hour**.
- Custom minutes + seconds; default on load **5 minutes**.

### Minigames (practice)

- Choose **Difficulty** above the game cards; **Play** uses the same rules as alarms.

## Project structure

| File         | Role                                               |
| ------------ | -------------------------------------------------- |
| `index.html` | Shell, nav, alarms / stopwatch / timer / minigames |
| `styles.css` | Layout, modals, games, tools                       |
| `app.js`     | Alarms, storage, scheduling, games, difficulty     |

## Run locally

```bash
open index.html
```

Or:

```bash
python3 -m http.server 5173
```

Then open `http://localhost:5173`.

## Limitations

- **Background tabs / sleep:** timers and alarms may be throttled.
- **Audio** may need a user gesture before beeps play reliably.

## Future ideas

- Repeat / weekdays, per-alarm sounds, more streak feedback, PWA/offline.
