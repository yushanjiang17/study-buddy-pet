// Store for quests, points, settings and per-day counts. Never stores the text of chat messages.
// The whole state is one small JSON document, kept in memory and saved to:
//   - server/data/db.json on this computer (default), or
//   - a Postgres table when DATABASE_URL is set (cloud: the host's own disk is wiped on restart).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), 'data');
const DB_FILE = join(DATA_DIR, 'db.json');
const OLD_USAGE_FILE = join(DATA_DIR, 'usage.json'); // Phase 2 format, imported once

export const SUBJECTS = ['math', 'reading', 'writing', 'science', 'social_studies', 'other'];
// Sites paused during exam mode: distractions plus AI / answer sites. Parents can edit the list.
export const DEFAULT_EXAM_BLOCKLIST = [
  'youtube.com',
  'tiktok.com',
  'instagram.com',
  'snapchat.com',
  'roblox.com',
  'netflix.com',
  'twitch.tv',
  'discord.com',
  'reddit.com',
  'chatgpt.com',
  'openai.com',
  'claude.ai',
  'gemini.google.com',
  'copilot.microsoft.com',
  'perplexity.ai',
  'character.ai',
  'poe.com',
  'deepseek.com',
  'photomath.com',
  'gauthmath.com',
  'brainly.com',
  'chegg.com',
];
const DEFAULT_SETTINGS = { dailyMinutes: 60, focusMinutes: 25, breakMinutes: 5, examBlockList: DEFAULT_EXAM_BLOCKLIST };
const EXAM_EVENTS = ['blocked', 'tab_switch', 'left_browser'];
const KEEP_EXAMS = 20;
const KEEP_DONE_DAYS = 14;

let db = null;

// ---------- dates ----------

export function localDate(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const today = () => localDate();

// ---------- backends ----------

const fileBackend = {
  name: 'file (server/data/db.json)',
  async read() {
    if (existsSync(DB_FILE)) return JSON.parse(readFileSync(DB_FILE, 'utf8'));
    if (existsSync(OLD_USAGE_FILE)) return { days: JSON.parse(readFileSync(OLD_USAGE_FILE, 'utf8')) };
    return null;
  },
  async write(data) {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
  },
};

async function postgresBackend(url) {
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  const strict = process.env.DATABASE_SSL === 'verify';
  // SSL is configured below, so drop the URL's own SSL options (Neon adds sslmode and channel_binding).
  const cleanUrl = new URL(url);
  cleanUrl.searchParams.delete('sslmode');
  cleanUrl.searchParams.delete('channel_binding');
  const pool = new pg.Pool({
    connectionString: cleanUrl.toString(),
    ssl: local ? false : { rejectUnauthorized: strict },
    max: 3,
  });
  await pool.query(`create table if not exists study_buddy_state (
    id integer primary key,
    data jsonb not null,
    updated_at timestamptz not null default now()
  )`);
  return {
    name: 'postgres',
    async read() {
      const r = await pool.query('select data from study_buddy_state where id = 1');
      return r.rows[0]?.data ?? null;
    },
    async write(data) {
      await pool.query(
        `insert into study_buddy_state (id, data) values (1, $1)
         on conflict (id) do update set data = excluded.data, updated_at = now()`,
        [JSON.stringify(data)],
      );
    },
    close: () => pool.end(),
  };
}

let backend = fileBackend;

// ---------- load / save ----------

// Must be awaited once before the server starts.
export async function initStore() {
  if (process.env.DATABASE_URL) backend = await postgresBackend(process.env.DATABASE_URL);
  db = { days: {}, tasks: [], points: 0, settings: { ...DEFAULT_SETTINGS } };
  try {
    Object.assign(db, (await backend.read()) ?? {});
  } catch (err) {
    if (backend !== fileBackend) throw err; // a broken database connection should stop the server
    console.warn('[store] db.json could not be read; starting fresh.');
  }
  db.settings = { ...DEFAULT_SETTINGS, ...db.settings };
  db.tasks ??= [];
  db.days ??= {};
  db.exam ??= null; // the exam running right now, or null
  db.examHistory ??= [];
  // Drop quests finished more than two weeks ago.
  const cutoff = Date.now() - KEEP_DONE_DAYS * 864e5;
  db.tasks = db.tasks.filter((t) => !t.done || new Date(t.completedAt).getTime() > cutoff);
  return backend.name;
}

function load() {
  if (!db) throw new Error('initStore() was not called');
  return db;
}

// Writes are batched: many changes within a second become one save.
let saveTimer = null;
let saving = Promise.resolve();

function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(flush, backend === fileBackend ? 0 : 1000);
}

