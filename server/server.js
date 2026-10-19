// Study Buddy Pet — local server.
// The desktop pet and the parent page talk to this server. It adds the tutor prompt, runs safety
// checks, enforces daily limits, stores quests and points, and is the only place that holds the
// Claude API key. It only listens on this computer (127.0.0.1).

import dotenv from 'dotenv';
import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkInput, cleanOutput, safetyReply } from './safety.js';
import * as store from './store.js';
import { createAuth } from './auth.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(ROOT, '.env'), quiet: true });

const PORT = Number(process.env.PORT) || 3000;
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5-5';
const DAILY_MESSAGE_LIMIT = Number(process.env.DAILY_MESSAGE_LIMIT) || 60;
// Local: listen only on this computer. Cloud: HOST=0.0.0.0 (set in render.yaml).
const HOST = process.env.HOST || '127.0.0.1';
const CLOUD = !['127.0.0.1', 'localhost', '::1'].includes(HOST);
const DEVICE_TOKEN = (process.env.DEVICE_TOKEN || '').trim();
const PARENT_PASSWORD = (process.env.PARENT_PASSWORD || process.env.PARENT_PIN || (CLOUD ? '' : '1234')).trim();
const auth = createAuth({
  parentEmail: process.env.PARENT_EMAIL,
  parentPassword: PARENT_PASSWORD,
  deviceToken: DEVICE_TOKEN,
  sessionSecret: process.env.SESSION_SECRET,
  cloud: CLOUD,
});

if (CLOUD && DEVICE_TOKEN.length < 16) {
  console.error('✖ DEVICE_TOKEN (16+ characters) is required when the server is public. Refusing to start.');
  process.exit(1);
}
const HAS_KEY = Boolean(process.env.ANTHROPIC_API_KEY?.trim());
const SAFETY_CHECK = (process.env.SAFETY_CHECK || 'on').toLowerCase() !== 'off';
const SAFETY_MODEL = process.env.SAFETY_MODEL || 'claude-haiku-5-5';

const ANIMATIONS = new Set(['experiment', 'encourage', 'celebrate', 'give-quest', 'thinking', 'idle', 'sleep', 'guard']);
const SAFETY_CATEGORIES = new Set(['self_harm', 'abuse', 'unsafe_situation', 'bullying', 'distress']);
const TUTOR_TEMPLATE = readFileSync(join(ROOT, 'prompts', 'tutor.md'), 'utf8');
const BREAKDOWN_TEMPLATE = readFileSync(join(ROOT, 'prompts', 'breakdown.md'), 'utf8');
const SAFETY_TEMPLATE = readFileSync(join(ROOT, 'prompts', 'safety-check.md'), 'utf8');

// Pictures arrive as data URLs from the pet (already scaled to ≤1568 px JPEG). Never stored.
const IMAGE_RE = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+=*)$/;
const MAX_IMAGE_CHARS = 5_000_000; // ≈3.7 MB of image data

const client = HAS_KEY ? new Anthropic() : null;

const SLEEP_REPLY = {
  reply: "We've done a lot of thinking today, hero! Let's rest and continue the quest tomorrow.",
  animation: 'sleep',
  hint_level: 0,
  safety_flag: false,
};

// ---------- helpers ----------

function studentInfo(student) {
  const grade = Math.min(12, Math.max(0, Number(student?.grade) || 5));
  const name = String(student?.name || 'Hero').slice(0, 40);
  return { grade, name, gradeLabel: grade === 0 ? 'K' : String(grade) };
}

function gradeGuide(grade) {
  if (grade <= 2) return 'Use very short sentences and simple words (1-2 sentences per reply). Be playful and gentle.';
  if (grade <= 5) return 'Use short, clear sentences (2-3 per reply). Explain new words when you use them.';
  if (grade <= 8) return 'Use clear, friendly language (up to 4 sentences). You can introduce proper subject terms.';
  return 'Talk to them like a capable teenager: concise, respectful, less cartoonish (up to 5 sentences).';
}

function questsForPrompt() {
  const open = store.openTasks();
  if (!open.length) return '(none)';
  return open
    .slice(0, 6)
    .map((t) => {
      const next = t.steps.find((s) => !s.done);
      return `- ${t.title}` + (next ? ` (next step: ${next.text})` : '');
    })
    .join('\n');
}

