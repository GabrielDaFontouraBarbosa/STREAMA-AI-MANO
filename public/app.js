/* ═══════════════════════════════════════════════════════════
   Streama aí, Mano! — cliente
   Sem dependências: WebRTC + WebSocket + Canvas puro.
   Organizado em módulos para poder ser reaproveitado numa
   extensão de navegador depois.
   ═══════════════════════════════════════════════════════════ */

const $ = (s) => document.querySelector(s);
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];
const DEFAULT_WS = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ── Preferências ──────────────────────────────────────────── */

const prefs = {
  read(k, fallback) {
    try { const v = localStorage.getItem('sam:' + k); return v === null ? fallback : JSON.parse(v); }
    catch { return fallback; }
  },
  write(k, v) {
    try { localStorage.setItem('sam:' + k, JSON.stringify(v)); } catch { /* modo privado */ }
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

/* ── Tema ──────────────────────────────────────────────────── */

(function theme() {
  const btn = $('#theme-btn');
  const saved = prefs.read('theme', null);
  if (saved) document.documentElement.dataset.theme = saved;

  const paint = () => {
    const dark = document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === 'dark'
      : !matchMedia('(prefers-color-scheme: light)').matches;
    btn.querySelector('use').setAttribute('href', dark ? '#i-sun' : '#i-moon');
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
  document.addEventListener('visibilitychange', () => {
    running = !document.hidden;
    if (running) requestAnimationFrame(loop);
  });

  function loop(now) {
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
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
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

  document.addEventListener('visibilitychange', () => {
    running = !document.hidden;
    if (running) requestAnimationFrame(loop);
  });

  // Três harmônicas sobrepostas: parece sinal, não parece decoração.
  const LAYERS = [
    { amp: 0.20, freq: 1.4, speed: 0.0011, alpha: 0.5, width: 1.6 },
    { amp: 0.13, freq: 2.7, speed: -0.0016, alpha: 0.3, width: 1.2 },
    { amp: 0.07, freq: 4.9, speed: 0.0023, alpha: 0.2, width: 1 },
  ];

  function loop(now) {
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
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
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
    });
    document.querySelectorAll('.pane').forEach((p) => {
      p.classList.toggle('active', p.id === 'pane-' + name);
    });
    moveInk();
  }

  btns.forEach((b) => (b.onclick = () => go(b.dataset.tab)));
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

/* ── Modo transmissor ──────────────────────────────────────── */

const host = (function () {
  const nameEl = $('#host-name');
  const serverEl = $('#host-server');
  const audioEl = $('#host-audio');
  const startBtn = $('#host-start');
  const stopBtn = $('#host-stop');
  const micBtn = $('#host-mic');
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
  nameEl.value = prefs.read('name', '');
  audioEl.checked = prefs.read('audio', true);
  document.querySelectorAll('[data-group="mode"] .seg').forEach((b) => {
    b.classList.toggle('active', b.dataset.mode === mode);
    b.onclick = () => {
      mode = b.dataset.mode;
      prefs.write('mode', mode);
      document.querySelectorAll('[data-group="mode"] .seg')
        .forEach((x) => x.classList.toggle('active', x === b));
    };
  });

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
    ws = new WebSocket(serverEl.value);
    setNet('wait', 'abrindo…');

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'host-create-room', name: nameEl.value.trim() || 'Host' }));
      // Proxies (Railway incluso) matam WebSocket ocioso. Um ping leve segura.
      heartbeat = setInterval(() => {
        if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
      }, 25000);
    };

    ws.onmessage = async (ev) => {
      const m = JSON.parse(ev.data);
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
          if (pc) await pc.setRemoteDescription(m.sdp);
          break;
        }

        case 'ice-candidate': {
          const pc = peers.get(m.viewerId);
          if (pc && m.candidate) await pc.addIceCandidate(m.candidate).catch(() => {});
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
    clearInterval(heartbeat);
    ws?.close();
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

  startBtn.onclick = start;
  stopBtn.onclick = stop;
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
      try { await navigator.share({ title: 'Streama aí, Mano!', text: 'Entra na minha sala', url }); return; }
      catch { /* usuário cancelou — cai pro clipboard */ }
    }
    copy(text, 'Convite copiado!');
  };

  return {
    isLive: () => !!stream,
    code: () => roomCode,
    fs: () => fullscreen(video),
    mic: () => micBtn.onclick(),
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
  nameEl.value = prefs.read('name', '');

  codeEl.addEventListener('input', () => {
    codeEl.value = codeEl.value.toUpperCase().replace(/[^0-9A-F]/g, '');
  });
  codeEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });

  function setupPeer() {
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

    prefs.write('name', nameEl.value.trim());
    joinBtn.disabled = true;
    setNet('wait', 'conectando…');

    ws = new WebSocket(serverEl.value);

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'viewer-join', roomCode: code, name: nameEl.value.trim() || 'Anônimo' }));
      heartbeat = setInterval(() => {
        if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
      }, 25000);
    };

    ws.onmessage = async (ev) => {
      const m = JSON.parse(ev.data);
      switch (m.type) {
        case 'joined':
          joined = true;
          joinBtn.disabled = false;
          setup.hidden = true;
          live.hidden = false;
          video.hidden = true;
          tuning.hidden = false;
          $('#room-tag').textContent = 'sala ' + code;
          chat.attach(ws);
          chat.push('', 'Você entrou na sala.', true);
          break;

        case 'offer':
          setupPeer();
          await pc.setRemoteDescription(m.sdp);
          {
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            ws.send(JSON.stringify({ type: 'answer', sdp: answer }));
          }
          break;

        case 'ice-candidate':
          if (m.candidate) await pc?.addIceCandidate(m.candidate).catch(() => {});
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
    clearInterval(heartbeat);
    ws?.close(); ws = null;
    video.srcObject = null;
    setup.hidden = false;
    live.hidden = true;
    $('#room-tag').textContent = 'sem sala';
    setNet('idle', 'offline');
    chat.detach();
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

  return { isLive: () => joined, fs: () => fullscreen(video) };
})();

/* ── Atalhos do app instalado (?aba=host|viewer) ───────────── */

(function deepLinkTab() {
  const p = new URLSearchParams(location.search);
  if (p.get('sala')) return; // convite manda mais que atalho
  const aba = p.get('aba');
  if (aba === 'host' || aba === 'viewer') tabs.go(aba);
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
    case 'p':
      if (viewer.isLive()) $('#viewer-pip').click();
      break;
    case 'c':
      if (host.isLive()) copy(host.code(), 'Código copiado!');
      break;
  }
});
