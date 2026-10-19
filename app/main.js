// Study Buddy Pet — Electron main process.
// Owns the transparent pet window, dragging, the right-click menu,
// and all network calls to the local server (the renderer never talks to the network).

const {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  screen,
  shell,
  desktopCapturer,
  systemPreferences,
} = require('electron');
const path = require('path');
const fs = require('fs');

// config.json = shared defaults (in git). config.local.json = this computer only, not in git:
// the cloud server URL and the device token go there.
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const localConfigPath = path.join(__dirname, 'config.local.json');
if (fs.existsSync(localConfigPath)) {
  const local = JSON.parse(fs.readFileSync(localConfigPath, 'utf8'));
  Object.assign(config, local, { student: { ...config.student, ...local.student } });
}
config.serverUrl = String(config.serverUrl).replace(/\/+$/, '');
const petDir = path.resolve(__dirname, config.petDir);
const petMeta = JSON.parse(fs.readFileSync(path.join(petDir, 'pet.json'), 'utf8'));
// Sent as a data URL so the renderer can read pixel alpha for click-through hit testing.
const spriteDataUrl =
  'data:image/png;base64,' + fs.readFileSync(path.join(petDir, petMeta.spritesheetPath)).toString('base64');

const WIN_W = 380;
const WIN_H = 540;
let win = null;
let dragOffset = null;

