/* ═══════════════════════════════════════════════════════════
   Blink — cliente
   Sem dependências: WebRTC + WebSocket + Canvas puro.
   Organizado em módulos para poder ser reaproveitado numa
   extensão de navegador depois.
   ═══════════════════════════════════════════════════════════ */

const $ = (s) => document.querySelector(s);

/* Mensagem quebrada não deve derrubar o handler inteiro: sem isso, um
   frame corrompido interrompe o onmessage e a sala trava sem nenhum
   sinal na tela. */
function safeParse(raw) {
  try { return JSON.parse(raw); } catch { return null; }
}

/* Fecha um socket que estamos descartando sem deixar os handlers dele
   rodarem depois. O evento `close` chega assíncrono: se nesse meio-tempo
   uma sessão nova já abriu, o handler antigo mexeria no estado dela
   (matando o heartbeat novo, ou chamando leave() na sala nova). */
function closeQuietly(ws) {
  if (!ws) return;
  ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
  try { ws.close(); } catch { /* já estava fechando */ }
}

/* ICE vem do servidor (/api/ice): STUN sempre, TURN da Cloudflare quando
   configurado. A credencial TURN é temporária e nunca fica no HTML. */
const ICE_FALLBACK = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];
let iceCache = null;
async function loadIce() {
  if (iceCache && iceCache.until > Date.now()) return iceCache.servers;
  try {
    const j = await fetch('/api/ice', { credentials: 'same-origin' }).then((r) => r.json());
    iceCache = { servers: j.iceServers?.length ? j.iceServers : ICE_FALLBACK, until: Date.now() + 30 * 60e3 };
  } catch {
    iceCache = { servers: ICE_FALLBACK, until: Date.now() + 60e3 };
  }
  return iceCache.servers;
}
// Síncrono: usado dentro dos handlers de sinalização (já pré-carregado).
const iceNow = () => iceCache?.servers ?? ICE_FALLBACK;
const DEFAULT_WS = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ── Preferências ──────────────────────────────────────────── */

const NS = 'blink:';
const NS_LEGACY = 'sam:'; // prefixo da marca anterior

/* Copia as preferências do prefixo antigo pro novo. Trocar o prefixo sem
   migrar apagaria o id pessoal de quem já usava — e id novo quer dizer que
   todos os amigos que já te adicionaram nunca mais te encontram. As chaves
   antigas ficam onde estão: não custam nada e servem de rede de segurança. */
(function migratePrefs() {
  try {
    // `myid` marca quem já migrou na versão anterior às contas.
    if (localStorage.getItem(NS + 'migrated') !== null || localStorage.getItem(NS + 'myid') !== null) return;
    const olds = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(NS_LEGACY)) olds.push(k);
    }
    // Só depois de coletar: escrever durante o laço remexe os índices.
    for (const k of olds) {
      localStorage.setItem(NS + k.slice(NS_LEGACY.length), localStorage.getItem(k));
    }
    localStorage.setItem(NS + 'migrated', '1');
  } catch { /* modo privado */ }
})();

const prefs = {
  read(k, fallback) {
    try { const v = localStorage.getItem(NS + k); return v === null ? fallback : JSON.parse(v); }
    catch { return fallback; }
  },
  write(k, v) {
    try { localStorage.setItem(NS + k, JSON.stringify(v)); } catch { /* modo privado */ }
  },
};

/* ── Avisos ────────────────────────────────────────────────── */

function toast(text, kind = 'info', ms = 3400) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.dataset.kind = kind;
  el.append(document.createTextNode(text));
  $('#toasts').append(el);
  setTimeout(() => {
    el.classList.add('out');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }, ms);
}

/* Aviso com botões (pedido de entrada, amigo ao vivo…). */
function actionToast(text, actions, ms = 20000, onTimeout) {
  const el = document.createElement('div');
  el.className = 'toast toast-request';
  const label = document.createElement('span');
  label.textContent = text;
  el.append(label);
  const remove = () => { el.classList.add('out'); el.addEventListener('animationend', () => el.remove(), { once: true }); };
  const timer = setTimeout(() => { onTimeout?.(); remove(); }, ms);
  for (const [i, act] of actions.entries()) {
    const b = document.createElement('button');
    b.className = 'btn btn-sm ' + (i === 0 ? 'btn-primary' : 'btn-quiet');
    b.textContent = act.label;
    b.onclick = () => { clearTimeout(timer); act.run(); remove(); };
    el.append(b);
  }
  $('#toasts').append(el);
}

/* ── Tema ──────────────────────────────────────────────────── */

(function theme() {
  const btn = $('#theme-btn');
  const saved = prefs.read('theme', null);
  if (saved) document.documentElement.dataset.theme = saved;

  const paint = () => {
    const dark = document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === 'dark'
      : !matchMedia('(prefers-color-scheme: light)').matches;
    const icon = btn.querySelector('use');
    icon.setAttribute('href', dark ? '#i-sun' : '#i-moon');
    btn.setAttribute('aria-label', dark ? 'Modo claro' : 'Modo escuro');
    btn.title = dark ? 'Mudar para claro' : 'Mudar para escuro';
  };
  paint();

  btn.onclick = () => {
    const dark = document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === 'dark'
      : !matchMedia('(prefers-color-scheme: light)').matches;
    const next = dark ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    prefs.write('theme', next);
    paint();
  };
})();

/* ── Instalar como app ─────────────────────────────────────── */

