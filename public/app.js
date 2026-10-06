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

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];
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
    if (localStorage.getItem(NS + 'myid') !== null) return; // já migrado
    const olds = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(NS_LEGACY)) olds.push(k);
    }
    // Só depois de coletar: escrever durante o laço remexe os índices.
    for (const k of olds) {
      localStorage.setItem(NS + k.slice(NS_LEGACY.length), localStorage.getItem(k));
    }
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

/* Identidade local: um código de 8 caracteres gerado uma vez e guardado
   no navegador. É o "seu id" que os amigos usam pra te reconhecer —
   nunca sai daqui sem você compartilhar, e o servidor não liga isso a
   nenhum outro dado seu. */
const MY_ID = (function () {
  let id = prefs.read('myid', null);
  if (!id || !/^[0-9A-F]{8}$/.test(id)) {
    id = crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
    prefs.write('myid', id);
  }
  return id;
})();

function currentName() {
  return prefs.read('name', '').trim() || 'Anônimo';
}

/* Os três campos de "Seu nome" (transmitir, assistir, amigos) mostram o
   mesmo dado. Cada um lia a preferência só no carregamento, então editar
   numa aba não aparecia nas outras — e o último blur sobrescrevia em
   silêncio o que você tinha acabado de digitar na aba anterior. */
const nameFields = new Set();
function registerNameField(el) {
  el.value = prefs.read('name', '');
  nameFields.add(el);
  el.addEventListener('input', () => {
    for (const other of nameFields) if (other !== el) other.value = el.value;
  });
  el.addEventListener('blur', () => {
    prefs.write('name', el.value.trim());
    social.reidentify();
  });
}

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

/* ── Conexão social (presença de amigos) ───────────────────── */

/* Fica aberta a sessão inteira, separada da conexão de sinalização de
   sala — assim dá pra receber pedido de entrada mesmo sem ter aberto
   a aba Amigos, e a lista de amigos atualiza mesmo fora dela. */