function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  win = new BrowserWindow({
    width: WIN_W,
    height: WIN_H,
    x: workArea.x + workArea.width - WIN_W - 24,
    y: workArea.y + workArea.height - WIN_H,
    transparent: true,
    frame: false,
    resizable: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreenable: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Start fully click-through; the renderer turns mouse input on only over the pet or the chat panel.
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile('index.html');
}

// ---------- IPC ----------

ipcMain.handle('pet:get-config', () => ({
  meta: petMeta,
  spriteUrl: spriteDataUrl,
  scale: config.scale,
  fps: config.fps,
  student: config.student,
}));

// The chat panel is anchored to the bottom-right (next to the pet). Making it bigger grows the
// window up and to the left so the pet stays where it is.
const PANEL_MIN = 300;
const PANEL_MAX = 900;
const PANEL_RIGHT = 12;
const PANEL_BOTTOM = 172;
const EDGE_PAD = 16;

ipcMain.handle('win:resize-panel', (_e, size) => {
  if (!win) return { w: 352, h: 352 };
  const b = win.getBounds();
  const right = b.x + b.width;
  const bottom = b.y + b.height;
  const { workArea: wa } = screen.getDisplayMatching(b);
  const maxW = Math.max(PANEL_MIN, Math.min(PANEL_MAX, right - wa.x - EDGE_PAD - PANEL_RIGHT));
  const maxH = Math.max(PANEL_MIN, Math.min(PANEL_MAX, bottom - wa.y - EDGE_PAD - PANEL_BOTTOM));
  const w = Math.min(maxW, Math.max(PANEL_MIN, Math.round(Number(size?.w) || 352)));
  const h = Math.min(maxH, Math.max(PANEL_MIN, Math.round(Number(size?.h) || 352)));
  const width = Math.max(WIN_W, w + PANEL_RIGHT + EDGE_PAD);
  const height = Math.max(WIN_H, h + PANEL_BOTTOM + EDGE_PAD);
  if (width !== b.width || height !== b.height) {
    win.setBounds({ x: right - width, y: bottom - height, width, height });
  }
  return { w, h };
});

ipcMain.on('win:set-ignore', (_e, ignore) => {
  if (win) win.setIgnoreMouseEvents(Boolean(ignore), { forward: true });
});

ipcMain.on('win:drag-start', () => {
  if (!win) return;
  const cursor = screen.getCursorScreenPoint();
  const [x, y] = win.getPosition();
  dragOffset = { x: cursor.x - x, y: cursor.y - y };
});

ipcMain.on('win:drag-move', () => {
  if (!win || !dragOffset) return;
  const cursor = screen.getCursorScreenPoint();
  win.setPosition(Math.round(cursor.x - dragOffset.x), Math.round(cursor.y - dragOffset.y));
});

ipcMain.on('win:drag-end', () => {
  dragOffset = null;
});

ipcMain.on('menu:show', () => {
  if (!win) return;
  const stateItems = Object.keys(petMeta.states).map((name) => ({
    label: name,
    click: () => win.webContents.send('pet:play', name),
  }));
  Menu.buildFromTemplate([
    { label: 'Open / close panel', click: () => win.webContents.send('ui:toggle-chat') },
    { label: 'Parent page…', click: () => shell.openExternal(`${config.serverUrl}/parent`) },
    { type: 'separator' },
    { label: 'Test animation', submenu: stateItems },
    { label: 'Developer tools', click: () => win.webContents.openDevTools({ mode: 'detach' }) },
    { type: 'separator' },
    { label: 'Quit Study Buddy', click: () => app.quit() },
  ]).popup({ window: win });
});

// Only these server routes can be called from the pet window.
const ALLOWED_API = [
  { method: 'POST', path: /^\/chat$/ },
  { method: 'GET', path: /^\/state$/ },
  { method: 'POST', path: /^\/tasks$/ },
  { method: 'POST', path: /^\/tasks\/[\w-]+\/(breakdown|complete)$/ },
  { method: 'POST', path: /^\/tasks\/[\w-]+\/steps\/[\w-]+\/toggle$/ },
  { method: 'POST', path: /^\/focus\/complete$/ },
  { method: 'POST', path: /^\/usage\/heartbeat$/ },
];

const serverHeaders = { 'Content-Type': 'application/json' };
if (config.deviceToken) serverHeaders.Authorization = `Bearer ${config.deviceToken}`;

async function callServer(method, apiPath, body) {
  if (!ALLOWED_API.some((r) => r.method === method && r.path.test(apiPath))) {
    return { ok: false, error: 'blocked_path' };
  }
  try {
    const res = await fetch(`${config.serverUrl}${apiPath}`, {
      method,
      headers: serverHeaders,
      body: method === 'GET' ? undefined : JSON.stringify({ ...body, student: config.student }),
      signal: AbortSignal.timeout(60000),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) return { ok: false, error: 'bad_device_token' };
    if (!res.ok) return { ok: false, error: data.error || `server_error_${res.status}` };
    return { ok: true, ...data };
  } catch (err) {
    return { ok: false, error: err.name === 'TimeoutError' ? 'timeout' : 'offline' };
  }
}

ipcMain.handle('chat:send', (_e, payload) => callServer('POST', '/chat', { messages: payload.messages }));
ipcMain.handle('api:call', (_e, { method, path: apiPath, body }) => callServer(method, apiPath, body ?? {}));

// ---------- Screen snip ----------
// Hide the pet, capture the display under the cursor, let the student drag a box on a
// full-screen overlay, then crop that box out of the capture. Nothing is saved to disk.

const MAX_IMAGE_EDGE = 1568;
let snipWin = null;

function screenPermission() {
  if (process.platform !== 'darwin') return 'granted';
  return systemPreferences.getMediaAccessStatus('screen');
}

function selectRegion(display) {
  return new Promise((resolve) => {
    snipWin = new BrowserWindow({
      ...display.bounds,
      frame: false,
      transparent: true,
      hasShadow: false,
      resizable: false,
      movable: false,
      skipTaskbar: true,
      fullscreenable: false,
      enableLargerThanScreen: true,
      alwaysOnTop: true,
      webPreferences: {
        preload: path.join(__dirname, 'snip-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    snipWin.setAlwaysOnTop(true, 'screen-saver');
    snipWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    let finished = false;
    const overlay = snipWin;
    const finish = (rect) => {
      if (finished) return;
      finished = true;
      ipcMain.removeListener('snip:done', onDone);
      snipWin = null;
      if (!overlay.isDestroyed()) overlay.close();
      resolve(rect);
    };
    const onDone = (e, rect) => {
      if (e.sender !== overlay.webContents) return;
      finish(rect && rect.width >= 8 && rect.height >= 8 ? rect : null);
    };
    ipcMain.on('snip:done', onDone);
    overlay.on('closed', () => finish(null));
    overlay.loadFile('snip.html');
    overlay.once('ready-to-show', () => overlay.focus());
  });
}

ipcMain.handle('snip:start', async () => {
  if (snipWin || !win) return { ok: false, error: 'busy' };
  const permission = screenPermission();
  if (permission === 'denied' || permission === 'restricted') return { ok: false, error: 'screen_permission' };

  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  win.hide();
  await new Promise((r) => setTimeout(r, 250)); // let the pet window disappear before capturing

  let image = null;
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: Math.round(display.bounds.width * display.scaleFactor),
        height: Math.round(display.bounds.height * display.scaleFactor),
      },
    });
    image = (sources.find((s) => s.display_id === String(display.id)) ?? sources[0])?.thumbnail ?? null;
  } catch (err) {
    console.error('[snip] capture failed:', err.message);
  }

  // On macOS, without Screen Recording permission the capture is empty or only shows the wallpaper.
  if (!image || image.isEmpty() || screenPermission() !== 'granted') {
    win.show();
    return { ok: false, error: 'screen_permission' };
  }

  const rect = await selectRegion(display);
  win.show();
  if (!rect) return { ok: false, error: 'cancelled' };

  const size = image.getSize();
  const k = size.width / display.bounds.width;
  const x = Math.max(0, Math.round((rect.x - display.bounds.x) * k));
  const y = Math.max(0, Math.round((rect.y - display.bounds.y) * k));
  const crop = {
    x,
    y,
    width: Math.min(size.width - x, Math.round(rect.width * k)),
    height: Math.min(size.height - y, Math.round(rect.height * k)),
  };
  if (crop.width < 8 || crop.height < 8) return { ok: false, error: 'cancelled' };

  let out = image.crop(crop);
  if (Math.max(crop.width, crop.height) > MAX_IMAGE_EDGE) {
    out = out.resize(
      crop.width >= crop.height ? { width: MAX_IMAGE_EDGE, quality: 'best' } : { height: MAX_IMAGE_EDGE, quality: 'best' },
    );
  }
  return { ok: true, dataUrl: 'data:image/jpeg;base64,' + out.toJPEG(85).toString('base64') };
});

// ---------- App lifecycle ----------

app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) app.dock.hide();
  createWindow();
  // A free cloud server may be asleep; wake it up early so the first question isn't slow.
  fetch(`${config.serverUrl}/health`, { signal: AbortSignal.timeout(90000) }).catch(() => {});
});

app.on('window-all-closed', () => app.quit());
