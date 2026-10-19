chrome.storage.local.get('exam').then(({ exam }) => {
  if (!exam?.endsAt) return;
  const end = new Date(exam.endsAt);
  if (end <= new Date()) {
    document.getElementById('when').textContent = 'Your exam is over. You can open that site again.';
    return;
  }
  const time = end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  document.getElementById('when').textContent = `It will be back after your exam ends at ${time}.`;
});

document.getElementById('back').addEventListener('click', () => {
  if (history.length > 1) history.back();
  else window.close();
});