const social = (function () {
  let ws = null;
  let lastWatch = [];
  let retryDelay = 1500;
  const onPresence = new Set();
  const onRequest = new Set();
  const onResponse = new Set();

  function send(msg) {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  function identify() {
    send({ type: 'identify', id: MY_ID, name: currentName() });
  }

  function connect() {
    ws = new WebSocket(DEFAULT_WS);
    ws.onopen = () => {
      retryDelay = 1500;
      identify();
      if (lastWatch.length) send({ type: 'watch-friends', ids: lastWatch });
    };
    ws.onmessage = (ev) => {
      const m = safeParse(ev.data);
      if (!m) return;
      if (m.type === 'presence') onPresence.forEach((fn) => fn(m));
      else if (m.type === 'incoming-request') onRequest.forEach((fn) => fn(m));
      else if (m.type === 'join-response') onResponse.forEach((fn) => fn(m));
    };
    ws.onclose = () => {
      setTimeout(connect, retryDelay);
      retryDelay = Math.min(retryDelay * 1.6, 20000);
    };
    ws.onerror = () => ws.close();
  }
  connect();
  addEventListener('beforeunload', () => { ws.onclose = null; ws.close(); });

  return {
    reidentify: identify,
    watch(ids) { lastWatch = ids; send({ type: 'watch-friends', ids }); },
    requestJoin(targetId) { send({ type: 'join-request', targetId, fromName: currentName() }); },
    respond(toId, accept, roomCode) { send({ type: 'join-response', toId, accept, roomCode }); },
    onPresence: (fn) => onPresence.add(fn),
    onRequest: (fn) => onRequest.add(fn),
    onResponse: (fn) => onResponse.add(fn),
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
  let mode = prefs.read('mode', 'screen');
  const peers = new Map();   // viewerId → RTCPeerConnection
  const names = new Map();   // viewerId → nome

  serverEl.value = DEFAULT_WS;
  registerNameField(nameEl);
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
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
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
      ws.send(JSON.stringify({
        type: 'host-create-room',
        name: nameEl.value.trim() || 'Host',
        hostSocialId: MY_ID,
      }));
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
      }
    };

    ws.onclose = () => {
      if (stream) { toast('Perdi a conexão com o servidor.', 'err'); stop(); }
    };
    ws.onerror = () => toast('Erro no servidor de sinalização.', 'err');
  }

  async function start() {
    if (!navigator.mediaDevices) {
      toast('Seu navegador não permite captura aqui (precisa de HTTPS).', 'err', 6000);
      return;
    }
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

    prefs.write('name', nameEl.value.trim());
    prefs.write('audio', wantAudio);

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

  // Amigo pediu pra entrar — só aceita/recusa se ainda estiver no ar.
  social.onRequest(({ fromId, fromName }) => {
    if (!stream) { social.respond(fromId, false); return; }
    const el = document.createElement('div');
    el.className = 'toast toast-request';
    const label = document.createElement('span');
    label.textContent = `${fromName} quer entrar na sua sala.`;
    const accept = document.createElement('button');
    accept.className = 'btn btn-primary btn-sm';
    accept.textContent = 'Aceitar';
    const decline = document.createElement('button');
    decline.className = 'btn btn-quiet btn-sm';
    decline.textContent = 'Recusar';
    el.append(label, accept, decline);
    $('#toasts').append(el);
    const remove = () => { el.classList.add('out'); el.addEventListener('animationend', () => el.remove(), { once: true }); };
    const timer = setTimeout(() => { social.respond(fromId, false); remove(); }, 20000);
    accept.onclick = () => { clearTimeout(timer); social.respond(fromId, true, roomCode); remove(); toast(`${fromName} foi liberado pra entrar!`, 'ok'); };
    decline.onclick = () => { clearTimeout(timer); social.respond(fromId, false); remove(); };
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
    const url = `${location.origin}${location.pathname}?sala=${roomCode}`;
    const text = `Bora assistir: ${url}`;
    // Compartilhamento nativo no celular; área de transferência no resto.
    if (navigator.share) {
      try { await navigator.share({ title: 'Blink', text: 'Entra na minha sala', url }); return; }
      catch { /* usuário cancelou — cai pro clipboard */ }
    }
    copy(text, 'Convite copiado!');
  };

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
  registerNameField(nameEl);

  codeEl.addEventListener('input', () => {
    codeEl.value = codeEl.value.toUpperCase().replace(/[^0-9A-F]/g, '');
  });
  codeEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });

  function setupPeer() {
    pc?.close(); // se o host reofertar, não deixa a conexão antiga pendurada
    pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
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

  function join() {
    const code = codeEl.value.trim().toUpperCase();
    if (code.length !== 6) { toast('O código tem 6 caracteres.', 'err'); codeEl.focus(); return; }

    // Entrar por cima de uma sessão aberta deixava ws, pc e o interval do
    // heartbeat pendurados pra sempre (o `join` por convite de amigo entra
    // sem passar pelo botão, que é o que normalmente bloqueia isso).
    if (ws || joined) leave();

    prefs.write('name', nameEl.value.trim());
    joinBtn.disabled = true;
    setNet('wait', 'conectando…');

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
social.onResponse(({ accept, roomCode, reason }) => {
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
  const myIdEl = $('#my-id');
  const myIdCopyBtn = $('#my-id-copy');
  const nameEl = $('#friends-name');
  const addIdEl = $('#friend-add-id');
  const addNameEl = $('#friend-add-name');
  const addBtn = $('#friend-add-btn');
  const listEl = $('#friend-list');
  const countEl = $('#friend-n');

  myIdEl.value = MY_ID;
  myIdCopyBtn.onclick = () => copy(MY_ID, 'Seu código foi copiado!');
  myIdEl.onclick = () => myIdEl.select();

  registerNameField(nameEl);

  // O localStorage é editável pelo usuário e sobrevive a mudanças de
  // formato entre versões. Se vier lixo, uma lista vazia é melhor do que
  // um TypeError que mata o resto do script (o render, os atalhos, tudo).
  const storedFriends = prefs.read('friends', []);
  let list = (Array.isArray(storedFriends) ? storedFriends : [])
    .filter((f) => f && typeof f.id === 'string' && /^[0-9A-F]{8}$/.test(f.id))
    .map((f) => ({ id: f.id, label: String(f.label || 'Amigo').slice(0, 24) }));
  const status = new Map(); // id → { status, name }

  function persist() { prefs.write('friends', list); }
  function resubscribe() { social.watch(list.map((f) => f.id)); }

  function render() {
    listEl.innerHTML = '';
    countEl.textContent = String(list.length);
    if (!list.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'Nenhum amigo ainda. Compartilhe seu código!';
      listEl.append(li);
      return;
    }
    for (const f of list) {
      const st = status.get(f.id) || { status: 'offline', name: null };
      const li = document.createElement('li');
      li.className = 'friend-row';

      const dot = document.createElement('span');
      dot.className = 'friend-dot';
      dot.dataset.status = st.status;

      const name = document.createElement('span');
      name.className = 'friend-name';
      name.textContent = st.name || f.label;
      name.title = st.status === 'live' ? 'Ao vivo agora' : st.status === 'idle' ? 'Online' : 'Offline';

      li.append(dot, name);

      if (st.status === 'live') {
        const btn = document.createElement('button');
        btn.className = 'btn btn-primary btn-sm';
        btn.textContent = 'Pedir pra entrar';
        btn.onclick = () => {
          social.requestJoin(f.id);
          btn.disabled = true;
          btn.textContent = 'Pedido enviado…';
          setTimeout(() => { btn.disabled = false; btn.textContent = 'Pedir pra entrar'; }, 20000);
        };
        li.append(btn);
      }

      const rm = document.createElement('button');
      rm.className = 'iconbtn friend-rm';
      rm.setAttribute('aria-label', 'Remover amigo');
      rm.innerHTML = '<svg class="ic"><use href="#i-close"/></svg>';
      rm.onclick = () => { list = list.filter((x) => x.id !== f.id); persist(); resubscribe(); render(); };
      li.append(rm);

      listEl.append(li);
    }
  }

  addIdEl.addEventListener('input', () => {
    addIdEl.value = addIdEl.value.toUpperCase().replace(/[^0-9A-F]/g, '');
  });

  addBtn.onclick = () => {
    const id = addIdEl.value.trim().toUpperCase();
    const label = addNameEl.value.trim() || 'Amigo';
    if (!/^[0-9A-F]{8}$/.test(id)) { toast('Código inválido — são 8 caracteres.', 'err'); addIdEl.focus(); return; }
    if (id === MY_ID) { toast('Esse código é o seu!', 'err'); return; }
    if (list.some((f) => f.id === id)) { toast('Esse amigo já está na lista.', 'err'); return; }
    list.push({ id, label });
    persist();
    resubscribe();
    render();
    addIdEl.value = '';
    addNameEl.value = '';
    toast('Amigo adicionado!', 'ok');
  };

  social.onPresence(({ id, name, status: st }) => {
    status.set(id, { status: st, name });
    render();
  });

  render();
  resubscribe();
})();

/* ── Atalhos do app instalado (?aba=host|viewer) ───────────── */

(function deepLinkTab() {
  const p = new URLSearchParams(location.search);
  if (p.get('sala')) return; // convite manda mais que atalho
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