(function install() {
  const btn = $('#install-btn');
  let deferred = null;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    btn.hidden = false;
  });

  btn.onclick = async () => {
    if (!deferred) return;
    deferred.prompt();
    const { outcome } = await deferred.userChoice;
    if (outcome === 'accepted') toast('Instalado! Procura o atalho no seu sistema.', 'ok');
    deferred = null;
    btn.hidden = true;
  };

  window.addEventListener('appinstalled', () => {
    btn.hidden = true;
    toast('Pronto, virou app.', 'ok');
  });

  if ('serviceWorker' in navigator) {
    addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();

/* ── Grão de película ──────────────────────────────────────── */

(function grain() {
  if (REDUCED) return;
  const cv = $('#grain');
  const ctx = cv.getContext('2d', { alpha: true });

  // Um tile de 128×128 redesenhado por frame custa ~16k pixels.
  // Preencher a tela inteira custaria ~2M. O padrão repete o tile.
  const SIZE = 128;
  const tile = document.createElement('canvas');
  tile.width = tile.height = SIZE;
  const tctx = tile.getContext('2d');
  const img = tctx.createImageData(SIZE, SIZE);

  function resize() {
    cv.width = innerWidth;
    cv.height = innerHeight;
  }
  resize();
  addEventListener('resize', resize, { passive: true });

  let last = 0;
  let running = true;
  let scheduled = false;

  // O `scheduled` garante um único loop vivo. Sem ele, ao voltar pra aba o
  // visibilitychange agendava um frame novo enquanto o frame que estava
  // pendente desde antes também retomava — dois loops. A cada ida e volta
  // sobrava mais um, e o custo de CPU ia subindo sem motivo aparente.
  function schedule() {
    if (scheduled || !running) return;
    scheduled = true;
    requestAnimationFrame(loop);
  }

  document.addEventListener('visibilitychange', () => {
    running = !document.hidden;
    schedule();
  });

  function loop(now) {
    scheduled = false;
    if (!running) return;
    // 15fps: grão de filme não precisa de 60.
    if (now - last > 66) {
      last = now;
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const v = (Math.random() * 255) | 0;
        d[i] = d[i + 1] = d[i + 2] = v;
        d[i + 3] = 255;
      }
      tctx.putImageData(img, 0, 0);
      ctx.fillStyle = ctx.createPattern(tile, 'repeat');
      ctx.fillRect(0, 0, cv.width, cv.height);
    }
    schedule();
  }
  schedule();
})();

/* ── Onda do topo ──────────────────────────────────────────── */

(function wave() {
  if (REDUCED) return;
  const cv = $('#wave');
  const ctx = cv.getContext('2d');
  let w = 0, h = 0, t = 0, running = true;

  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const r = cv.getBoundingClientRect();
    w = r.width; h = r.height;
    cv.width = w * dpr; cv.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  addEventListener('resize', resize, { passive: true });

  let scheduled = false;
  function schedule() {
    if (scheduled || !running) return;
    scheduled = true;
    requestAnimationFrame(loop);
  }

  document.addEventListener('visibilitychange', () => {
    running = !document.hidden;
    schedule();
  });

  // Três harmônicas sobrepostas: parece sinal, não parece decoração.
  const LAYERS = [
    { amp: 0.20, freq: 1.4, speed: 0.0011, alpha: 0.5, width: 1.6 },
    { amp: 0.13, freq: 2.7, speed: -0.0016, alpha: 0.3, width: 1.2 },
    { amp: 0.07, freq: 4.9, speed: 0.0023, alpha: 0.2, width: 1 },
  ];

  function loop(now) {
    scheduled = false;
    if (!running) return;
    t = now;
    ctx.clearRect(0, 0, w, h);
    const color = getComputedStyle(document.documentElement).getPropertyValue('--signal').trim();
    const mid = h * 0.52;

    for (const L of LAYERS) {
      ctx.beginPath();
      for (let x = 0; x <= w; x += 3) {
        const phase = (x / w) * Math.PI * 2 * L.freq + t * L.speed;
        // Envelope: a onda morre nas bordas em vez de cortar reto.
        const env = Math.sin((x / w) * Math.PI);
        const y = mid + Math.sin(phase) * h * L.amp * env;
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.globalAlpha = L.alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = L.width;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    schedule();
  }
  schedule();
})();

/* ── Revelação no scroll ───────────────────────────────────── */

(function reveals() {
  // Se o navegador tem scroll-driven animations, o CSS já resolve.
  if (CSS.supports('animation-timeline: view()') || REDUCED) return;
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
    }
  }, { rootMargin: '0px 0px -12% 0px', threshold: 0.1 });
  document.querySelectorAll('.reveal').forEach((el) => io.observe(el));
})();

/* ── Abas ──────────────────────────────────────────────────── */

const tabs = (function () {
  const btns = [...document.querySelectorAll('.tab')];
  const ink = $('.tab-ink');

  function moveInk() {
    const active = document.querySelector('.tab.active');
    if (!active) return;
    ink.style.setProperty('--x', active.offsetLeft + 'px');
    ink.style.setProperty('--w', active.offsetWidth + 'px');
  }

  function go(name) {
    btns.forEach((b) => {
      const on = b.dataset.tab === name;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
      // Roving tabindex: num tablist, Tab entra e sai do grupo inteiro e
      // são as setas que andam entre as abas. Sem isso o teclado para em
      // cada uma das três antes de chegar no formulário.
      b.tabIndex = on ? 0 : -1;
    });
    document.querySelectorAll('.pane').forEach((p) => {
      p.classList.toggle('active', p.id === 'pane-' + name);
    });
    moveInk();
  }

  btns.forEach((b, i) => {
    b.onclick = () => go(b.dataset.tab);
    b.onkeydown = (e) => {
      const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      let next = null;
      if (step) next = btns[(i + step + btns.length) % btns.length];
      else if (e.key === 'Home') next = btns[0];
      else if (e.key === 'End') next = btns[btns.length - 1];
      if (!next) return;
      e.preventDefault();
      go(next.dataset.tab);
      next.focus();
    };
  });
  addEventListener('resize', moveInk, { passive: true });
  document.fonts?.ready.then(moveInk);
  requestAnimationFrame(moveInk);

  return { go };
})();

/* ── Utilitários ───────────────────────────────────────────── */

function scramble(el, final, dur = 650) {
  if (REDUCED) { el.textContent = final; return; }
  const CHARS = '0123456789ABCDEF';
  const t0 = performance.now();
  (function tick(now) {
    const p = Math.min(1, (now - t0) / dur);
    const locked = Math.floor(p * final.length);
    let out = '';
    for (let i = 0; i < final.length; i++) {
      out += i < locked ? final[i] : CHARS[(Math.random() * CHARS.length) | 0];
    }
    el.textContent = out;
    if (p < 1) requestAnimationFrame(tick);
    else el.textContent = final;
  })(t0);
}

function fullscreen(el) {
  const d = document;
  if (d.fullscreenElement || d.webkitFullscreenElement) {
    (d.exitFullscreen || d.webkitExitFullscreen).call(d);
    return;
  }
  if (el.requestFullscreen) el.requestFullscreen().catch(() => toast('Tela cheia bloqueada pelo navegador.', 'err'));
  else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
  else if (el.webkitEnterFullscreen) el.webkitEnterFullscreen(); // vídeo no iOS
  else toast('Tela cheia não disponível aqui.', 'err');
}

