# Better Alarm

Website prototype for an alarm app that (eventually) requires completing a short minigame to dismiss the alarm.

## Current scope

- Single-page layout scaffold (HTML/CSS)
- Minimal view switching wiring (vanilla JS)
- **No real alarm scheduling, sound, storage, or minigame logic yet**

## Project structure

- `index.html`: App shell and placeholder sections (list, form, minigame)
- `styles.css`: Basic layout and component styling
- `app.js`: Small skeleton for view switching and future hooks

## Plan (next steps)

- **Alarm data model**
  - Define an alarm object shape: `id`, `time`, `label`, `enabled`, `days`, `minigameType`, etc.
  - Render the alarm list from state.
- **Persistence**
  - Save and load alarms via `localStorage`.
- **Alarm scheduling (prototype)**
  - Track next firing time per enabled alarm.
  - Trigger the “ringing” state and show the minigame view.
  - Note: browsers have limitations in background tabs/sleep; this is a prototype constraint.
- **Minigame system**
  - Create a small minigame interface/contract (e.g., `mount(root, ctx)` and `destroy()`).
  - Implement a first minigame (e.g., quick reaction, matching, or short memory).
- **UX improvements**
  - Better time display, next alarm indicator, and states (idle/ringing/snoozed).

## Run locally

Open the file directly:

- Double-click `index.html`, or run:

```bash
open index.html
```

For fewer browser restrictions, run a tiny local server:

```bash
python3 -m http.server 5173
```

Then visit `http://localhost:5173`.

