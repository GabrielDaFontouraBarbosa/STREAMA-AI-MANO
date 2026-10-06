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

/* ICE vem do servidor (/api/ice): STUN sempre, TURN da Cloudflare quando
   configurado. A credencial TURN é temporária e nunca fica no HTML. */
const ICE_FALLBACK = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];
let iceCache = null;
/* `sala`: espectador sem conta ganha TURN se o código for de uma sala aberta. */
async function loadIce(sala) {
  if (iceCache && iceCache.until > Date.now() && (iceCache.turn || !sala)) return iceCache.servers;
  try {
    const q = sala ? '?sala=' + encodeURIComponent(sala) : '';
    const j = await fetch('/api/ice' + q, { credentials: 'same-origin' }).then((r) => r.json());
    iceCache = { servers: j.iceServers?.length ? j.iceServers : ICE_FALLBACK, turn: !!j.turn, until: Date.now() + 30 * 60e3 };
  } catch {
    iceCache = { servers: ICE_FALLBACK, turn: false, until: Date.now() + 60e3 };
  }
  return iceCache.servers;
}

/* Reconexão do WebSocket de sinalização: 1s, 2s, 4s… até 8s, e desiste
   depois de RESUME_WINDOW (o servidor segura a sala por 45s). */
const RESUME_WINDOW = 42000;
const backoff = (n) => Math.min(1000 * 2 ** n, 8000);

/* Mídia P2P oscilou: 'disconnected' costuma voltar sozinho em segundos;
   se não voltar, ou se der 'failed', renegocia o ICE (troca de rota). */
const ICE_GRACE_MS = 3500;
// Síncrono: usado dentro dos handlers de sinalização (já pré-carregado).
const iceNow = () => iceCache?.servers ?? ICE_FALLBACK;
const DEFAULT_WS = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ── Preferências ──────────────────────────────────────────── */

const NS = 'blink:';
const NS_LEGACY = 'sam:'; // prefixo da marca anterior

/* Copia as preferências do prefixo antigo pro novo, uma vez só. As chaves
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

/* ── Service worker (PWA + avisos push) ────────────────────── */

