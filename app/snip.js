// Full-screen overlay: drag a rectangle, send it (in screen coordinates) back to the main process.
const dim = document.getElementById('dim');
const sel = document.getElementById('sel');
const hint = document.getElementById('hint');
let start = null;

function box(e) {
  return {
    left: Math.min(start.cx, e.clientX),
    top: Math.min(start.cy, e.clientY),
    width: Math.abs(e.clientX - start.cx),
    height: Math.abs(e.clientY - start.cy),
    screenX: Math.min(start.sx, e.screenX),
    screenY: Math.min(start.sy, e.screenY),
  };
}

window.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  start = { cx: e.clientX, cy: e.clientY, sx: e.screenX, sy: e.screenY };
  dim.hidden = true;
  hint.hidden = true;
  sel.hidden = false;
  draw(e);
});

window.addEventListener('mousemove', (e) => {
  if (start) draw(e);
});

window.addEventListener('mouseup', (e) => {
  if (!start) return;
  const b = box(e);
  start = null;
  window.snip.done({ x: b.screenX, y: b.screenY, width: b.width, height: b.height });
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.snip.done(null);
});

window.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  window.snip.done(null);
});

function draw(e) {
  const b = box(e);
  sel.style.left = b.left + 'px';
  sel.style.top = b.top + 'px';
  sel.style.width = b.width + 'px';
  sel.style.height = b.height + 'px';
}
