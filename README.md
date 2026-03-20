# Better Alarm

Web prototype for an alarm app: alarms with optional minigames to dismiss, plus stopwatch, timer, and practice minigames.

## Features

### Alarms

- Create, **edit**, delete, and toggle alarms; list shows next snooze state when applicable.
- Alarms persist in **`localStorage`** (`better-alarm.alarms.v1`).
- Firing uses the **browser clock** (minute precision for scheduled time; snooze uses exact timestamps).
- **Snooze 5 minutes** from the ringing modal.
- **Minigames** (or **No Game** with direct dismiss):
  - **Flappy Sprint** — pass **5 gates**, **3 lives**, short invulnerability after losing a life; **progress** shows gates cleared.
  - **Quick Math** — **5** correct answers; heavier weight on **multiplication** with larger operands; **progress** shows `Correct: n/5`.
  - **Memory Tap** — pattern rounds with black tiles that **light** for the sequence; **progress** shows `Round n/4`.
- After **Start Challenge**, games begin after a **1–2 second** countdown (not instant).

### Stopwatch

- **Start / Pause / Reset / Lap**.
- Display uses **milliseconds** (`HH:MM:SS.mmm`), not centiseconds.

### Timer

- **Presets:** 1 min, 5 min, 10 min, 15 min, 30 min, **1 hour**.
- Custom **minutes + seconds** (updates duration while idle).
- Start / Pause / Reset; when finished, repeating **beep** until reset or start again.

### Minigames (practice)

- **Play** any minigame without an alarm; same rules and **countdown** before play.

## Project structure

| File        | Role                                                |
| ----------- | --------------------------------------------------- |
| `index.html`| Shell, nav, alarms / stopwatch / timer / minigames  |
| `styles.css`| Layout, modals, games, timer/stopwatch UI           |
| `app.js`    | Alarms, storage, scheduling, games, tools             |

## Run locally

Open the file directly:

```bash
open index.html
```

Or serve locally:

```bash
python3 -m http.server 5173
```

Then open `http://localhost:5173`.

## Limitations

- **Background tabs / sleep:** timers and alarms may be throttled; this is a browser prototype, not a native alarm.
- **Audio** may require a user gesture (e.g. opening a modal or starting the stopwatch) before beeps play reliably.

## Future ideas

- Repeat / weekday schedules, alarm sounds per alarm, snooze presets, PWA/offline, true fullscreen alarm UI.