async function copy(text, msg) {
  try {
    await navigator.clipboard.writeText(text);
    toast(msg, 'ok');
  } catch {
    toast('Não consegui copiar. Copia na mão: ' + text, 'err', 6000);
  }
}

function initials(name) {
  return (name || '?').trim().slice(0, 2).toUpperCase();
}

function setNet(state, label) {
  const pill = $('#net-pill');
  pill.dataset.state = state;
  $('#net-label').textContent = label;
}

/* Diagnóstico honesto em vez de engolir o erro em silêncio. */
function mediaError(err) {
  if (!window.isSecureContext) return 'Precisa de HTTPS pra capturar tela ou câmera.';
  switch (err?.name) {
    case 'NotAllowedError': return 'Você negou a permissão (ou cancelou a escolha).';
    case 'NotFoundError':   return 'Nenhuma câmera/microfone encontrado.';
    case 'NotReadableError':return 'O dispositivo já está em uso por outro programa.';
    case 'AbortError':      return 'A captura foi interrompida.';
    default: return 'Não rolou capturar: ' + (err?.message || 'erro desconhecido');
  }
}

/* ── Chat (compartilhado entre os dois modos) ──────────────── */

const chat = (function () {
  const box = $('#chat');
  const log = $('#chat-log');
  const form = $('#chat-form');
  const input = $('#chat-input');
  let socket = null;

  function attach(ws) { socket = ws; box.hidden = false; }
  function detach() { socket = null; box.hidden = true; log.innerHTML = ''; }

  function push(name, text, sys = false) {
    const li = document.createElement('li');
    if (sys) {
      li.className = 'sys';
      li.textContent = text;
    } else {
      const b = document.createElement('b');
      b.textContent = name;
      li.append(b, document.createTextNode(text));
    }
    log.append(li);
    log.scrollTop = log.scrollHeight;
  }

  form.onsubmit = (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || !socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type: 'chat', text }));
    input.value = '';
  };

  return { attach, detach, push };
})();

/* ── Conta (Better Auth) ───────────────────────────────────── */

/* A sessão mora num cookie httpOnly que o servidor renova sozinho — o
   navegador "lembra" sem guardar token nenhum em localStorage. */
const account = (function () {
  const dlg = $('#auth');
  const loginForm = $('#login-form');
  const signupForm = $('#signup-form');
  const errEl = $('#auth-error');
  let me = null;

  const ERRORS = {
    INVALID_EMAIL_OR_PASSWORD: 'Email ou senha incorretos.',
    INVALID_USERNAME_OR_PASSWORD: 'Usuário ou senha incorretos.',
    USER_ALREADY_EXISTS: 'Já existe uma conta com esse email.',
    USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'Já existe uma conta com esse email.',
    USERNAME_IS_ALREADY_TAKEN: 'Esse usuário já está em uso.',
    USERNAME_IS_ALREADY_TAKEN_PLEASE_TRY_ANOTHER: 'Esse usuário já está em uso.',
    INVALID_USERNAME: 'Usuário inválido: 3–20 letras, números ou _.',
    USERNAME_TOO_SHORT: 'Usuário muito curto (mín. 3).',
    USERNAME_TOO_LONG: 'Usuário muito longo (máx. 20).',
    PASSWORD_TOO_SHORT: 'Senha muito curta (mín. 8).',
    INVALID_EMAIL: 'Email inválido.',
  };

  async function post(url, body) {
    const r = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (r.status === 429) throw new Error('Muitas tentativas. Espera um minutinho.');
      throw new Error(ERRORS[j.code] || j.message || 'Não deu certo. Tenta de novo.');
    }
    return j;
  }

  function showErr(msg) { errEl.textContent = msg; errEl.hidden = !msg; }

  function mode(m) {
    document.querySelectorAll('[data-group="auth"] .seg').forEach((b) => b.classList.toggle('active', b.dataset.auth === m));
    loginForm.hidden = m !== 'login';
    signupForm.hidden = m !== 'signup';
    showErr('');
  }
  document.querySelectorAll('[data-group="auth"] .seg').forEach((b) => (b.onclick = () => mode(b.dataset.auth)));

  function open(m = 'login', why = '') {
    mode(m);
    if (why) $('#auth-title').textContent = why;
    else $('#auth-title').innerHTML = 'Entra no <em>Blink</em>';
    if (!dlg.open) dlg.showModal();
  }

  async function submit(form, fn) {
    const btn = form.querySelector('button');
    btn.disabled = true;
    showErr('');
    try {
      await fn();
      location.reload(); // recarrega já logado (cookie novo vale pros WebSockets)
    } catch (err) {
      showErr(err.message);
      btn.disabled = false;
    }
  }

  loginForm.onsubmit = (e) => {
    e.preventDefault();
    const id = $('#login-id').value.trim();
    const password = $('#login-pass').value;
    submit(loginForm, () => id.includes('@')
      ? post('/api/auth/sign-in/email', { email: id, password, rememberMe: true })
      : post('/api/auth/sign-in/username', { username: id.replace(/^@/, ''), password, rememberMe: true }));
  };

  const suUser = $('#su-username');
  suUser.addEventListener('input', () => {
    suUser.value = suUser.value.replace(/[^A-Za-z0-9_]/g, '');
    $('#su-preview').textContent = '/@' + (suUser.value.toLowerCase() || '…');
  });

  signupForm.onsubmit = (e) => {
    e.preventDefault();
    submit(signupForm, () => post('/api/auth/sign-up/email', {
      name: $('#su-name').value.trim(),
      username: suUser.value.trim(),
      email: $('#su-email').value.trim(),
      password: $('#su-pass').value,
    }));
  };

  $('#auth-guest').onclick = () => dlg.close();
  $('#login-btn').onclick = () => open('login');
  $('#logout-btn').onclick = async () => {
    try { await post('/api/auth/sign-out'); } catch { /* sai mesmo assim */ }
    location.reload();
  };
  document.querySelectorAll('[data-open-auth]').forEach((b) => (b.onclick = () => open('signup')));

  async function load() {
    try {
      const r = await fetch('/api/me', { credentials: 'same-origin' });
      if (r.ok) me = (await r.json()).user;
    } catch { /* servidor dormindo / offline */ }

    $('#me-chip').hidden = !me;
    $('#logout-btn').hidden = !me;
    $('#login-btn').hidden = !!me;
    if (me) {
      $('#me-name').textContent = me.name;
      $('#me-avatar').textContent = initials(me.name);
      $('#me-chip').title = '@' + me.username;
    }
    return me;
  }

  return { get me() { return me; }, load, open };
})();

