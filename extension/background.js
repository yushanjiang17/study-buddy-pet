// Study Buddy Exam Mode: background service worker.
//
// Every 30 seconds it asks the Study Buddy server whether exam mode is on.
// While it is on, it:
//   - pauses the sites on the parent's list (Chrome's built-in blocking rules),
//   - shows a friendly "paused for your exam" page instead,
//   - counts blocked visits, tab switches and times Chrome loses focus.
// It never reads page content, never records which sites were visited, and never takes screenshots.

const DEFAULT_SERVER = 'http://localhost:3000';
const RULE_ID_START = 1000;
const MAX_RULES = 100;

// ---------- server ----------

async function getConfig() {
  const c = await chrome.storage.local.get(['serverUrl', 'deviceToken']);
  return { serverUrl: (c.serverUrl || DEFAULT_SERVER).replace(/\/+$/, ''), deviceToken: c.deviceToken || '' };
}

async function api(method, path, body) {
  const { serverUrl, deviceToken } = await getConfig();
  const res = await fetch(serverUrl + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(deviceToken ? { Authorization: `Bearer ${deviceToken}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) throw new Error('bad_device_token');
  if (!res.ok) throw new Error(`server_error_${res.status}`);
  return res.json();
}

// ---------- exam state ----------

function isActive(exam) {
  return Boolean(exam?.active && exam.endsAt && Date.parse(exam.endsAt) > Date.now());
}

async function applyExam(exam) {
  const active = isActive(exam);
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const domains = active ? (exam.blockList || []).slice(0, MAX_RULES) : [];
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map((r) => r.id),
    addRules: domains.map((domain, i) => ({
      id: RULE_ID_START + i,
      priority: 1,
      action: { type: 'block' },
      // requestDomains also covers subdomains (www.youtube.com, m.youtube.com, …)
      condition: { requestDomains: [domain], resourceTypes: ['main_frame', 'sub_frame'] },
    })),
  });
  await chrome.action.setBadgeText({ text: active ? 'EXAM' : '' });
  await chrome.action.setBadgeBackgroundColor({ color: '#b5482f' });
  await chrome.action.setTitle({ title: active ? 'Exam mode is ON' : 'Study Buddy Exam Mode' });
}

async function sync() {
  try {
    await flushQueue();
    const exam = await api('GET', '/exam');
    await chrome.storage.local.set({ exam, lastSync: Date.now(), error: null });
    await applyExam(exam);
  } catch (err) {
    // Server unreachable: keep the last known state, but never stay locked past the end time.
    const { exam } = await chrome.storage.local.get('exam');
    await chrome.storage.local.set({ error: err.message, lastSync: Date.now() });
    await applyExam(exam);
  }
}

// ---------- counting (numbers only) ----------

async function report(type) {
  const { exam } = await chrome.storage.local.get('exam');
  if (!isActive(exam)) return;
  try {
    await api('POST', '/exam/event', { type });
  } catch {
    // Offline: remember the count and send it on the next sync.
    const { queue = {} } = await chrome.storage.local.get('queue');
    queue[type] = (queue[type] || 0) + 1;
    await chrome.storage.local.set({ queue });
  }
}

async function flushQueue() {
  const { queue = {} } = await chrome.storage.local.get('queue');
  for (const [type, count] of Object.entries(queue)) {
    if (count > 0) await api('POST', '/exam/event', { type, count });
  }
  await chrome.storage.local.set({ queue: {} });
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function onList(host, list = []) {
  return list.some((d) => host === d || host.endsWith('.' + d));
}

// A paused site was opened: count it and show the friendly page instead of Chrome's error page.
chrome.webNavigation.onErrorOccurred.addListener(async (details) => {
  if (details.frameId !== 0 || details.error !== 'net::ERR_BLOCKED_BY_CLIENT') return;
  const { exam } = await chrome.storage.local.get('exam');
  if (!isActive(exam) || !onList(hostOf(details.url), exam.blockList)) return;
  report('blocked');
  chrome.tabs.update(details.tabId, { url: chrome.runtime.getURL('blocked.html') });
});

chrome.tabs.onActivated.addListener(() => report('tab_switch'));

// Chrome lost focus (switched to another app). Debounced so one switch counts once.
let lastBlur = 0;
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) return;
  if (Date.now() - lastBlur < 3000) return;
  lastBlur = Date.now();
  report('left_browser');
});

// ---------- schedule ----------

chrome.runtime.onInstalled.addListener((info) => {
  chrome.alarms.create('sync', { periodInMinutes: 0.5 });
  sync();
  if (info.reason === 'install') chrome.runtime.openOptionsPage();
});
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create('sync', { periodInMinutes: 0.5 });
  sync();
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'sync') sync();
});
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'sync-now') {
    sync().then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.serverUrl || changes.deviceToken)) sync();
});
