// Study Buddy Pet — page logic:
// sprite animation, click-through + dragging, speech bubble, and the panel with Chat / Quests / Focus.

(async function main() {
  const cfg = await window.buddy.getConfig();
  const { meta, scale, fps, student } = cfg;
  const $ = (id) => document.getElementById(id);

  // =====================================================================
  // Sprite animation
  // =====================================================================
  const FW = meta.frameWidth;
  const FH = meta.frameHeight;
  const W = Math.round(FW * scale);
  const H = Math.round(FH * scale);
  const dpr = window.devicePixelRatio || 1;

  const canvas = $('pet');
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;

  const sheet = new Image();
  sheet.src = cfg.spriteUrl;
  await sheet.decode();

  // Looping states keep playing until something else is played; others play twice, then return to base.
  const LOOPING = new Set(['idle', 'thinking', 'experiment', 'give-quest', 'guard', 'sleep']);
  let baseState = 'idle';
  let current = 'idle';
  let frame = 0;
  let loopsLeft = Infinity;

  function play(state, opts = {}) {
    if (!meta.states[state]) return;
    current = state;
    frame = 0;
    loopsLeft = opts.loops ?? (LOOPING.has(state) ? Infinity : 2);
    draw();
  }

  function setBase(state) {
    baseState = state;
    play(state);
  }

  function draw() {
    const s = meta.states[current];
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(sheet, frame * FW, s.row * FH, FW, FH, 0, 0, canvas.width, canvas.height);
  }

  setInterval(() => {
    const s = meta.states[current];
    frame += 1;
    if (frame >= s.frames) {
      frame = 0;
      if (loopsLeft !== Infinity) {
        loopsLeft -= 1;
        if (loopsLeft <= 0) {
          current = baseState;
          loopsLeft = Infinity;
        }
      }
    }
    draw();
  }, 1000 / fps);

  draw();
  window.buddy.onPlay((state) => play(state, { loops: 3 }));

  // =====================================================================
  // Click-through: only the pet's visible pixels and the UI take the mouse
  // =====================================================================
  let ignoring = true;
  let dragging = false;

  function setInteractive(on) {
    if (on === !ignoring) return;
    ignoring = !on;
    window.buddy.setIgnoreMouse(!on);
  }

  const inside = (r, x, y) => x >= r.left && x < r.right && y >= r.top && y < r.bottom;

  function overPet(x, y) {
    const r = canvas.getBoundingClientRect();
    if (!inside(r, x, y)) return false;
    const px = Math.floor((x - r.left) * dpr);
    const py = Math.floor((y - r.top) * dpr);
    return ctx.getImageData(px, py, 1, 1).data[3] > 60;
  }

  function overUI(x, y) {
    return [...document.querySelectorAll('.hit')].some(
      (el) => !el.hidden && inside(el.getBoundingClientRect(), x, y),
    );
  }

  window.addEventListener('mousemove', (e) => {
    if (dragging) return;
    setInteractive(overPet(e.clientX, e.clientY) || overUI(e.clientX, e.clientY));
  });
  document.addEventListener('mouseleave', () => {
    if (!dragging) setInteractive(false);
  });

  // Drag vs click on the pet
  let pointerStart = null;

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    pointerStart = { x: e.screenX, y: e.screenY };
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!pointerStart) return;
    if (!dragging && Math.hypot(e.screenX - pointerStart.x, e.screenY - pointerStart.y) > 4) {
      dragging = true;
      window.buddy.dragStart();
    }
    if (dragging) window.buddy.dragMove();
  });

  canvas.addEventListener('pointerup', (e) => {
    if (!pointerStart) return;
    canvas.releasePointerCapture(e.pointerId);
    if (dragging) window.buddy.dragEnd();
    else togglePanel();
    pointerStart = null;
    dragging = false;
  });

  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    window.buddy.showMenu();
  });

  // =====================================================================
  // DOM helpers, bubble, panel + tabs
  // =====================================================================
  const panel = $('panel');
  const bubble = $('bubble');
  const pill = $('timer-pill');
  const pointsEl = $('points');
  const tabButtons = [...document.querySelectorAll('.tabs [data-tab]')];
  const views = [...document.querySelectorAll('.view')];
  $('pet-name').textContent = meta.displayName || 'Study Buddy';

  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    Object.assign(node, props);
    node.append(...children);
    return node;
  }

  let bubbleTimer = null;
  function say(text, ms = 7000) {
    if (!panel.hidden) return;
    bubble.textContent = text;
    bubble.hidden = false;
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => {
      bubble.hidden = true;
    }, ms);
  }

  let activeTab = 'chat';

  function showTab(name) {
    activeTab = name;
    tabButtons.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
    views.forEach((v) => (v.hidden = v.dataset.view !== name));
    if (name === 'chat') $('input').focus();
    if (name === 'quests') refreshState();
  }

  function togglePanel(force, tab) {
    const open = typeof force === 'boolean' ? force : panel.hidden;
    panel.hidden = !open;
    if (!open) return;
    bubble.hidden = true;
    if (tab) showTab(tab);
    if ($('messages').children.length === 0) {
      addMsg('assistant', `Hi ${student.name}! What quest are we working on today?`);
      play('give-quest', { loops: 2 });
    }
    if (activeTab === 'chat') $('input').focus();
  }

  // ---------- resizable panel (drag the top-left corner) ----------
  const PANEL_DEFAULT = { w: 352, h: 352 };
  const SIZE_KEY = 'study-buddy-panel-size';
  let panelSize = { ...PANEL_DEFAULT };

  function loadPanelSize() {
    try {
      const saved = JSON.parse(localStorage.getItem(SIZE_KEY));
      if (saved && saved.w > 0 && saved.h > 0) return saved;
    } catch {
      /* storage unavailable */
    }
    return { ...PANEL_DEFAULT };
  }

  function savePanelSize() {
    try {
      localStorage.setItem(SIZE_KEY, JSON.stringify(panelSize));
    } catch {
      /* storage unavailable */
    }
  }

  async function applyPanelSize(want) {
    const got = await window.buddy.resizePanel(want.w, want.h); // main clamps to the screen
    panelSize = got;
    panel.style.setProperty('--panel-w', got.w + 'px');
    panel.style.setProperty('--panel-h', got.h + 'px');
  }

  const handle = $('resize');
  let resizeStart = null;
  let resizeBusy = false;
  let resizeQueued = null;

  async function resizeTo(want) {
    if (resizeBusy) {
      resizeQueued = want; // only the latest position matters
      return;
    }
    resizeBusy = true;
    await applyPanelSize(want);
    resizeBusy = false;
    if (resizeQueued) {
      const next = resizeQueued;
      resizeQueued = null;
      resizeTo(next);
    }
  }

  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    resizeStart = { x: e.screenX, y: e.screenY, w: panelSize.w, h: panelSize.h };
    handle.setPointerCapture(e.pointerId);
    panel.classList.add('resizing');
  });

  handle.addEventListener('pointermove', (e) => {
    if (!resizeStart) return;
    resizeTo({
      w: resizeStart.w + (resizeStart.x - e.screenX),
      h: resizeStart.h + (resizeStart.y - e.screenY),
    });
  });

  handle.addEventListener('pointerup', (e) => {
    if (!resizeStart) return;
    handle.releasePointerCapture(e.pointerId);
    resizeStart = null;
    panel.classList.remove('resizing');
    savePanelSize();
  });

  handle.addEventListener('dblclick', async () => {
    await applyPanelSize(PANEL_DEFAULT);
    savePanelSize();
  });

  applyPanelSize(loadPanelSize());

  tabButtons.forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  $('close').addEventListener('click', () => togglePanel(false));
  bubble.addEventListener('click', () => togglePanel(true));
  pill.addEventListener('click', () => togglePanel(true, 'focus'));
  window.buddy.onToggleChat(() => togglePanel());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') togglePanel(false);
  });

  // Tell the student something wherever they'll see it.
  function notify(text) {
    if (panel.hidden) say(text, 10000);
    else if (activeTab === 'chat') addMsg('assistant', text);
    else if (activeTab === 'quests') setStatus($('quest-status'), text);
    else {
      const note = $('focus-note');
      note.textContent = text;
      note.dataset.custom = '1';
      clearTimeout(note._t);
      note._t = setTimeout(() => {
        delete note.dataset.custom;
        renderTimer();
      }, 8000);
    }
  }

  function setStatus(node, text, isError = false) {
    node.textContent = text;
    node.classList.toggle('error', isError);
    clearTimeout(node._t);
    node._t = setTimeout(() => (node.textContent = ''), 6000);
  }

  function errorText(code) {
    switch (code) {
      case 'offline':
        return "I can't reach the castle right now. (Grown-ups: is the server running?)";
      case 'timeout':
        return 'That took too long. Can you try again?';
      case 'missing_api_key':
        return 'I need my magic key first. (Grown-ups: add the API key in server/.env.)';
      case 'bad_api_key':
        return "My magic key doesn't work. (Grown-ups: check the API key in server/.env.)";
      case 'claude_offline':
        return "I can't reach my library right now. (Grown-ups: check the internet connection.)";
      case 'rate_limited':
        return "Lots of heroes are asking at once. Let's wait a moment and try again.";
      case 'model_not_found':
        return 'My spellbook name is wrong. (Grown-ups: check CLAUDE_MODEL in server/.env.)';
      case 'daily_limit':
        return "We've used up today's thinking time. Let's continue tomorrow!";
      case 'unsafe':
        return "Let's pick a schoolwork quest instead.";
      case 'no_steps':
        return "I couldn't split that one. Try describing the homework a bit more.";
      case 'exam_mode':
        return "It's exam time, so I'm guarding the gate. Let's do this after the exam!";
      case 'bad_device_token':
        return "The castle doesn't recognize me. (Grown-ups: check deviceToken in app/config.local.json.)";
      case 'image_too_large':
        return 'That picture is too big. Try a smaller one, or snip just the question.';
      case 'bad_image':
        return "I couldn't read that picture. Can you try another one?";
      default:
        return `Something went wrong (${code}). Let's try again in a moment.`;
    }
  }

  // =====================================================================
  // Server state: quests, points, settings, screen time
  // =====================================================================
  let state = null;
  let knownTaskIds = null;
  let sleeping = false;
  let lastPoints = null;

  async function refreshState() {
    const res = await window.buddy.api('GET', '/state');
    if (res.ok) applyState(res);
    else if (!state) renderQuests();
    return res.ok;
  }

  function applyState(s) {
    // Let the hero know when a grown-up adds a quest.
    const ids = new Set(s.tasks.map((t) => t.id));
    if (knownTaskIds) {
      const fresh = s.tasks.find((t) => !knownTaskIds.has(t.id) && t.source === 'parent');
      if (fresh) {
        notify(`A grown-up added a new quest: "${fresh.title}"`);
        play('give-quest', { loops: 2 });
      }
    }
    knownTaskIds = ids;
    state = s;

    pointsEl.textContent = `★ ${s.points}`;
    if (lastPoints !== null && s.points > lastPoints) {
      pointsEl.classList.add('bump');
      setTimeout(() => pointsEl.classList.remove('bump'), 400);
    }
    lastPoints = s.points;

    const open = s.tasks.filter((t) => !t.done).length;
    $('quest-count').textContent = open;
    $('quest-count').hidden = open === 0;

    renderQuests();
    applyUsage(s.usage);
    applyExam(s.exam);
    if (!timer.running && timer.untouched) timer.remaining = focusLen();
    renderTimer();
  }

  function applyUsage(u) {
    $('usage-text').textContent = u.dailyMinutes
      ? `Screen time today: ${u.minutesUsed} of ${u.dailyMinutes} min`
      : `Screen time today: ${u.minutesUsed} min`;
    const bar = $('usage-bar');
    bar.style.width = u.dailyMinutes ? `${Math.min(100, (u.minutesUsed / u.dailyMinutes) * 100)}%` : '0';
    bar.classList.toggle('over', u.overLimit);

    if (u.overLimit && !sleeping) {
      sleeping = true;
      refreshMode();
      notify("That's all the screen time for today. Great work, hero! See you tomorrow.");
    } else if (!u.overLimit && sleeping) {
      sleeping = false;
      refreshMode();
    }
  }

  // ---------- exam mode ----------
  // Turned on by a grown-up on the parent page. The pet guards the gate: no chat help, no pictures.
  let examActive = false;
  let examEndsAt = 0;
  let examTick = null;

  function applyExam(exam) {
    const active = Boolean(exam?.active && Date.parse(exam.endsAt) > Date.now());
    examEndsAt = active ? Date.parse(exam.endsAt) : 0;
    $('exam-banner').hidden = !active;
    if (active) {
      const end = new Date(examEndsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      $('exam-banner-text').textContent = `Exam mode until ${end}. I'm guarding the gate. You've got this!`;
    }
    if (active && !examTick) examTick = setInterval(renderTimer, 1000); // live countdown
    if (!active && examTick) {
      clearInterval(examTick);
      examTick = null;
    }
    if (active && !examActive) {
      examActive = true;
      if (timer.running) pauseTimer();
      refreshMode();
      notify("Exam time! I'll guard the gate. Chat and pictures are paused until it's over. Do your best!");
    } else if (!active && examActive) {
      examActive = false;
      refreshMode();
      const r = exam?.lastResult;
      if (r) {
        const e = r.events;
        const n = (count, one, many) => `${count} ${count === 1 ? one : many}`;
        notify(
          `Exam over, great job! Here's the record your grown-up sees too: ` +
            `${n(e.blocked, 'paused-site visit', 'paused-site visits')}, ` +
            `${n(e.tab_switch, 'tab switch', 'tab switches')}, left Chrome ${n(e.left_browser, 'time', 'times')}.`,
        );
      }
      play('celebrate', { loops: 3 });
    }
    renderTimer();
  }

  // What the pet does at rest, and whether chat is locked, depends on exam mode and screen time.
  function refreshMode() {
    const base = examActive ? 'guard' : sleeping ? 'sleep' : 'idle';
    if (base !== baseState) setBase(base);
    const locked = examActive || sleeping;
    const input = $('input');
    input.disabled = locked;
    input.placeholder = examActive
      ? "Exam time. I'll be here when it's over!"
      : sleeping
        ? 'See you tomorrow!'
        : 'Ask about your quest, or add a picture…';
    $('attach').disabled = locked;
    $('snip').disabled = locked;
    $('send').disabled = locked;
    $('focus-start').disabled = examActive;
    if (locked) setAttachment(null);
  }

  // Count screen time once a minute, and pick up quests a grown-up added.
  // Check for exam mode and new quests more often than the screen-time heartbeat.
  setInterval(() => refreshState(), 20000);

  setInterval(async () => {
    const res = await window.buddy.api('POST', '/usage/heartbeat');
    if (res.ok) applyState(res);
  }, 60000);

  // =====================================================================
  // Chat
  // =====================================================================
  const list = $('messages');
  const form = $('composer');
  const input = $('input');
  const sendBtn = $('send');
  const history = []; // [{role, content, image?}]
  let busy = false;

  function addMsg(role, text, extraClass, image) {
    const div = el('div', { className: `msg ${role}` + (extraClass ? ` ${extraClass}` : '') });
    if (image) div.append(el('img', { className: 'msg-img', src: image, alt: 'Your picture' }));
    if (text) div.append(document.createTextNode(text));
    list.append(div);
    list.scrollTop = list.scrollHeight;
    return div;
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  // ---------- pictures: attach, paste, drag & drop, snip ----------
  const MAX_EDGE = 1568; // larger images are scaled down before sending
  const attachment = $('attachment');
  const fileInput = $('file');
  const dropHint = $('drop-hint');
  let pendingImage = null;

  function setAttachment(dataUrl) {
    pendingImage = dataUrl;
    attachment.hidden = !dataUrl;
    $('attachment-img').src = dataUrl || '';
    if (dataUrl) input.focus();
  }

  function readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // Scale to at most MAX_EDGE px and re-encode as JPEG to keep requests small.
  async function compress(dataUrl) {
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    const k = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k);
    c.height = Math.round(img.naturalHeight * k);
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.85);
  }

  async function attachFile(file) {
    if (!file || sleeping) return;
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) {
      addMsg('assistant', 'I can only read pictures (PNG, JPG, WebP or GIF).', 'error');
      return;
    }
    try {
      setAttachment(await compress(await readFile(file)));
    } catch {
      addMsg('assistant', "Hmm, I couldn't open that picture. Can you try another one?", 'error');
    }
  }

  $('attach').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    attachFile(fileInput.files[0]);
    fileInput.value = '';
  });
  $('attachment-remove').addEventListener('click', () => setAttachment(null));

  panel.addEventListener('paste', (e) => {
    const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
    if (!item) return;
    e.preventDefault();
    showTab('chat');
    attachFile(item.getAsFile());
  });

  let dragDepth = 0;
  panel.addEventListener('dragenter', (e) => {
    if (![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    dragDepth += 1;
    showTab('chat');
    dropHint.hidden = false;
  });
  panel.addEventListener('dragover', (e) => e.preventDefault());
  panel.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) dropHint.hidden = true;
  });
  panel.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    dropHint.hidden = true;
    attachFile(e.dataTransfer.files[0]);
  });

  $('snip').addEventListener('click', async () => {
    if (sleeping) return;
    const res = await window.buddy.snip();
    togglePanel(true, 'chat');
    if (res.ok) setAttachment(res.dataUrl);
    else if (res.error === 'screen_permission') {
      addMsg(
        'assistant',
        'I need permission to see your screen first. (Grown-ups: open System Settings → Privacy & Security → ' +
          'Screen & System Audio Recording, turn on "Electron", then restart the pet.)',
        'error',
      );
    }
  });

  // Only the latest pictures are re-sent; older ones become a short note to keep requests small.
  function forServer(msgs) {
    return msgs.map((m, i) => {
      const recent = i >= msgs.length - 4;
      if (!m.image) return { role: m.role, content: m.content };
      return recent
        ? { role: m.role, content: m.content, image: m.image }
        : { role: m.role, content: `${m.content}\n[I shared a picture earlier.]`.trim() };
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    const image = pendingImage;
    if ((!text && !image) || busy) return;

    input.value = '';
    setAttachment(null);
    busy = true;
    sendBtn.disabled = true;
    history.push(image ? { role: 'user', content: text, image } : { role: 'user', content: text });
    addMsg('user', text, '', image);
    const typing = addMsg('assistant', image ? 'Looking at your picture…' : 'Thinking…', 'typing');
    play('thinking', { loops: Infinity });

    const res = await window.buddy.chat({ messages: forServer(history.slice(-12)) });
    typing.remove();

    if (res.ok) {
      history.push({ role: 'assistant', content: res.reply });
      addMsg('assistant', res.reply);
      if (res.animation === 'sleep') setBase('sleep');
      if (res.animation === 'guard') refreshState();
      play(res.animation || 'experiment', { loops: 3 });
    } else {
      history.pop(); // keep turns alternating so the question can be retried
      addMsg('assistant', errorText(res.error), 'error');
      play(baseState);
    }

    busy = false;
    sendBtn.disabled = examActive || sleeping;
    input.focus();
  });

  // =====================================================================
  // Quests
  // =====================================================================
  const questList = $('quest-list');
  const questStatus = $('quest-status');

  function renderQuests() {
    questList.replaceChildren();
    if (!state) {
      questList.append(el('li', { className: 'empty', textContent: errorText('offline') }));
      return;
    }
    if (!state.tasks.length) {
      questList.append(
        el('li', { className: 'empty', textContent: 'No quests yet. Add one below, or ask a grown-up to add one.' }),
      );
      return;
    }

    for (const t of state.tasks) {
      const li = el('li', { className: 'quest' + (t.done ? ' done' : '') });
      const head = el('div', { className: 'quest-head' });

      if (t.steps.length) {
        const doneCount = t.steps.filter((s) => s.done).length;
        head.append(el('span', { className: 'progress', textContent: `${doneCount}/${t.steps.length}` }));
      } else {
        const cb = el('input', { type: 'checkbox', checked: t.done });
        cb.setAttribute('aria-label', `Mark "${t.title}" done`);
        cb.addEventListener('change', () => completeQuest(t, cb.checked));
        head.append(cb);
      }
      head.append(el('span', { className: 'quest-title', textContent: t.title }));
      if (t.source === 'parent') head.append(el('span', { className: 'tag', textContent: 'from grown-up' }));
      li.append(head);

      if (t.steps.length) {
        const ol = el('ol', { className: 'steps' });
        for (const s of t.steps) {
          const cb = el('input', { type: 'checkbox', checked: s.done });
          cb.addEventListener('change', () => toggleStep(t, s));
          ol.append(el('li', {}, el('label', {}, cb, el('span', { className: s.done ? 'step-done' : '', textContent: s.text }))));
        }
        li.append(ol);
      } else if (!t.done) {
        const btn = el('button', { type: 'button', className: 'small', textContent: 'Break it into steps' });
        btn.addEventListener('click', () => breakDown(t, btn));
        li.append(btn);
      }
      questList.append(li);
    }
  }

  function celebrate(result) {
    if (result?.completedNow) {
      play('celebrate', { loops: 3 });
      notify(`Quest complete! +${result.award} stars. Amazing work, hero!`);
    } else if (result?.stepDone) {
      play('encourage', { loops: 2 });
    }
  }

  async function questCall(method, path, body) {
    const res = await window.buddy.api(method, path, body);
    if (!res.ok) {
      setStatus(questStatus, errorText(res.error), true);
      await refreshState();
      return null;
    }
    applyState(res);
    return res;
  }

  async function toggleStep(t, s) {
    const res = await questCall('POST', `/tasks/${t.id}/steps/${s.id}/toggle`);
    if (res) celebrate(res.result);
  }

  async function completeQuest(t, done) {
    const res = await questCall('POST', `/tasks/${t.id}/complete`, { done });
    if (res) celebrate(res.result);
  }

  async function breakDown(t, btn) {
    btn.disabled = true;
    btn.textContent = 'Thinking…';
    play('thinking', { loops: Infinity });
    const res = await questCall('POST', `/tasks/${t.id}/breakdown`);
    if (res) {
      play('give-quest', { loops: 3 });
      setStatus(questStatus, "Here's the plan! Check off each step as you go.");
    } else {
      play(baseState);
    }
  }

  $('quest-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const box = $('quest-input');
    const title = box.value.trim();
    if (!title) return;
    const res = await questCall('POST', '/tasks', { title });
    if (res) {
      box.value = '';
      play('give-quest', { loops: 2 });
      setStatus(questStatus, 'New quest added! Want me to break it into steps?');
    }
  });

  // =====================================================================
  // Focus timer
  // =====================================================================
  const timer = { mode: 'focus', remaining: 25 * 60, running: false, endAt: 0, untouched: true, tick: null };
  const focusLen = () => (state?.settings.focusMinutes ?? 25) * 60;
  const breakLen = () => (state?.settings.breakMinutes ?? 5) * 60;
  const mmss = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

  function renderTimer() {
    const isBreak = timer.mode === 'break';
    $('focus-mode').textContent = isBreak ? 'Break time' : 'Focus round';
    $('focus-time').textContent = mmss(timer.remaining);
    $('focus-time').classList.toggle('break', isBreak);
    $('focus-start').textContent = timer.running ? 'Pause' : timer.untouched ? 'Start' : 'Resume';
    if (examActive) {
      const left = Math.max(0, Math.round((examEndsAt - Date.now()) / 1000));
      pill.hidden = false;
      pill.textContent = `Exam ${mmss(left)}`;
      pill.classList.remove('break');
      pill.classList.add('exam');
      return;
    }
    pill.classList.remove('exam');
    pill.hidden = !timer.running;
    pill.textContent = `${isBreak ? 'Break' : 'Focus'} ${mmss(timer.remaining)}`;
    pill.classList.toggle('break', isBreak);
    if (!$('focus-note').dataset.custom) {
      const n = state?.today.focusSessions ?? 0;
      $('focus-note').textContent = timer.running
        ? isBreak
          ? 'Stretch, drink some water, rest your eyes.'
          : "I'll stay quiet while you work. You've got this!"
        : `Focus rounds today: ${n}. Each one earns 5 stars.`;
    }
  }

  function startTimer() {
    timer.running = true;
    timer.untouched = false;
    timer.endAt = Date.now() + timer.remaining * 1000;
    clearInterval(timer.tick);
    timer.tick = setInterval(onTick, 250);
    renderTimer();
  }

  function pauseTimer() {
    clearInterval(timer.tick);
    if (timer.running) timer.remaining = Math.max(0, Math.ceil((timer.endAt - Date.now()) / 1000));
    timer.running = false;
    renderTimer();
  }

  function resetTimer() {
    pauseTimer();
    timer.mode = 'focus';
    timer.remaining = focusLen();
    timer.untouched = true;
    renderTimer();
  }

  async function onTick() {
    timer.remaining = Math.max(0, Math.ceil((timer.endAt - Date.now()) / 1000));
    renderTimer();
    if (timer.remaining > 0) return;

    clearInterval(timer.tick);
    timer.running = false;
    if (timer.mode === 'focus') {
      const res = await window.buddy.api('POST', '/focus/complete');
      if (res.ok) applyState(res);
      play('celebrate', { loops: 3 });
      notify(`Focus round done! +5 stars. Take a ${breakLen() / 60}-minute break: stretch and drink some water.`);
      timer.mode = 'break';
      timer.remaining = breakLen();
      startTimer();
    } else {
      play('give-quest', { loops: 2 });
      notify("Break's over! Ready for another focus round?");
      timer.mode = 'focus';
      timer.remaining = focusLen();
      timer.untouched = true;
      renderTimer();
    }
  }

  $('focus-start').addEventListener('click', () => (timer.running ? pauseTimer() : startTimer()));
  $('focus-reset').addEventListener('click', resetTimer);

  // =====================================================================
  // Start
  // =====================================================================
  // A sleeping cloud server can take up to a minute to wake: keep retrying until it answers.
  (async function firstLoad(attempt = 0) {
    if ((await refreshState()) || attempt >= 8) return;
    setTimeout(() => firstLoad(attempt + 1), 15000);
  })();
  renderTimer();
  say(`Hi ${student.name}! Click me when you need help with a quest.`);
})();