await account.load();
// Sem conta: pede login logo de cara — menos quando chegou por link de sala,
// que dá pra assistir sem conta.
if (!account.me && !new URLSearchParams(location.search).get('sala')) account.open();
if (account.me) loadIce(); // já deixa as credenciais TURN prontas

/* ── Conexão social (presença de amigos) ───────────────────── */

/* Fica aberta a sessão inteira, separada da conexão de sinalização de
   sala. O servidor sabe quem você é pelo cookie — o cliente não diz. */
const social = (function () {
  let ws = null;
  let retryDelay = 1500;
  let ping = null;
  let stopped = false;
  const queue = [];
  const handlers = new Map();

  function on(type, fn) {
    if (!handlers.has(type)) handlers.set(type, new Set());
    handlers.get(type).add(fn);
  }

  function send(msg) {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    else queue.push(msg);
  }

  function connect() {
    ws = new WebSocket(DEFAULT_WS);
    ws.onopen = () => {
      retryDelay = 1500;
      ws.send(JSON.stringify({ type: 'identify' }));
      while (queue.length) ws.send(JSON.stringify(queue.shift()));
      ping = setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send('{"type":"ping"}'), 25000);
    };
    ws.onmessage = (ev) => {
      const m = safeParse(ev.data);
      if (!m) return;
      if (m.type === 'auth-required') { stopped = true; ws.close(); return; }
      handlers.get(m.type)?.forEach((fn) => fn(m));
    };
    ws.onclose = () => {
      clearInterval(ping);
      if (stopped) return;
      setTimeout(connect, retryDelay);
      retryDelay = Math.min(retryDelay * 1.6, 20000);
    };
    ws.onerror = () => ws.close();
  }

  if (account.me) {
    connect();
    addEventListener('beforeunload', () => { stopped = true; ws?.close(); });
  }

  return {
    on,
    requestJoin(targetUserId) { send({ type: 'join-request', targetUserId }); },
    respond(toUserId, accept) { send({ type: 'join-response', toUserId, accept }); },
  };
})();

/* ── Modo transmissor ──────────────────────────────────────── */