export function flush() {
  clearTimeout(saveTimer);
  saveTimer = null;
  const snapshot = structuredClone(db);
  saving = saving
    .then(() => backend.write(snapshot))
    .catch((err) => console.error('[store] save failed:', err.message));
  return saving;
}

export async function closeStore() {
  await flush();
  await backend.close?.();
}

function dayRec(date = today()) {
  load();
  const d = (db.days[date] ??= {});
  d.messages ??= 0;
  d.safetyFlags ??= [];
  d.usageMinutes ??= 0;
  d.focusSessions ??= 0;
  d.tasksCompleted ??= 0;
  d.pointsEarned ??= 0;
  d.subjects ??= {};
  return d;
}

// ---------- chat usage & safety ----------

export function messagesToday() {
  return dayRec().messages;
}

export function recordMessage(subject) {
  const d = dayRec();
  d.messages += 1;
  if (SUBJECTS.includes(subject)) d.subjects[subject] = (d.subjects[subject] ?? 0) + 1;
  save();
}

export function recordFlag(category, source, severity = 'watch') {
  dayRec().safetyFlags.push({ time: new Date().toISOString(), category, source, severity });
  save();
}

// ---------- screen time ----------

export function addUsageMinute() {
  const d = dayRec();
  d.usageMinutes += 1;
  save();
  return usageStatus();
}

export function usageStatus() {
  const minutesUsed = dayRec().usageMinutes;
  const { dailyMinutes } = load().settings;
  return { minutesUsed, dailyMinutes, overLimit: dailyMinutes > 0 && minutesUsed >= dailyMinutes };
}

// ---------- settings ----------

export function getSettings() {
  return { ...load().settings };
}

export function updateSettings(patch) {
  load();
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(v))));
  if (patch.dailyMinutes !== undefined) db.settings.dailyMinutes = clamp(patch.dailyMinutes, 0, 600);
  if (patch.focusMinutes !== undefined) db.settings.focusMinutes = clamp(patch.focusMinutes, 5, 60);
  if (patch.breakMinutes !== undefined) db.settings.breakMinutes = clamp(patch.breakMinutes, 1, 30);
  if (patch.examBlockList !== undefined) db.settings.examBlockList = cleanDomains(patch.examBlockList);
  save();
  return getSettings();
}

// Accepts "https://www.YouTube.com/watch?x" style input and keeps just "youtube.com".
export function cleanDomains(list) {
  const raw = Array.isArray(list) ? list : String(list ?? '').split(/[\s,]+/);
  const out = new Set();
  for (const item of raw) {
    let d = String(item).trim().toLowerCase();
    if (!d) continue;
    d = d.replace(/^[a-z]+:\/\//, '').split(/[/?#:]/)[0].replace(/^www\./, '').replace(/\.$/, '');
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d) && d.length <= 100) out.add(d);
  }
  return [...out].slice(0, 100);
}

// ---------- exam mode ----------
// Only counts are kept: how many blocked visits, tab switches and times Chrome lost focus.
// No URLs, page content or screenshots.

function finishExam(endedBy) {
  const e = db.exam;
  if (!e) return null;
  const endedAt = endedBy === 'timer' ? e.endsAt : new Date().toISOString();
  const record = { ...e, endedAt, endedBy };
  db.examHistory.unshift(record);
  db.examHistory = db.examHistory.slice(0, KEEP_EXAMS);
  db.exam = null;
  save();
  return record;
}

// The current exam (ends it automatically once its time is up).
export function getExam() {
  load();
  if (db.exam && Date.parse(db.exam.endsAt) <= Date.now()) finishExam('timer');
  return db.exam;
}

export function lastExam() {
  getExam();
  return db.examHistory[0] ?? null;
}

export function examHistory(n = 10) {
  getExam();
  return db.examHistory.slice(0, n);
}

export function startExam(minutes) {
  if (getExam()) finishExam('restarted');
  const mins = Math.min(240, Math.max(5, Math.round(Number(minutes) || 45)));
  const now = Date.now();
  db.exam = {
    id: newId(),
    startedAt: new Date(now).toISOString(),
    endsAt: new Date(now + mins * 60e3).toISOString(),
    minutes: mins,
    events: { blocked: 0, tab_switch: 0, left_browser: 0 },
  };
  save();
  return db.exam;
}

export function stopExam() {
  if (!getExam()) return null;
  return finishExam('parent');
}

