const $ = (id) => document.getElementById(id);

const fmtTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

function describeRecord(r) {
  const e = r.events;
  return `${e.blocked} paused site visit${e.blocked === 1 ? '' : 's'}, ${e.tab_switch} tab switch${
    e.tab_switch === 1 ? '' : 'es'
  }, left Chrome ${e.left_browser} time${e.left_browser === 1 ? '' : 's'}`;
}

async function render() {
  const { exam, error, serverUrl } = await chrome.storage.local.get(['exam', 'error', 'serverUrl']);
  const status = $('status');
  const detail = $('detail');
  const active = exam?.active && Date.parse(exam.endsAt) > Date.now();

  if (!serverUrl) {
    status.className = 'pill err';
    status.textContent = 'Not set up';
    detail.textContent = 'A grown-up needs to open Settings and add the server address and device token.';
    return;
  }
  if (error && !exam) {
    status.className = 'pill err';
    status.textContent = "Can't reach server";
    detail.textContent =
      error === 'bad_device_token' ? 'The device token is wrong. Check it in Settings.' : 'Trying again every 30 seconds.';
    return;
  }
  if (active) {
    const mins = Math.max(1, Math.round((Date.parse(exam.endsAt) - Date.now()) / 60000));
    status.className = 'pill on';
    status.textContent = 'Exam mode is ON';
    detail.textContent = `${exam.blockList.length} sites are paused until ${fmtTime(exam.endsAt)} (about ${mins} min). You've got this!`;
  } else {
    status.className = 'pill off';
    status.textContent = 'Exam mode is off';
    detail.textContent = exam?.lastResult
      ? `Last exam (${fmtTime(exam.lastResult.startedAt)}): ${describeRecord(exam.lastResult)}.`
      : 'Nothing is paused right now.';
  }
}

$('refresh').addEventListener('click', async () => {
  $('refresh').textContent = 'Checking…';
  await chrome.runtime.sendMessage({ type: 'sync-now' });
  $('refresh').textContent = 'Check now';
  render();
});
$('settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
chrome.storage.onChanged.addListener(render);
render();