const host = (function () {
  const nameEl = $('#host-name');
  const serverEl = $('#host-server');
  const audioEl = $('#host-audio');
  const startBtn = $('#host-start');
  const stopBtn = $('#host-stop');
  const micBtn = $('#host-mic');
  const switchBtn = $('#host-switch');
  const fsBtn = $('#host-fs');
  const setup = $('#host-setup');
  const live = $('#host-live');
  const video = $('#local-video');
  const codeEl = $('#room-code');
  const listEl = $('#viewer-list');
  const countEl = $('#viewer-n');

  let stream = null;
  let ws = null;
  let heartbeat = null;
  let roomCode = '';
  let links = { room: null, profile: null };
  let mode = prefs.read('mode', 'screen');
  const peers = new Map();   // viewerId → RTCPeerConnection
  const names = new Map();   // viewerId → nome

  serverEl.value = DEFAULT_WS;
  // Logado, o nome vem da conta (o servidor ignora o que o cliente mandar).
  $('#host-name-field').hidden = !!account.me;
  nameEl.value = account.me?.name ?? prefs.read('name', '');
  audioEl.checked = prefs.read('audio', true);

  function updateModeUI() {
    document.querySelectorAll('[data-group="mode"] .seg')
      .forEach((x) => x.classList.toggle('active', x.dataset.mode === mode));
    switchBtn.title = (mode === 'screen' ? 'Trocar pra câmera' : 'Trocar pra tela') + ' (S)';
    switchBtn.setAttribute('aria-label', switchBtn.title);
  }
  document.querySelectorAll('[data-group="mode"] .seg').forEach((b) => {
    b.onclick = () => {
      mode = b.dataset.mode;
      prefs.write('mode', mode);
      updateModeUI();
    };
  });
  updateModeUI();

  function renderViewers() {
    listEl.innerHTML = '';
    countEl.textContent = String(peers.size);
    if (!peers.size) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'Esperando alguém entrar…';
      listEl.append(li);
      return;
    }
    for (const id of peers.keys()) {
      const name = names.get(id) || 'Anônimo';
      const li = document.createElement('li');
      const av = document.createElement('span');
      av.className = 'avatar';
      av.textContent = initials(name);
      li.append(av, document.createTextNode(name));
      listEl.append(li);
    }
  }

  async function offerTo(viewerId) {
    const pc = new RTCPeerConnection({ iceServers: iceNow() });
    // Candidatos que chegarem antes do setRemoteDescription ficam aqui.
    // addIceCandidate rejeita enquanto não existe descrição remota, e como
    // o onmessage é async as duas mensagens podem ser tratadas em paralelo.
    pc.pendingIce = [];
    peers.set(viewerId, pc);
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    pc.onicecandidate = (e) => {
      if (e.candidate) ws.send(JSON.stringify({ type: 'ice-candidate', viewerId, candidate: e.candidate }));
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        toast(`Conexão com ${names.get(viewerId) || 'espectador'} falhou.`, 'err');
      }
    };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    ws.send(JSON.stringify({ type: 'offer', viewerId, sdp: offer }));
  }

  function connect() {
    // URL inválida (campo apagado, ws:// faltando) faz o construtor lançar.
    // Sem isso a captura já tinha começado e a tela ficava "ao vivo" sem
    // nenhuma sala do outro lado.
    try {
      ws = new WebSocket(serverEl.value);
    } catch {
      toast('Endereço do servidor inválido.', 'err', 5000);
      stop();
      return;
    }
    setNet('wait', 'abrindo…');

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'host-create-room', source: mode }));
      // Proxies (Railway incluso) matam WebSocket ocioso. Um ping leve segura.
      heartbeat = setInterval(() => {
        if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
      }, 25000);
    };

    ws.onmessage = async (ev) => {
      const m = safeParse(ev.data);
      if (!m) return;
      switch (m.type) {
        case 'room-created':
          roomCode = m.roomCode;
          links = m.links || { room: `/s/${roomCode}`, profile: null };
          $('#copy-profile').hidden = !links.profile;
          scramble(codeEl, roomCode);
          $('#room-tag').textContent = 'sala ' + roomCode;
          setNet('live', 'no ar');
          chat.attach(ws);
          chat.push('', 'Sala aberta. Manda o código pra galera.', true);
          break;

        case 'viewer-joined':
          names.set(m.viewerId, m.name || 'Anônimo');
          await offerTo(m.viewerId);
          renderViewers();
          toast(`${m.name || 'Alguém'} entrou.`, 'ok');
          break;

        case 'answer': {
          const pc = peers.get(m.viewerId);
          if (!pc) break;
          await pc.setRemoteDescription(m.sdp);
          // Agora que existe descrição remota, drena o que ficou na fila.
          const queued = pc.pendingIce.splice(0);
          for (const c of queued) await pc.addIceCandidate(c).catch(() => {});
          break;
        }

        case 'ice-candidate': {
          const pc = peers.get(m.viewerId);
          if (!pc || !m.candidate) break;
          if (pc.remoteDescription) await pc.addIceCandidate(m.candidate).catch(() => {});
          else pc.pendingIce.push(m.candidate);
          break;
        }

        case 'viewer-left': {
          const pc = peers.get(m.viewerId);
          pc?.close();
          peers.delete(m.viewerId);
          const who = names.get(m.viewerId);
          names.delete(m.viewerId);
          renderViewers();
          if (who) chat.push('', `${who} saiu.`, true);
          break;
        }

        case 'chat':
          chat.push(m.name, m.text);
          break;

        case 'error':
          toast(m.message, 'err', 5000);
          stop();
          break;
      }
    };

    ws.onclose = () => {
      if (stream) { toast('Perdi a conexão com o servidor.', 'err'); stop(); }
    };
    ws.onerror = () => toast('Erro no servidor de sinalização.', 'err');
  }

  async function start() {
    if (!account.me) { account.open('login', 'Entre pra transmitir'); return; }
    if (!navigator.mediaDevices) {
      toast('Seu navegador não permite captura aqui (precisa de HTTPS).', 'err', 6000);
      return;
    }
    loadIce();
    const wantAudio = audioEl.checked;
    startBtn.disabled = true;
    try {
      stream = mode === 'camera'
        ? await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 } }, audio: wantAudio })
        : await navigator.mediaDevices.getDisplayMedia({
            video: { frameRate: { ideal: 30 } },
            audio: wantAudio,
          });
    } catch (err) {
      toast(mediaError(err), 'err', 5000);
      startBtn.disabled = false;
      return;
    }
    startBtn.disabled = false;

    prefs.write('audio', wantAudio);
    await loadIce();

    // Quando o usuário clica "parar de compartilhar" na barra do navegador.
    stream.getVideoTracks()[0].addEventListener('ended', stop);

    video.srcObject = stream;
    micBtn.hidden = !stream.getAudioTracks().length;
    setup.hidden = true;
    live.hidden = false;
    renderViewers();
    connect();
  }

  function stop() {
    peers.forEach((pc) => pc.close());
    peers.clear();
    names.clear();
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    video.srcObject = null;
    clearInterval(heartbeat); heartbeat = null;
    closeQuietly(ws);
    ws = null;
    roomCode = '';
    links = { room: null, profile: null };
    $('#copy-profile').hidden = true;
    setup.hidden = false;
    live.hidden = true;
    codeEl.textContent = '------';
    $('#room-tag').textContent = 'sem sala';
    setNet('idle', 'offline');
    chat.detach();
    micBtn.setAttribute('aria-pressed', 'false');
    micBtn.querySelector('use').setAttribute('href', '#i-mic');
  }

  // Troca a fonte (tela ↔ câmera) sem derrubar a sala: substitui só a
  // track de vídeo em cada conexão já aberta (replaceTrack), então não
  // precisa renegociar nem os espectadores percebem um corte.
  async function switchSource() {
    if (!stream || switchBtn.disabled) return;
    const nextMode = mode === 'screen' ? 'camera' : 'screen';
    let newStream;
    switchBtn.disabled = true;
    try {
      newStream = nextMode === 'camera'
        ? await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 } }, audio: false })
        : await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30 } }, audio: false });
    } catch (err) {
      toast(mediaError(err), 'err', 5000);
      switchBtn.disabled = false;
      return;
    }

    const newTrack = newStream.getVideoTracks()[0];
    const oldTrack = stream.getVideoTracks()[0];

    for (const pc of peers.values()) {
      const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
      await sender?.replaceTrack(newTrack);
    }

    oldTrack.stop();
    stream.removeTrack(oldTrack);
    stream.addTrack(newTrack);
    video.srcObject = stream;
    newTrack.addEventListener('ended', stop);

    mode = nextMode;
    prefs.write('mode', mode);
    updateModeUI();
    switchBtn.disabled = false;
    toast('Fonte trocada ao vivo!', 'ok');
  }

  // Amigo pediu pra entrar — só aceita/recusa se ainda estiver no ar. O
  // servidor é quem manda o código da sala pra ele, e só se você aceitar.
  social.on('incoming-request', ({ from }) => {
    if (!stream) { social.respond(from.id, false); return; }
    actionToast(`${from.name} (@${from.username}) quer entrar na sua sala.`, [
      { label: 'Aceitar', run: () => { social.respond(from.id, true); toast(`${from.name} foi liberado pra entrar!`, 'ok'); } },
      { label: 'Recusar', run: () => social.respond(from.id, false) },
    ], 20000, () => social.respond(from.id, false));
  });

  startBtn.onclick = start;
  stopBtn.onclick = stop;
  switchBtn.onclick = switchSource;
  fsBtn.onclick = () => fullscreen(video);

  micBtn.onclick = () => {
    const track = stream?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    micBtn.setAttribute('aria-pressed', String(!track.enabled));
    micBtn.querySelector('use').setAttribute('href', track.enabled ? '#i-mic' : '#i-micoff');
    toast(track.enabled ? 'Áudio ligado' : 'Áudio mudo');
  };

  $('#copy-code').onclick = () => copy(roomCode, 'Código copiado!');
  $('#copy-link').onclick = async () => {
    const url = location.origin + (links.room || `/s/${roomCode}`);
    // Compartilhamento nativo no celular; área de transferência no resto.
    if (navigator.share) {
      try { await navigator.share({ title: 'Blink', text: 'Entra na minha sala', url }); return; }
      catch { /* usuário cancelou — cai pro clipboard */ }
    }
    copy(`Bora assistir: ${url}`, 'Convite copiado!');
  };
  // Link fixo /@usuario: só amigos conseguem pedir pra entrar por ele.
  $('#copy-profile').onclick = () => links.profile && copy(location.origin + links.profile, 'Link pros amigos copiado!');

  return {
    isLive: () => !!stream,
    code: () => roomCode,
    fs: () => fullscreen(video),
    mic: () => micBtn.onclick(),
    switchSource: () => switchSource(),
  };
})();