export function recordExamEvent(type, count = 1) {
  const exam = getExam();
  if (!exam || !EXAM_EVENTS.includes(type)) return exam;
  exam.events[type] += Math.min(50, Math.max(1, Math.round(Number(count) || 1)));
  save();
  return exam;
}

export function examPublic() {
  const exam = getExam();
  return {
    active: Boolean(exam),
    startedAt: exam?.startedAt ?? null,
    endsAt: exam?.endsAt ?? null,
    events: exam?.events ?? null,
    blockList: load().settings.examBlockList,
    lastResult: db.examHistory[0] ?? null,
  };
}

// ---------- quests ----------

const newId = () => randomUUID().slice(0, 8);

export function listTasks() {
  const t = today();
  return load()
    .tasks.filter((task) => !task.done || localDate(new Date(task.completedAt)) === t)
    .sort((a, b) => Number(a.done) - Number(b.done) || a.createdAt.localeCompare(b.createdAt));
}

export function openTasks() {
  return load().tasks.filter((t) => !t.done);
}

export function getTask(id) {
  return load().tasks.find((t) => t.id === id) ?? null;
}

export function addTask({ title, source }) {
  load();
  const task = {
    id: newId(),
    title: String(title).trim().slice(0, 120),
    source: source === 'parent' ? 'parent' : 'student',
    createdAt: new Date().toISOString(),
    steps: [],
    done: false,
    completedAt: null,
    pointsAwarded: 0,
  };
  db.tasks.push(task);
  save();
  return task;
}

export function deleteTask(id) {
  load();
  const before = db.tasks.length;
  db.tasks = db.tasks.filter((t) => t.id !== id);
  save();
  return db.tasks.length < before;
}

export function setSteps(id, steps) {
  const task = getTask(id);
  if (!task) return null;
  if (task.done) markDone(task, false);
  task.steps = steps.map((text) => ({ id: newId(), text, done: false }));
  save();
  return task;
}

// Marks a quest done/undone and moves its points in or out. Returns what changed.
function markDone(task, done) {
  if (done && !task.done) {
    const award = 10 + 2 * task.steps.length;
    task.done = true;
    task.completedAt = new Date().toISOString();
    task.pointsAwarded = award;
    db.points += award;
    const d = dayRec();
    d.tasksCompleted += 1;
    d.pointsEarned += award;
    return { completedNow: true, award };
  }
  if (!done && task.done) {
    const d = dayRec(localDate(new Date(task.completedAt)));
    d.tasksCompleted = Math.max(0, d.tasksCompleted - 1);
    d.pointsEarned = Math.max(0, d.pointsEarned - task.pointsAwarded);
    db.points = Math.max(0, db.points - task.pointsAwarded);
    task.done = false;
    task.completedAt = null;
    task.pointsAwarded = 0;
    return { reopenedNow: true };
  }
  return {};
}

export function toggleStep(id, stepId) {
  const task = getTask(id);
  const step = task?.steps.find((s) => s.id === stepId);
  if (!step) return null;
  step.done = !step.done;
  const change = markDone(task, task.steps.every((s) => s.done));
  save();
  return { task, stepDone: step.done, ...change, points: db.points };
}

export function setTaskDone(id, done) {
  const task = getTask(id);
  if (!task) return null;
  if (task.steps.length) task.steps.forEach((s) => (s.done = Boolean(done)));
  const change = markDone(task, Boolean(done));
  save();
  return { task, ...change, points: db.points };
}

// ---------- focus & points ----------

export function recordFocus() {
  load();
  const d = dayRec();
  d.focusSessions += 1;
  d.pointsEarned += 5;
  db.points += 5;
  save();
  return { focusSessions: d.focusSessions, points: db.points, award: 5 };
}

export function getPoints() {
  return load().points;
}

// ---------- summaries ----------

export function todaySummary() {
  const d = dayRec();
  return {
    date: today(),
    usageMinutes: d.usageMinutes,
    messages: d.messages,
    focusSessions: d.focusSessions,
    tasksCompleted: d.tasksCompleted,
    pointsEarned: d.pointsEarned,
    subjects: d.subjects,
    safetyFlags: d.safetyFlags,
  };
}

export function recentDays(n = 7) {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const date = localDate(new Date(Date.now() - i * 864e5));
    const d = load().days[date] ?? {};
    out.push({
      date,
      usageMinutes: d.usageMinutes ?? 0,
      messages: d.messages ?? 0,
      focusSessions: d.focusSessions ?? 0,
      tasksCompleted: d.tasksCompleted ?? 0,
      safetyFlags: (d.safetyFlags ?? []).length,
    });
  }
  return out;
}
