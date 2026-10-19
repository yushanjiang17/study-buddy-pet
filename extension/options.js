const $ = (id) => document.getElementById(id);

chrome.storage.local.get(['serverUrl', 'deviceToken']).then((c) => {
  $('serverUrl').value = c.serverUrl || '';
  $('deviceToken').value = c.deviceToken || '';
});

function show(text, kind) {
  const r = $('result');
  r.hidden = false;
  r.className = `pill ${kind}`;
  r.textContent = text;
}

$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const serverUrl = $('serverUrl').value.trim().replace(/\/+$/, '');
  const deviceToken = $('deviceToken').value.trim();
  try {
    const host = new URL(serverUrl).hostname;
    const allowed = host.endsWith('.onrender.com') || host === 'localhost' || host === '127.0.0.1';
    if (!allowed) return show('Use an onrender.com or localhost address', 'err');
  } catch {
    return show('That address is not valid', 'err');
  }

  await chrome.storage.local.set({ serverUrl, deviceToken, error: null });
  show('Testing…', 'off');
  try {
    const res = await fetch(`${serverUrl}/exam`, {
      headers: deviceToken ? { Authorization: `Bearer ${deviceToken}` } : {},
    });
    if (res.status === 401) return show('Device token is wrong', 'err');
    if (!res.ok) return show(`Server error ${res.status}`, 'err');
    const exam = await res.json();
    await chrome.runtime.sendMessage({ type: 'sync-now' });
    show(exam.active ? 'Connected · exam mode is ON' : 'Connected · exam mode is off', exam.active ? 'on' : 'off');
  } catch {
    show("Can't reach the server (it may be waking up, try again in a minute)", 'err');
  }
});