function buildTutorPrompt(student) {
  const s = studentInfo(student);
  return TUTOR_TEMPLATE.replaceAll('{{name}}', s.name)
    .replaceAll('{{grade}}', s.gradeLabel)
    .replaceAll('{{gradeGuide}}', gradeGuide(s.grade))
    .replaceAll('{{quests}}', questsForPrompt());
}

// Returns { messages } or { error }. A user message may carry one picture.
function cleanMessages(raw) {
  if (!Array.isArray(raw)) return { error: 'bad_request' };
  let msgs = [];
  for (const m of raw.slice(-12)) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') continue;
    const msg = { role: m.role, content: m.content.slice(0, 1000) };
    if (m.role === 'user' && m.image != null) {
      if (typeof m.image !== 'string') return { error: 'bad_image' };
      if (m.image.length > MAX_IMAGE_CHARS) return { error: 'image_too_large' };
      const match = IMAGE_RE.exec(m.image);
      if (!match) return { error: 'bad_image' };
      msg.image = { mediaType: match[1], data: match[2] };
    }
    if (msg.content.trim() || msg.image) msgs.push(msg);
  }
  while (msgs.length && msgs[0].role !== 'user') msgs = msgs.slice(1);
  if (!msgs.length || msgs.at(-1).role !== 'user') return { error: 'bad_request' };
  return { messages: msgs };
}

// Claude's message format: a picture becomes an image block before the text.
function toClaudeMessages(msgs) {
  return msgs.map((m) => {
    if (!m.image) return { role: m.role, content: m.content };
    return {
      role: m.role,
      content: [
        { type: 'image', source: { type: 'base64', media_type: m.image.mediaType, data: m.image.data } },
        { type: 'text', text: m.content.trim() || 'Here is a picture of my homework question.' },
      ],
    };
  });
}

function parseJsonObject(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function askClaude(system, messages, maxTokens, model = MODEL) {
  const result = await client.messages.create({ model, max_tokens: maxTokens, system, messages });
  return result.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

function sendClaudeError(res, err) {
  console.error('[claude]', err.status ?? '', err.message);
  if (err.status === 401) return res.status(500).json({ error: 'bad_api_key' });
  if (err.status === 404) return res.status(500).json({ error: 'model_not_found' });
  if (err.status === 429) return res.status(503).json({ error: 'rate_limited' });
  if (err instanceof Anthropic.APIConnectionError) return res.status(502).json({ error: 'claude_offline' });
  return res.status(502).json({ error: 'claude_error' });
}

// Layer 2 of the safety system: a small, separate Claude call that reads the student's recent
// messages and classifies risk. Runs in parallel with the tutor reply, so it adds no wait time.
// Returns { category, severity } or null if it is off or fails (the keyword check still applies).
async function aiSafetyCheck(msgs) {
  if (!client || !SAFETY_CHECK) return null;
  const recent = msgs
    .filter((m) => m.role === 'user')
    .slice(-3)
    .map((m) => (m.content.trim() || '') + (m.image ? ' [sent a picture]' : ''))
    .join('\n---\n');
  try {
    const text = await askClaude(
      SAFETY_TEMPLATE,
      [{ role: 'user', content: `Student messages, oldest first:\n${recent}` }],
      100,
      SAFETY_MODEL,
    );
    const out = parseJsonObject(text);
    if (!out || !SAFETY_CATEGORIES.has(out.category)) return { category: 'none', severity: 'none' };
    const severity = out.severity === 'high' ? 'high' : out.severity === 'watch' ? 'watch' : 'none';
    return { category: out.category, severity };
  } catch (err) {
    console.warn('[safety-check] skipped:', err.status ?? '', err.message);
    return null;
  }
}

function limitReached() {
  return store.messagesToday() >= DAILY_MESSAGE_LIMIT || store.usageStatus().overLimit;
}

function studentState() {
  return {
    tasks: store.listTasks(),
    points: store.getPoints(),
    settings: store.getSettings(),
    usage: store.usageStatus(),
    today: { focusSessions: store.todaySummary().focusSessions },
    exam: store.examPublic(),
  };
}

const EXAM_REPLY = {
  reply: "It's exam time, hero! I'm guarding the gate, so I can't help until it's over. Trust yourself, you've got this!",
  animation: 'guard',
  hint_level: 0,
  safety_flag: false,
};

// ---------- app ----------

const app = express();
app.set('trust proxy', 1); // behind the cloud host's proxy: real client IP + https detection
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});
app.use(express.json({ limit: '8mb' }));

