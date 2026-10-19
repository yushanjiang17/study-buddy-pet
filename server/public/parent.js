// Parent page: PIN unlock, today's summary, safety alerts, quests, settings, last 7 days.

const $ = (id) => document.getElementById(id);
let signedIn = false;

const FLAG_LABELS = {
  self_harm: 'Said something about hurting themselves',
  abuse: 'Said someone may be hurting them',
  unsafe_situation: 'May be in an unsafe situation',
  bullying: 'Mentioned being bullied',
  distress: 'Seemed very sad or upset',
  model_flag: 'Study Buddy noticed a sensitive topic',
};
const SOURCE_LABELS = { keyword: 'keyword check', ai_check: 'AI safety check', tutor: 'tutor', input: 'keyword check', model: 'tutor' };
const SUBJECT_LABELS = {
  math: 'math',
  reading: 'reading',
  writing: 'writing',
  science: 'science',
  social_studies: 'social studies',
  other: 'other',
};

// The login is a secure cookie set by the server; the page never stores the password.
async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && path !== '/api/parent/login') {
    showLogin();
    throw new Error('login_required');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `http_${res.status}`), { code: data.error });
  return data;
}

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children);
  return node;
}

const fmtMin = (m) => (m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`);
const fmtTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const fmtDate = (d) =>
  new Date(d + 'T12:00:00').toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });

// ---------- sign in / out ----------

const LOGIN_ERRORS = {
  bad_login: "That email or password didn't work.",
  too_many_attempts: 'Too many tries. Please wait 15 minutes and try again.',
  login_disabled: 'Sign-in is turned off: the server needs a PARENT_PASSWORD of at least 8 characters.',
};

function showLogin() {
  signedIn = false;
  $('dash').hidden = true;
  $('logout').hidden = true;
  $('login').hidden = false;
  $('password').focus();
}

function showDashboard() {
  signedIn = true;
  $('login').hidden = true;
  $('dash').hidden = false;
  $('logout').hidden = false;
}

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('login-error');
  err.hidden = true;
  try {
    await api('POST', '/api/parent/login', { email: $('email').value, password: $('password').value });
    $('password').value = '';
    showDashboard();
    refresh();
  } catch (error) {
    err.textContent = LOGIN_ERRORS[error.code] ?? "Couldn't sign in. Is the server running?";
    err.hidden = false;
  }
});

$('logout').addEventListener('click', async () => {
  await api('POST', '/api/parent/logout').catch(() => {});
  showLogin();
});

// ---------- render ----------

function renderStats(data) {
  const { today, usage } = data;
  const limit = usage.dailyMinutes;
  $('s-time').textContent = limit ? `${fmtMin(usage.minutesUsed)} / ${limit} min` : fmtMin(usage.minutesUsed);
  const bar = $('s-time-bar');
  bar.style.width = limit ? `${Math.min(100, (usage.minutesUsed / limit) * 100)}%` : '0';
  bar.classList.toggle('over', usage.overLimit);
  $('s-tasks').textContent = today.tasksCompleted;
  $('s-focus').textContent = today.focusSessions;
  $('s-msgs').textContent = today.messages;
  const subjects = Object.entries(today.subjects)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${SUBJECT_LABELS[k] ?? k} ${v}`);
  $('s-subjects').textContent = subjects.join(' · ');
}

function howAlertsWork() {
  const d = el('details', { className: 'how' });
  d.append(
    el('summary', { textContent: 'How are alerts triggered?' }),
    el('p', {
      textContent:
        'Every message your child sends goes through two checks. 1) A keyword check (English and Chinese) runs on this ' +
        'computer first. 2) A separate AI safety check reads their last few messages and catches things keywords miss. ' +
        'Urgent alerts (self-harm, someone hurting them, unsafe situations): the buddy does not continue the lesson. It ' +
        'gives a caring reply that points them to a trusted adult and 988. "Keep an eye" alerts (bullying, very sad or ' +
        'upset): the buddy keeps helping and responds kindly. Figures of speech like "this homework is killing me" are ' +
        "ignored. Checks can miss things or be wrong, so they don't replace talking with your child.",
    }),
  );
  return d;
}