if ('serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

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
      // Roving tabindex: Tab entra e sai do grupo inteiro, as setas andam
      // entre as abas. Sem isso o teclado para em cada uma das três.
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
  // Observa as próprias abas: o layout muda ao entrar na sala, não só no resize.
  new ResizeObserver(moveInk).observe($('.tabs'));
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
    $('#signup-btn').hidden = !!me;
    $('#guest-note').hidden = !!me;
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
  let attempt = 0;           // tentativas de reconexão seguidas
  let resumeUntil = 0;       // depois disso, desiste da sala
  let retryTimer = null;
  const peers = new Map();   // viewerId → RTCPeerConnection
  const names = new Map();   // viewerId → nome
  const iceTimers = new Map();   // viewerId → timer do 'disconnected'
  const restarts = new Map();    // viewerId → ICE restarts seguidos

  // Mensagem pro servidor só se o socket estiver aberto; fechado, a
  // renegociação acontece de novo quando ele voltar (room-resumed).
  const sig = (msg) => ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify(msg));

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

  function dropPeer(viewerId) {
    clearTimeout(iceTimers.get(viewerId));
    iceTimers.delete(viewerId);
    restarts.delete(viewerId);
    peers.get(viewerId)?.close();
    peers.delete(viewerId);
  }

  async function offerTo(viewerId) {
    dropPeer(viewerId); // oferta nova sempre começa de uma conexão limpa
    const pc = new RTCPeerConnection({ iceServers: iceNow() });
    // Candidatos que chegarem antes do setRemoteDescription ficam aqui:
    // addIceCandidate rejeita sem descrição remota, e o onmessage é async.
    pc.pendingIce = [];
    peers.set(viewerId, pc);
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    pc.onicecandidate = (e) => {
      if (e.candidate) sig({ type: 'ice-candidate', viewerId, candidate: e.candidate });
    };
    pc.onconnectionstatechange = () => {
      if (peers.get(viewerId) !== pc) return;
      const st = pc.connectionState;
      clearTimeout(iceTimers.get(viewerId));
      if (st === 'connected') restarts.delete(viewerId);
      else if (st === 'disconnected') iceTimers.set(viewerId, setTimeout(() => restartIce(viewerId), ICE_GRACE_MS));
      else if (st === 'failed') restartIce(viewerId);
    };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    sig({ type: 'offer', viewerId, sdp: pc.localDescription, fresh: true });
  }

  // Troca a rota da mídia sem derrubar a conexão (nem o vídeo do outro lado).
  // Três tentativas seguidas sem voltar: recomeça a conexão do zero.
  async function restartIce(viewerId) {
    const pc = peers.get(viewerId);
    if (!pc || !stream || pc.connectionState === 'connected') return;
    const n = (restarts.get(viewerId) || 0) + 1;
    if (n > 3) {
      toast(`Conexão com ${names.get(viewerId) || 'espectador'} instável — recomeçando.`, 'err');
      offerTo(viewerId).catch(() => {});
      return;
    }
    restarts.set(viewerId, n);
    if (pc.signalingState !== 'stable') {
      // Oferta anterior ficou sem resposta (sinalização caiu no meio).
      await pc.setLocalDescription({ type: 'rollback' }).catch(() => {});
    }
    try {
      const offer = await pc.createOffer({ iceRestart: true });
      await pc.setLocalDescription(offer);
      sig({ type: 'offer', viewerId, sdp: pc.localDescription });
    } catch { /* tenta de novo no próximo 'failed' */ }
  }

  // Volta pra sala depois de queda: quem já tem conexão P2P boa fica como
  // está; quem não tem (ou entrou enquanto estávamos fora) recebe oferta.
  async function syncPeer(viewerId, name) {
    if (name) names.set(viewerId, name);
    const pc = peers.get(viewerId);
    const ok = pc && pc.signalingState === 'stable' && !['failed', 'closed'].includes(pc.connectionState);
    if (!ok) await offerTo(viewerId);
  }

  function connect(resume = false) {
    clearTimeout(retryTimer);
    // URL inválida (campo apagado, ws:// faltando) faz o construtor lançar.
    try { ws = new WebSocket(serverEl.value); } catch {
      toast('Endereço do servidor inválido.', 'err', 5000);
      stop();
      return;
    }
    const sock = ws;
    if (!resume) setNet('wait', 'abrindo…');

    sock.onopen = () => {
      sock.send(JSON.stringify(resume
        ? { type: 'host-resume', roomCode, source: mode }
        : { type: 'host-create-room', source: mode }));
      // Proxies (Railway incluso) matam WebSocket ocioso. Um ping leve segura.
      clearInterval(heartbeat);
      heartbeat = setInterval(() => sig({ type: 'ping' }), 20000);
    };

    sock.onmessage = async (ev) => {
      if (ws !== sock) return;
      const m = safeParse(ev.data);
      if (!m) return;
      switch (m.type) {
        case 'room-created':
          attempt = 0;
          roomCode = m.roomCode;
          links = m.links || { room: `/s/${roomCode}`, profile: null };
          $('#copy-profile').hidden = !links.profile;
          scramble(codeEl, roomCode);
          $('#room-tag').textContent = 'sala ' + roomCode;
          setNet('live', 'no ar');
          chat.attach(sock);
          chat.push('', 'Sala aberta. Manda o código pra galera.', true);
          break;

        case 'room-resumed':
          attempt = 0;
          links = m.links || links;
          setNet('live', 'no ar');
          chat.attach(sock);
          chat.push('', 'Conexão com o servidor voltou.', true);
          for (const v of m.viewers || []) await syncPeer(v.viewerId, v.name);
          renderViewers();
          break;

        case 'viewer-joined':
          names.set(m.viewerId, m.name || 'Anônimo');
          await offerTo(m.viewerId);
          renderViewers();
          toast(`${m.name || 'Alguém'} entrou.`, 'ok');
          break;

        case 'viewer-resumed':
          await syncPeer(m.viewerId, m.name);
          renderViewers();
          break;

        case 'restart-ice':
          restartIce(m.viewerId);
          break;

        case 'answer': {
          const pc = peers.get(m.viewerId);
          if (pc?.signalingState !== 'have-local-offer') break;
          await pc.setRemoteDescription(m.sdp).catch(() => {});
          for (const c of pc.pendingIce.splice(0)) await pc.addIceCandidate(c).catch(() => {});
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
          dropPeer(m.viewerId);
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

    // Caiu a sinalização: o vídeo P2P continua. Reconecta e retoma a mesma sala.
    sock.onclose = () => {
      if (ws !== sock || !stream) return;
      clearInterval(heartbeat);
      if (!roomCode) { toast('Não consegui abrir a sala. Tenta de novo.', 'err'); stop(); return; }
      if (attempt === 0) resumeUntil = Date.now() + RESUME_WINDOW;
      if (Date.now() > resumeUntil) {
        toast('Sem conexão com o servidor há muito tempo. Transmissão encerrada.', 'err', 6000);
        stop();
        return;
      }
      setNet('wait', 'reconectando…');
      retryTimer = setTimeout(() => connect(true), backoff(attempt++));
    };
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
    document.body.classList.add('in-room');
    renderViewers();
    connect();
  }

  function stop() {
    for (const id of [...peers.keys()]) dropPeer(id);
    names.clear();
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    video.srcObject = null;
    clearInterval(heartbeat);
    clearTimeout(retryTimer);
    attempt = 0;
    sig({ type: 'leave' }); // saída de propósito: o servidor encerra na hora
    const sock = ws;
    ws = null;
    sock?.close();
    roomCode = '';
    links = { room: null, profile: null };
    $('#copy-profile').hidden = true;
    setup.hidden = false;
    live.hidden = true;
    document.body.classList.remove('in-room');
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

  // Fechou a aba: avisa que foi de propósito (senão a sala espera 45s pela volta).
  addEventListener('pagehide', () => sig({ type: 'leave' }));

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

  serverEl.value = DEFAULT_WS;
  $('#viewer-name-field').hidden = !!account.me;
  nameEl.value = account.me?.name ?? prefs.read('name', '');

  codeEl.addEventListener('input', () => {
    codeEl.value = codeEl.value.toUpperCase().replace(/[^0-9A-F]/g, '');
  });
  codeEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });

  let viewerId = null, room = '', attempt = 0, resumeUntil = 0, retryTimer = null, iceTimer = null;
  let pendingIce = []; // candidatos que chegaram antes da oferta ser aplicada
  const sig = (msg) => ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify(msg));

  // Som liberado só com gesto do usuário. Se o navegador barrar o autoplay,
  // toca mudo (melhor que tela preta parecendo "caiu") e avisa.
  function play() {
    video.play().catch(() => {
      video.muted = true;
      video.play().catch(() => {});
      actionToast('O navegador bloqueou o som.', [{ label: 'Ativar som', run: () => { video.muted = false; video.play().catch(() => {}); } }], 15000);
    });
  }

  function setupPeer() {
    pc?.close();
    clearTimeout(iceTimer);
    pendingIce = [];
    const conn = new RTCPeerConnection({ iceServers: iceNow() });
    pc = conn;
    conn.ontrack = (e) => {
      if (video.srcObject !== e.streams[0]) { video.srcObject = e.streams[0]; play(); }
      tuning.hidden = true;
      video.hidden = false;
      setNet('live', 'ao vivo');
    };
    conn.onicecandidate = (e) => {
      if (e.candidate) sig({ type: 'ice-candidate', candidate: e.candidate });
    };
    // Mídia oscilou: espera um pouco (costuma voltar sozinha) e, se não
    // voltar, pede pro host trocar a rota (ICE restart). O vídeo congela
    // no último frame em vez de a sala fechar.
    conn.onconnectionstatechange = () => {
      if (pc !== conn) return;
      clearTimeout(iceTimer);
      const st = conn.connectionState;
      if (st === 'connected') { setNet('live', 'ao vivo'); return; }
      if (st === 'disconnected' || st === 'failed') {
        setNet('wait', 'instável…');
        iceTimer = setTimeout(() => sig({ type: 'restart-ice' }), st === 'failed' ? 0 : ICE_GRACE_MS);
      }
    };
  }

  function showRoom() {
    setup.hidden = true;
    live.hidden = false;
    video.hidden = true;
    tuning.hidden = false;
    document.body.classList.add('in-room');
    $('#room-tag').textContent = 'sala ' + room;
  }

  function connect(resume = false) {
    clearTimeout(retryTimer);
    try { ws = new WebSocket(serverEl.value); } catch {
      toast('Endereço do servidor inválido.', 'err', 5000);
      if (joined) leave();
      else { joinBtn.disabled = false; setNet('idle', 'offline'); }
      return;
    }
    const sock = ws;
    const name = nameEl.value.trim() || 'Anônimo';

    sock.onopen = () => {
      sock.send(JSON.stringify(resume
        ? { type: 'viewer-resume', roomCode: room, viewerId, name }
        : { type: 'viewer-join', roomCode: room, name }));
      clearInterval(heartbeat);
      heartbeat = setInterval(() => sig({ type: 'ping' }), 20000);
    };

    sock.onmessage = async (ev) => {
      if (ws !== sock) return;
      const m = safeParse(ev.data);
      if (!m) return;
      switch (m.type) {
        case 'joined':
          attempt = 0;
          viewerId = m.viewerId;
          chat.attach(sock);
          if (m.resumed) {
            chat.push('', 'Conexão com o servidor voltou.', true);
            if (pc?.connectionState === 'connected') setNet('live', 'ao vivo');
            break;
          }
          joined = true;
          joinBtn.disabled = false;
          showRoom();
          chat.push('', 'Você entrou na sala.', true);
          break;

        case 'offer':
          // Oferta nova (fresh) = conexão do zero. Senão é ICE restart na
          // conexão atual: o vídeo segue tocando enquanto a rota troca.
          if (m.fresh || !pc || pc.connectionState === 'closed') setupPeer();
          try {
            await pc.setRemoteDescription(m.sdp);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            sig({ type: 'answer', sdp: pc.localDescription });
            for (const c of pendingIce.splice(0)) await pc.addIceCandidate(c).catch(() => {});
          } catch {
            sig({ type: 'restart-ice' });
          }
          break;

        case 'ice-candidate':
          if (!m.candidate) break;
          // Perder candidato não dá erro visível: só sobra menos caminho.
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

        case 'resume-failed':
          if (m.retry) sock.close(); // onclose agenda a próxima tentativa
          else { toast('Não deu pra voltar pra sala.', 'err'); leave(); }
          break;

        case 'error':
          toast(m.message, 'err', 5000);
          if (joined) { leave(); break; }
          joinBtn.disabled = false;
          setNet('idle', 'offline');
          ws = null;
          sock.close();
          break;
      }
    };

    // Caiu a sinalização: o vídeo P2P continua. Reconecta e retoma a mesma sala.
    sock.onclose = () => {
      if (ws !== sock) return;
      clearInterval(heartbeat);
      if (!joined) {
        joinBtn.disabled = false;
        setNet('idle', 'offline');
        toast('Não consegui falar com o servidor.', 'err');
        return;
      }
      if (attempt === 0) resumeUntil = Date.now() + RESUME_WINDOW;
      if (Date.now() > resumeUntil) {
        toast('Sem conexão com o servidor há muito tempo. Saí da sala.', 'err', 6000);
        leave();
        return;
      }
      if (pc?.connectionState !== 'connected') setNet('wait', 'reconectando…');
      retryTimer = setTimeout(() => connect(true), backoff(attempt++));
    };
  }

  async function join() {
    const code = codeEl.value.trim().toUpperCase();
    if (code.length !== 6) { toast('O código tem 6 caracteres.', 'err'); codeEl.focus(); return; }

    // Convite de amigo chama join() direto, sem passar pelo botão: sem isso
    // ws, pc e o heartbeat da sessão anterior ficavam pendurados.
    if (ws || joined) leave();

    if (!account.me) prefs.write('name', nameEl.value.trim());
    joinBtn.disabled = true;
    setNet('wait', 'conectando…');
    room = code;
    viewerId = null;
    attempt = 0;
    await loadIce(code); // ICE pronto antes da oferta chegar
    connect(false);
  }

  function leave() {
    joined = false;
    sig({ type: 'leave' }); // saída de propósito: o host fecha a conexão na hora
    clearTimeout(iceTimer);
    clearTimeout(retryTimer);
    pc?.close(); pc = null;
    pendingIce = [];
    clearInterval(heartbeat);
    const sock = ws;
    ws = null;
    sock?.close();
    viewerId = null;
    attempt = 0;
    video.muted = false;
    video.srcObject = null;
    setup.hidden = false;
    live.hidden = true;
    document.body.classList.remove('in-room');
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

  addEventListener('pagehide', () => sig({ type: 'leave' }));

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
    if (host.isLive() || viewer.isLive()) { toast(`${name} entrou ao vivo.`); return; }
    actionToast(`${name} entrou ao vivo.`, [
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