app.get('/', (_req, res) => res.redirect('/parent/'));
app.get('/health', (_req, res) => res.json({ ok: true }));

// Everything the pet calls needs the device token (when one is set).
app.use(['/chat', '/state', '/tasks', '/focus', '/usage', '/exam'], auth.requireDevice);

// ---------- student: chat ----------

app.post('/chat', async (req, res) => {
  const { messages, error } = cleanMessages(req.body?.messages);
  if (error) return res.status(400).json({ error });
  const latestText = messages.at(-1).content;
  const caringReply = () => ({
    reply: safetyReply(latestText),
    animation: 'encourage',
    hint_level: 0,
    safety_flag: true,
  });

  // Layer 1: keyword check before anything leaves this computer.
  const keyword = checkInput(latestText);
  if (keyword.level === 'high') {
    store.recordFlag(keyword.category, 'keyword', 'high');
    return res.json(caringReply());
  }
  const flagged = new Set(); // categories already recorded for this message
  if (keyword.level === 'watch') {
    store.recordFlag(keyword.category, 'keyword', 'watch');
    flagged.add(keyword.category);
  }

  // Exam mode: no help with questions until the exam ends (checked here so no app can bypass it).
  if (store.getExam()) return res.json(EXAM_REPLY);

  // Daily limits (messages and screen time).
  if (limitReached()) return res.json(SLEEP_REPLY);
  if (!client) return res.status(500).json({ error: 'missing_api_key' });

  // Tutor reply and Layer 2 (AI safety check) run at the same time.
  const [tutor, check] = await Promise.all([
    askClaude(buildTutorPrompt(req.body?.student), toClaudeMessages(messages), 600).then(
      (text) => ({ text }),
      (err) => ({ err }),
    ),
    aiSafetyCheck(messages),
  ]);

  if (check?.severity === 'high') {
    store.recordFlag(check.category, 'ai_check', 'high');
    return res.json(caringReply());
  }
  if (check?.severity === 'watch' && !flagged.has(check.category)) {
    store.recordFlag(check.category, 'ai_check', 'watch');
    flagged.add(check.category);
  }
  if (tutor.err) return sendClaudeError(res, tutor.err);

  const out = parseJsonObject(tutor.text) ?? { reply: tutor.text, animation: 'experiment' };
  if (typeof out.reply !== 'string') out.reply = tutor.text;
  store.recordMessage(out.subject);
  // The tutor's own flag (it also sees pictures) counts only if nothing else flagged this message.
  if (out.safety_flag && flagged.size === 0) store.recordFlag('model_flag', 'tutor', 'watch');

  res.json({
    reply: cleanOutput(out.reply) || "Hmm, let's try that again. What part are you working on?",
    animation: ANIMATIONS.has(out.animation) ? out.animation : 'experiment',
    hint_level: Number(out.hint_level) || 0,
    safety_flag: Boolean(out.safety_flag) || flagged.size > 0,
  });
});

// ---------- student: quests, focus, screen time ----------

app.get('/state', (_req, res) => res.json(studentState()));

app.post('/tasks', (req, res) => {
  const title = String(req.body?.title ?? '').trim();
  if (!title) return res.status(400).json({ error: 'empty_title' });
  if (checkInput(title).level === 'high') return res.status(400).json({ error: 'unsafe' });
  store.addTask({ title, source: 'student' });
  res.json(studentState());
});

app.post('/tasks/:id/breakdown', async (req, res) => {
  const task = store.getTask(req.params.id);
  if (!task) return res.status(404).json({ error: 'not_found' });
  if (checkInput(task.title).level === 'high') return res.status(400).json({ error: 'unsafe' });
  if (store.getExam()) return res.status(423).json({ error: 'exam_mode' });
  if (limitReached()) return res.status(429).json({ error: 'daily_limit' });
  if (!client) return res.status(500).json({ error: 'missing_api_key' });

  try {
    const { gradeLabel } = studentInfo(req.body?.student);
    const system = BREAKDOWN_TEMPLATE.replaceAll('{{grade}}', gradeLabel);
    const text = await askClaude(system, [{ role: 'user', content: `Quest: ${task.title}` }], 400);
    store.recordMessage(null);
    const steps = (parseJsonObject(text)?.steps ?? [])
      .filter((s) => typeof s === 'string' && s.trim())
      .map((s) => cleanOutput(s).slice(0, 100))
      .slice(0, 6);
    if (steps.length < 2) return res.status(422).json({ error: 'no_steps' });
    store.setSteps(task.id, steps);
    res.json(studentState());
  } catch (err) {
    sendClaudeError(res, err);
  }
});