function renderAlerts(flags) {
  const box = $('alerts');
  box.replaceChildren();
  const urgent = flags.filter((f) => f.severity === 'high' || (!f.severity && ['self_harm', 'abuse'].includes(f.category)));
  box.classList.toggle('has-alerts', flags.length > 0);
  box.classList.toggle('urgent', urgent.length > 0);
  if (!flags.length) {
    box.append(el('h2', { textContent: 'Safety alerts' }), el('p', { textContent: 'No safety alerts today.' }), howAlertsWork());
    return;
  }
  box.append(
    el('h2', {
      textContent: urgent.length
        ? `Safety alerts today (${flags.length}) · ${urgent.length} urgent`
        : `Safety alerts today (${flags.length})`,
    }),
    el('p', {
      textContent: urgent.length
        ? 'Please check in with your child soon. Study Buddy gave a caring reply and pointed them to a trusted adult. ' +
          "Their words aren't stored."
        : "Study Buddy responded kindly. Their words aren't stored. Consider checking in with them gently.",
    }),
    el(
      'ul',
      {},
      ...flags
        .slice()
        .reverse()
        .map((f) => {
          const isUrgent = urgent.includes(f);
          const li = el('li', { className: isUrgent ? 'urgent' : '' });
          li.append(
            el('span', { className: 'sev', textContent: isUrgent ? 'Urgent' : 'Keep an eye' }),
            ` ${fmtTime(f.time)} · ${FLAG_LABELS[f.category] ?? f.category}`,
            el('span', { className: 'src', textContent: ` (${SOURCE_LABELS[f.source] ?? f.source})` }),
          );
          return li;
        }),
    ),
    howAlertsWork(),
  );
}

function renderTasks(tasks) {
  const list = $('tasks');
  list.replaceChildren();
  if (!tasks.length) {
    list.append(el('li', { className: 'empty', textContent: 'No quests yet. Add one above.' }));
    return;
  }
  for (const t of tasks) {
    const doneSteps = t.steps.filter((s) => s.done).length;
    const progress = t.done ? 'Done' : t.steps.length ? `${doneSteps}/${t.steps.length} steps` : 'Not started';
    const del = el('button', { className: 'link', textContent: 'Remove', type: 'button' });
    del.addEventListener('click', async () => {
      await api('DELETE', `/api/parent/tasks/${t.id}`);
      refresh();
    });
    list.append(
      el(
        'li',
        { className: t.done ? 'done' : '' },
        el('span', { className: 'title', textContent: t.title }),
        el('span', {
          className: `tag ${t.source}`,
          textContent: t.source === 'parent' ? 'from you' : 'added by child',
        }),
        el('span', { className: 'progress', textContent: progress }),
        del,
      ),
    );
  }
}

function renderSettings(s) {
  if (document.activeElement?.closest('#settings-form')) return; // don't overwrite while typing
  $('set-daily').value = s.dailyMinutes;
  $('set-focus').value = s.focusMinutes;
  $('set-break').value = s.breakMinutes;
}

function renderWeek(days) {
  $('week').replaceChildren(
    ...days.map((d) =>
      el(
        'tr',
        {},
        el('td', { textContent: fmtDate(d.date) }),
        el('td', { className: 'num', textContent: fmtMin(d.usageMinutes) }),
        el('td', { className: 'num', textContent: d.tasksCompleted }),
        el('td', { className: 'num', textContent: d.focusSessions }),
        el('td', { className: 'num', textContent: d.messages }),
        el('td', { className: 'num', textContent: d.safetyFlags || '–' }),
      ),
    ),
  );
}

async function refresh() {
  try {
    const data = await api('GET', '/api/parent/summary');
    if (!signedIn) showDashboard();
    renderStats(data);
    renderAlerts(data.today.safetyFlags);
    renderTasks(data.tasks);
    renderSettings(data.settings);
    renderWeek(data.week);
  } catch {
    /* locked or server stopped */
  }
}

// ---------- actions ----------

$('task-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = $('task-title').value.trim();
  if (!title) return;
  await api('POST', '/api/parent/tasks', { title });
  $('task-title').value = '';
  refresh();
});

$('settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  await api('PUT', '/api/parent/settings', {
    dailyMinutes: $('set-daily').value,
    focusMinutes: $('set-focus').value,
    breakMinutes: $('set-break').value,
  });
  document.activeElement?.blur();
  $('settings-saved').hidden = false;
  setTimeout(() => ($('settings-saved').hidden = true), 2000);
  refresh();
});

// ---------- start ----------

(async function start() {
  try {
    const cfg = await api('GET', '/api/parent/config');
    $('email').hidden = !cfg.emailRequired;
    $('email').required = cfg.emailRequired;
    $('where').textContent = cfg.cloud ? 'Parent view · online' : 'Parent view · runs only on this computer';
  } catch {
    /* server unreachable: refresh() below shows the sign-in form */
  }
  await refresh(); // shows the dashboard if this browser is already signed in, else the sign-in form
})();

setInterval(() => signedIn && refresh(), 30000);