/* ── Modo espectador ───────────────────────────────────────── */

const viewer = (function () {
  const nameEl = $('#viewer-name');
  const serverEl = $('#viewer-server');
  const codeEl = $('#room-input');
  const joinBtn = $('#viewer-join');
  const leaveBtn = $('#viewer-leave');
  const setup = $('#viewer-setup');
  const live = $('#viewer-live');
  const video = $('#remote-video');
  const tuning = $('#tuning');

  let ws = null, pc = null, heartbeat = null, joined = false;
  let pendingIce = [];
  const wrapEl = $('.console-wrap');

  serverEl.value = DEFAULT_WS;
  $('#viewer-name-field').hidden = !!account.me;
  nameEl.value = account.me?.name ?? prefs.read('name', '');

  codeEl.addEventListener('input', () => {
    codeEl.value = codeEl.value.toUpperCase().replace(/[^0-9A-F]/g, '');
  });
  codeEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });

  function setupPeer() {
    pc?.close(); // se o host reofertar, não deixa a conexão antiga pendurada
    pc = new RTCPeerConnection({ iceServers: iceNow() });
    pc.ontrack = (e) => {
      video.srcObject = e.streams[0];
      tuning.hidden = true;
      video.hidden = false;
      setNet('live', 'ao vivo');
    };
    pc.onicecandidate = (e) => {
      if (e.candidate) ws.send(JSON.stringify({ type: 'ice-candidate', candidate: e.candidate }));
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') toast('Conexão P2P falhou. Rede muito restrita?', 'err', 5000);
    };
  }

  async function join() {
    const code = codeEl.value.trim().toUpperCase();
    if (code.length !== 6) { toast('O código tem 6 caracteres.', 'err'); codeEl.focus(); return; }

    // Entrar por cima de uma sessão aberta deixava ws, pc e o interval do
    // heartbeat pendurados pra sempre (o `join` por convite de amigo entra
    // sem passar pelo botão, que é o que normalmente bloqueia isso).
    if (ws || joined) leave();

    if (!account.me) prefs.write('name', nameEl.value.trim());
    joinBtn.disabled = true;
    setNet('wait', 'conectando…');
    await loadIce(); // ICE pronto antes da oferta chegar

    try {
      ws = new WebSocket(serverEl.value);
    } catch {
      toast('Endereço do servidor inválido.', 'err', 5000);
      joinBtn.disabled = false;
      setNet('idle', 'offline');
      return;
    }

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'viewer-join', roomCode: code, name: nameEl.value.trim() || 'Anônimo' }));
      heartbeat = setInterval(() => {
        if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
      }, 25000);
    };

    ws.onmessage = async (ev) => {
      const m = safeParse(ev.data);
      if (!m) return;
      switch (m.type) {
        case 'joined':
          joined = true;
          joinBtn.disabled = false;
          setup.hidden = true;
          live.hidden = false;
          video.hidden = true;
          tuning.hidden = false;
          wrapEl.classList.add('wide');
          $('#room-tag').textContent = 'sala ' + code;
          chat.attach(ws);
          chat.push('', 'Você entrou na sala.', true);
          break;

        case 'offer': {
          setupPeer();
          await pc.setRemoteDescription(m.sdp);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          ws.send(JSON.stringify({ type: 'answer', sdp: answer }));
          // O host já começou a trilhar candidatos enquanto isso: aplica os
          // que chegaram antes da descrição remota existir.
          const queued = pendingIce.splice(0);
          for (const c of queued) await pc.addIceCandidate(c).catch(() => {});
          break;
        }

        case 'ice-candidate':
          if (!m.candidate) break;
          // Perder candidato aqui não dá erro visível — só faz a conexão
          // falhar ou demorar, porque sobra menos caminho pra tentar.
          if (pc?.remoteDescription) await pc.addIceCandidate(m.candidate).catch(() => {});
          else pendingIce.push(m.candidate);
          break;

        case 'chat':
          chat.push(m.name, m.text);
          break;

        case 'host-left':
          toast('O transmissor encerrou a sala.', 'err');
          leave();
          break;

        case 'error':
          toast(m.message, 'err', 5000);
          joinBtn.disabled = false;
          setNet('idle', 'offline');
          ws.close();
          break;
      }
    };

    ws.onclose = () => {
      clearInterval(heartbeat);
      joinBtn.disabled = false;
      if (joined) { toast('Conexão encerrada.', 'err'); leave(); }
    };
    ws.onerror = () => { toast('Não consegui falar com o servidor.', 'err'); joinBtn.disabled = false; };
  }

  function leave() {
    joined = false;
    pc?.close(); pc = null;
    pendingIce = [];
    clearInterval(heartbeat); heartbeat = null;
    closeQuietly(ws); ws = null;
    video.srcObject = null;
    video.hidden = true;
    tuning.hidden = true;
    setup.hidden = false;
    live.hidden = true;
    wrapEl.classList.remove('wide');
    $('#room-tag').textContent = 'sem sala';
    setNet('idle', 'offline');
    chat.detach();
  }

  // Chamado quando um amigo aceita seu pedido de entrada: preenche o
  // código que só ele revelou e entra direto, sem o usuário digitar nada.
  function requestedJoin(code) {
    tabs.go('viewer');
    codeEl.value = code;
    join();
  }

  joinBtn.onclick = join;
  leaveBtn.onclick = leave;
  $('#viewer-fs').onclick = () => fullscreen(video);
  $('#viewer-pip').onclick = async () => {
    if (!document.pictureInPictureEnabled) { toast('Janela flutuante não suportada.', 'err'); return; }
    try {
      document.pictureInPictureElement
        ? await document.exitPictureInPicture()
        : await video.requestPictureInPicture();
    } catch { toast('Não deu pra abrir a janela flutuante.', 'err'); }
  };

  // Link de convite: ?sala=A1B2C3 já abre na aba certa, preenchida.
  const invited = new URLSearchParams(location.search).get('sala');
  if (invited) {
    codeEl.value = invited.toUpperCase().slice(0, 6);
    tabs.go('viewer');
    setTimeout(() => nameEl.value ? joinBtn.focus() : nameEl.focus(), 300);
  }

  return { isLive: () => joined, fs: () => fullscreen(video), requestedJoin };
})();

