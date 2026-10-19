# Study Buddy Pet

A desktop pet learning companion for K-12 students, connected to Claude. Course project MVP.

- **Product flow & build steps:** [`docs/product-flow-and-build-plan.md`](docs/product-flow-and-build-plan.md)
- **Placeholder character:** [`art/placeholder/`](art/placeholder/) — swap in final art later, same grid layout

> Character note: the concept uses Princess Bubblegum for course demonstration only. Not for distribution.

## Folders

| Folder | What goes here | Status |
| --- | --- | --- |
| `docs/` | Plans, assignment notes, demo materials | ✅ |
| `art/` | Character art and sprite sheets | ✅ placeholder |
| `app/` | Electron desktop pet: chat, quests, focus timer | ✅ Phases 1–3 |
| `server/` | Backend: Claude API, quests, points, limits, parent page | ✅ Phases 2–3 |
| `extension/` | Chrome extension: exam mode (pause sites, count tab switches) | ✅ Phase 4 |

## Run it (macOS)

You need [Node.js](https://nodejs.org) 20 or newer. Check with `node -v` in Terminal.

### 1. Start the server (needs your Claude API key)

```bash
cd ~/Desktop/study-buddy-pet/server
cp .env.example .env        # then open .env and paste your key after ANTHROPIC_API_KEY=
npm install                 # first time only
npm start
```

Leave this Terminal window open. You should see `Study Buddy server running at http://localhost:3000`.

### 2. Start the desktop pet (in a second Terminal window)

```bash
cd ~/Desktop/study-buddy-pet/app
npm install                 # first time only, downloads Electron (~100 MB)
npm start
```

The pet appears in the bottom-right corner of your screen.

### Using the pet

| Action | What happens |
| --- | --- |
| Click the pet | Open / close the panel |
| Drag the pet | Move it anywhere |
| Right-click the pet | Menu: parent page, test each animation, dev tools, quit |
| Chat tab | Ask questions; the buddy guides with hints, never gives answers |
| 📎 / paste / drag a picture | Send a photo or screenshot of a homework question |
| ✂ Snip | Hide the pet, drag a box around a question on screen, send it (Esc cancels) |
| Quests tab | See quests, add your own, "Break it into steps", check off steps |
| Focus tab | Focus timer (default 25 min) then an automatic break (5 min) |
| Drag the panel's top-left corner | Make the panel bigger or smaller (double-click it to reset) |
| Enter / Esc | Send message / close panel |

Stars: finishing a quest = 10 + 2 per step, finishing a focus round = 5.

The pet works without the server too (animations, dragging); it just can't chat or load quests.

### Parent page

Open <http://localhost:3000/parent> (or right-click the pet → Parent page). Sign in with `PARENT_PASSWORD` from `server/.env` (default `1234` locally; `PARENT_EMAIL` is optional).

**Online version:** to let parents sign in from anywhere, deploy the server to Render + Neon. See [`docs/deploy-cloud.md`](docs/deploy-cloud.md). The pet then connects to the cloud using `app/config.local.json` (server URL + device token).

Parents can add/remove quests, set the daily screen-time limit and timer lengths, see today's numbers, safety alerts and the last 7 days. When screen time runs out, the pet goes to sleep and stops chatting until tomorrow.

**Snip needs Screen Recording permission (macOS, one time):** the first time you snip, macOS asks for permission, or the pet says it needs it. Open System Settings → Privacy & Security → Screen & System Audio Recording, turn on **Electron**, then quit and restart the pet.

### Exam mode

A grown-up starts exam mode on the parent page (15 min to 2 h). The pet guards the gate (chat, pictures and the focus timer pause), the Chrome extension pauses sites on the parent's list and counts paused visits, tab switches and times Chrome loses focus. Numbers only, no URLs or screenshots, and the child sees the same record. Setup and testing: [`docs/exam-mode.md`](docs/exam-mode.md).

### Safety alerts

Every chat message goes through two checks:

1. **Keyword check** (English + Chinese, runs locally first). Urgent words (self-harm, someone hurting them) get a fixed caring reply that points to a trusted adult and 988, and the message is never sent to the tutor. Bullying words are flagged but the buddy keeps helping.
2. **AI safety check** (`SAFETY_MODEL`, runs at the same time as the tutor reply). Catches things keywords miss, ignores figures of speech like "this homework is killing me", and sorts alerts into *Urgent* or *Keep an eye*.

The tutor can also flag something it notices (for example in a picture). The parent page lists each alert with its time, type and which check caught it, never the child's words.

### Settings

- `app/config.json`: student name and grade, pet size (`scale`), animation speed (`fps`), which art folder to use (`petDir`)
- `server/.env`: model, daily message limit, port, parent PIN, AI safety check (`SAFETY_CHECK`, `SAFETY_MODEL`)
- `server/prompts/safety-check.md`: what the AI safety check looks for
- `server/prompts/tutor.md`: how the buddy teaches and talks
- `server/prompts/breakdown.md`: how quests are split into steps

### Privacy note

`server/data/db.json` stores quests, points, settings, and per-day counts (screen minutes, questions, subjects, focus rounds, safety-flag categories). It never stores what the student typed or the pictures they send (pictures are only passed to Claude for that reply). The server only listens on this computer.