app.post('/tasks/:id/steps/:stepId/toggle', (req, res) => {
  const result = store.toggleStep(req.params.id, req.params.stepId);
  if (!result) return res.status(404).json({ error: 'not_found' });
  res.json({ ...studentState(), result });
});

app.post('/tasks/:id/complete', (req, res) => {
  const result = store.setTaskDone(req.params.id, req.body?.done !== false);
  if (!result) return res.status(404).json({ error: 'not_found' });
  res.json({ ...studentState(), result });
});

app.post('/focus/complete', (_req, res) => {
  const result = store.recordFocus();
  res.json({ ...studentState(), result });
});

// ---------- exam mode (pet + Chrome extension) ----------

app.get('/exam', (_req, res) => res.json(store.examPublic()));

// The extension reports counts only: { type: 'blocked' | 'tab_switch' | 'left_browser', count }
app.post('/exam/event', (req, res) => {
  store.recordExamEvent(String(req.body?.type ?? ''), req.body?.count);
  res.json(store.examPublic());
});

app.post('/usage/heartbeat', (_req, res) => {
  store.addUsageMinute();
  res.json(studentState());
});

// ---------- parent page & API (login required) ----------

app.use('/parent', express.static(join(ROOT, 'public'), { index: 'parent.html' }));
app.use('/api/parent', auth.sameOrigin);

app.get('/api/parent/config', (_req, res) => {
  res.json({ emailRequired: auth.emailRequired, loginEnabled: auth.loginEnabled, cloud: CLOUD });
});
app.post('/api/parent/login', (req, res) => auth.login(req, res));
app.post('/api/parent/logout', (req, res) => auth.logout(req, res));

const requireParent = auth.requireParent;

app.get('/api/parent/summary', requireParent, (_req, res) => {
  res.json({
    today: store.todaySummary(),
    usage: store.usageStatus(),
    settings: store.getSettings(),
    points: store.getPoints(),
    tasks: store.listTasks(),
    week: store.recentDays(7),
    exam: store.examPublic(),
    examHistory: store.examHistory(10),
  });
});

app.post('/api/parent/tasks', requireParent, (req, res) => {
  const title = String(req.body?.title ?? '').trim();
  if (!title) return res.status(400).json({ error: 'empty_title' });
  res.json(store.addTask({ title, source: 'parent' }));
});

app.delete('/api/parent/tasks/:id', requireParent, (req, res) => {
  res.json({ ok: store.deleteTask(req.params.id) });
});

app.post('/api/parent/exam/start', requireParent, (req, res) => {
  store.startExam(req.body?.minutes);
  res.json(store.examPublic());
});

app.post('/api/parent/exam/stop', requireParent, (_req, res) => {
  store.stopExam();
  res.json(store.examPublic());
});

app.put('/api/parent/settings', requireParent, (req, res) => {
  res.json(store.updateSettings(req.body ?? {}));
});

// ---------- start ----------

const storage = await store.initStore();

const server = app.listen(PORT, HOST, () => {
  console.log(`Study Buddy server running on ${HOST}:${PORT} (${CLOUD ? 'cloud' : 'local'} mode)`);
  if (!CLOUD) console.log(`Parent page: http://localhost:${PORT}/parent`);
  console.log(`Storage: ${storage}`);
  console.log(`Model: ${MODEL} · Daily limit: ${DAILY_MESSAGE_LIMIT} messages`);
  console.log(`AI safety check: ${SAFETY_CHECK ? `on (${SAFETY_MODEL})` : 'off'}`);
  console.log(`Pet device token: ${DEVICE_TOKEN ? 'required' : 'not required (local only)'}`);
  if (!HAS_KEY) console.warn('⚠ No ANTHROPIC_API_KEY found. Copy .env.example to .env and add your key.');
  if (!auth.loginEnabled) console.warn('⚠ Parent login is off: set PARENT_PASSWORD (8+ characters) in the environment.');
  else if (!CLOUD && PARENT_PASSWORD === '1234') console.warn('⚠ Parent password is the default 1234 (local only).');
  if (CLOUD && !process.env.DATABASE_URL) console.warn('⚠ No DATABASE_URL: data will be lost when the server restarts.');
});

// Save pending changes before the host stops or restarts the server.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.close();
    store.closeStore().finally(() => process.exit(0));
  });
}