/* Resposta do amigo a um "pedir pra entrar": aceito entra direto,
   recusado ou offline avisa por quê. */
social.on('join-response', ({ accept, roomCode, reason }) => {
  if (accept) {
    toast('Pedido aceito! Entrando...', 'ok');
    viewer.requestedJoin(roomCode);
  } else if (reason === 'offline') {
    toast('Esse amigo não está transmitindo agora.', 'err');
  } else {
    toast('Seu pedido foi recusado.', 'err');
  }
});

/* ── Amigos ────────────────────────────────────────────────── */

const friends = (function () {
  const listEl = $('#friend-list');
  const countEl = $('#friend-n');
  const reqBox = $('#requests');
  const reqList = $('#request-list');
  const reqCount = $('#request-n');
  const addForm = $('#friend-add');
  const addInput = $('#friend-add-username');

  const guest = !account.me;
  $('#friends-guest').hidden = !guest;
  $('#friends-app').hidden = guest;
  if (guest) return { requestJoin() {}, refresh() {} };

  const me = account.me;
  const myLink = `${location.origin}/@${me.username}`;
  $('#my-link').value = myLink;
  $('#my-username').textContent = '@' + me.username;
  $('#my-link-copy').onclick = () => copy(myLink, 'Seu link foi copiado!');
  $('#my-link').onclick = () => $('#my-link').select();

  let data = { friends: [], incoming: [], outgoing: [] };
  const status = new Map(); // userId → 'live' | 'online' | 'offline'

  const ERR = {
    not_found: 'Não achei ninguém com esse usuário.',
    self: 'Esse é você!',
    already_friends: 'Vocês já são amigos.',
    already_requested: 'Pedido já enviado — falta a outra pessoa aceitar.',
    username_required: 'Digita o usuário.',
  };

  async function api(method, url, body) {
    const r = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(ERR[j.error] || 'Algo deu errado. Tenta de novo.');
    return j;
  }

  async function refresh() {
    try {
      data = await api('GET', '/api/friends');
      for (const f of data.friends) status.set(f.id, f.status);
      render();
    } catch { /* offline — mantém a lista anterior */ }
  }

  function requestJoin(userId, name) {
    social.requestJoin(userId);
    toast(`Pedido enviado pra ${name}. Esperando resposta…`);
  }

  function row(user, extra = []) {
    const li = document.createElement('li');
    li.className = 'friend-row';
    const av = document.createElement('span');
    av.className = 'avatar';
    av.textContent = initials(user.name);
    const name = document.createElement('span');
    name.className = 'friend-name';
    name.textContent = user.name;
    const sub = document.createElement('span');
    sub.className = 'friend-sub';
    sub.textContent = '@' + user.username;
    name.append(sub);
    li.append(av, name, ...extra);
    return li;
  }

  function button(label, cls, fn) {
    const b = document.createElement('button');
    b.className = 'btn btn-sm ' + cls;
    b.textContent = label;
    b.onclick = async () => {
      b.disabled = true;
      try { await fn(b); } catch (err) { toast(err.message, 'err'); b.disabled = false; }
    };
    return b;
  }

  function render() {
    // Pedidos
    reqList.innerHTML = '';
    const nReq = data.incoming.length + data.outgoing.length;
    reqBox.hidden = !nReq;
    reqCount.textContent = String(data.incoming.length);
    for (const r of data.incoming) {
      reqList.append(row(r.user, [
        button('Aceitar', 'btn-primary', async () => { await api('POST', '/api/friends/accept', { requestId: r.requestId }); toast(`Você e ${r.user.name} agora são amigos!`, 'ok'); refresh(); }),
        button('Recusar', 'btn-quiet', async () => { await api('POST', '/api/friends/decline', { requestId: r.requestId }); refresh(); }),
      ]));
    }
    for (const r of data.outgoing) {
      reqList.append(row(r.user, [
        button('Cancelar pedido', 'btn-quiet', async () => { await api('POST', '/api/friends/decline', { requestId: r.requestId }); refresh(); }),
      ]));
    }

    // Amigos — ao vivo primeiro, depois online, depois o resto
    const order = { live: 0, online: 1, offline: 2 };
    const list = [...data.friends].sort((a, b) =>
      (order[status.get(a.id)] ?? 2) - (order[status.get(b.id)] ?? 2) || a.name.localeCompare(b.name));

    listEl.innerHTML = '';
    countEl.textContent = String(list.length);
    if (!list.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'Nenhum amigo ainda. Manda seu link!';
      listEl.append(li);
      return;
    }
    for (const f of list) {
      const st = status.get(f.id) || 'offline';
      const dot = document.createElement('span');
      dot.className = 'friend-dot';
      dot.dataset.status = st;
      dot.title = st === 'live' ? 'Ao vivo agora' : st === 'online' ? 'Online' : 'Offline';

      const extra = [];
      if (st === 'live') {
        extra.push(button('Pedir pra entrar', 'btn-primary', (b) => {
          requestJoin(f.id, f.name);
          b.textContent = 'Pedido enviado…';
          setTimeout(() => { b.disabled = false; b.textContent = 'Pedir pra entrar'; }, 20000);
        }));
      }
      const rm = document.createElement('button');
      rm.className = 'iconbtn friend-rm';
      rm.setAttribute('aria-label', `Remover ${f.name}`);
      rm.innerHTML = '<svg class="ic"><use href="#i-close"/></svg>';
      rm.onclick = async () => {
        if (!confirm(`Remover ${f.name} dos seus amigos?`)) return;
        try { await api('DELETE', `/api/friends/${encodeURIComponent(f.id)}`); refresh(); }
        catch (err) { toast(err.message, 'err'); }
      };
      extra.push(rm);

      const li = row(f, extra);
      li.prepend(dot);
      listEl.append(li);
    }
  }

  addInput.addEventListener('input', () => {
    addInput.value = addInput.value.replace(/[^A-Za-z0-9_@]/g, '');
  });

  addForm.onsubmit = async (e) => {
    e.preventDefault();
    const username = addInput.value.trim().replace(/^@/, '');
    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) { toast('Usuário inválido.', 'err'); addInput.focus(); return; }
    const btn = $('#friend-add-btn');
    btn.disabled = true;
    try {
      const r = await api('POST', '/api/friends/request', { username });
      toast(r.result === 'accepted' ? `Você e ${r.user.name} agora são amigos!` : `Pedido enviado pra @${r.user.username}.`, 'ok');
      addInput.value = '';
      refresh();
    } catch (err) {
      toast(err.message, 'err');
    }
    btn.disabled = false;
  };

  social.on('presence-snapshot', ({ friends: list }) => {
    for (const f of list) status.set(f.userId, f.status);
    render();
  });
  social.on('presence', ({ userId, status: st }) => { status.set(userId, st); render(); });
  social.on('friends-changed', refresh);
  social.on('friend-request', ({ from }) => {
    actionToast(`${from.name} (@${from.username}) quer ser seu amigo.`, [
      { label: 'Ver pedido', run: () => tabs.go('friends') },
    ], 8000);
  });
  social.on('friend-accepted', ({ by }) => toast(`${by.name} aceitou seu pedido!`, 'ok'));
  social.on('friend-went-live', ({ userId, name }) => {
    if (host.isLive() || viewer.isLive()) { toast(`🔴 ${name} entrou ao vivo.`); return; }
    actionToast(`🔴 ${name} entrou ao vivo.`, [
      { label: 'Pedir pra entrar', run: () => requestJoin(userId, name) },
      { label: 'Depois', run: () => {} },
    ], 12000);
  });

  refresh();
  return { requestJoin, refresh };
})();

/* ── Avisos push (app fechado) ─────────────────────────────── */

(async function pushNotifications() {
  const btn = $('#push-btn');
  const rowEl = btn.closest('.push-row');
  rowEl.hidden = true;
  if (!account.me || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return;

  let key = null;
  try { key = (await fetch('/api/push/key').then((r) => r.json())).publicKey; } catch { /* sem push */ }
  if (!key) return;

  const toBytes = (b64) => {
    const pad = '='.repeat((4 - (b64.length % 4)) % 4);
    const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  };
  const save = (sub) => fetch('/api/push/subscribe', {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription: sub.toJSON() }),
  });

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  const paint = () => {
    btn.textContent = sub ? 'Avisos ligados ✓' : 'Ativar avisos';
    btn.classList.toggle('btn-primary', !sub);
    btn.classList.toggle('btn-quiet', !!sub);
  };
  if (sub) save(sub).catch(() => {}); // garante que está ligada à conta atual
  rowEl.hidden = false;
  paint();

  btn.onclick = async () => {
    btn.disabled = true;
    try {
      if (sub) {
        await fetch('/api/push/unsubscribe', {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
        sub = null;
        toast('Avisos desligados neste aparelho.');
      } else {
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') { toast('Sem permissão de notificação no navegador.', 'err'); return; }
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toBytes(key) });
        const r = await save(sub);
        if (!r.ok) throw new Error();
        toast('Pronto! Você vai ser avisado quando um amigo entrar ao vivo.', 'ok');
      }
    } catch {
      toast('Não consegui ativar os avisos aqui. No iPhone, instale o Blink na tela inicial primeiro.', 'err', 6000);
    } finally {
      btn.disabled = false;
      paint();
    }
  };
})();

/* ── Link /@usuario ────────────────────────────────────────── */

/* O servidor redireciona blink…/@fulano pra ?perfil=fulano. Se vocês são
   amigos e ele está ao vivo, já manda o pedido pra entrar. */
(async function profileLink() {
  const u = new URLSearchParams(location.search).get('perfil');
  if (!u) return;
  if (!account.me) { account.open('login', `Entre pra ver @${u}`); return; }
  history.replaceState(null, '', location.pathname);
  if (u === account.me.username) { tabs.go('friends'); return; }

  const r = await fetch(`/api/users/${encodeURIComponent(u)}`, { credentials: 'same-origin' });
  if (!r.ok) { toast(`Não achei @${u}.`, 'err'); return; }
  const { user, friendship, status } = await r.json();
  tabs.go('friends');

  if (friendship?.status === 'accepted') {
    if (status === 'live') friends.requestJoin(user.id, user.name);
    else toast(`${user.name} não está ao vivo agora.`);
  } else if (friendship?.status === 'pending') {
    toast(friendship.outgoing ? `Seu pedido pra @${u} ainda está pendente.` : `@${u} te mandou um pedido — aceita aí embaixo.`);
  } else {
    $('#friend-add-username').value = '@' + u;
    toast(`Você e @${u} ainda não são amigos — manda um pedido!`);
  }
})();

/* ── Atalhos do app instalado (?aba=host|viewer) ───────────── */

(function deepLinkTab() {
  const p = new URLSearchParams(location.search);
  if (p.get('sala') || p.get('perfil')) return; // convite manda mais que atalho
  const aba = p.get('aba');
  if (aba === 'host' || aba === 'viewer' || aba === 'friends') tabs.go(aba);
})();

/* ── Atalhos de teclado ────────────────────────────────────── */

addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target;
  if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return;

  switch (e.key.toLowerCase()) {
    case 'f':
      if (host.isLive()) host.fs();
      else if (viewer.isLive()) viewer.fs();
      break;
    case 'm':
      if (host.isLive()) host.mic();
      break;
    case 's':
      if (host.isLive()) host.switchSource();
      break;
    case 'p':
      if (viewer.isLive()) $('#viewer-pip').click();
      break;
    case 'c':
      if (host.isLive()) copy(host.code(), 'Código copiado!');
      break;
  }
});
