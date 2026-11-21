/* ═══════════════════════════════════════════════════════════
   Mini Blink — a live dentro do Discord (Activity)

   O Discord abre esta página num iframe. Lá dentro não tem WebRTC,
   então o vídeo chega por WebSocket (/relay/view) e é decodificado com
   WebCodecs num <canvas>. Fora do Discord (teste no navegador) funciona
   igual com /discord/?sala=CODE.

   Qual sala abrir, em ordem:
     1. ?sala=CODE na URL (teste fora do Discord)
     2. custom_id do link discord.com/activities/<app>?custom_id=CODE
     3. o bot ligou esta instância/canal a uma sala (/api/discord/room)
     4. a pessoa digita o código
   ═══════════════════════════════════════════════════════════ */

const ROOM_RE = /^[0-9A-F]{6}$/;
const KIND_VIDEO = 1;
const KIND_AUDIO = 2;
const AUDIO_LEAD = 0.08;    // s de folga pra tocar o áudio sem picotar
const AUDIO_MAX_LAG = 0.5;  // passou disso, pula pra frente (latência acumulada)

const $ = (s) => document.querySelector(s);
const canvas = $('#screen');
const ctx2d = canvas.getContext('2d');
const params = new URLSearchParams(location.search);
const inDiscord = params.has('frame_id');

const stats = { videoFrames: 0, audioChunks: 0, keyRequests: 0, codec: null, state: 'boot' };
window.__miniBlink = stats; // usado nos testes automatizados

let sdk = null;
let roomCode = '';
let publicUrl = location.origin; // trocado pelo endereço real do Blink (/api/discord/config)

/* ── UI ──────────────────────────────────────────────────── */

function panel(title, msg, { form = false, actions = false } = {}) {
  $('#panel').hidden = false;
  $('#title').textContent = title;
  $('#msg').textContent = msg;
  $('#code-form').hidden = !form;
  $('#actions').hidden = !actions || !roomCode;
}

function showVideo() {
  $('#panel').hidden = true;
  canvas.classList.add('on');
  $('#badge').classList.add('on');
}

function hideVideo() {
  canvas.classList.remove('on');
  $('#badge').classList.remove('on');
}

function blinkUrl() {
  // Dentro do Discord, location é o domínio do proxy; o link de verdade vem do servidor.
  return `${publicUrl}/s/${roomCode}`;
}

async function roomOpen(code) {
  try {
    const res = await fetch(`/api/rooms/${code}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()).open === true;
  } catch {
    return null; // servidor fora/acordando: tenta conectar mesmo assim
  }
}

$('#open-browser').onclick = async () => {
  const url = blinkUrl();
  if (sdk) {
    try { await sdk.commands.openExternalLink({ url }); return; } catch { /* cai no window.open */ }
  }
  window.open(url, '_blank', 'noopener');
};

$('#code-form').onsubmit = (e) => {
  e.preventDefault();
  const code = $('#code').value.trim().toUpperCase();
  if (!ROOM_RE.test(code)) { $('#msg').textContent = 'O código tem 6 letras/números, tipo AB12CD.'; return; }
  roomCode = code;
  connect();
};

/* ── qual sala ───────────────────────────────────────────── */

async function discordSetup() {
  // O app id é o subdomínio do proxy: <clientId>.discordsays.com
  const clientId = params.get('client_id') || location.hostname.split('.')[0];
  const { DiscordSDK } = await import('/discord/sdk.js');
  const instance = new DiscordSDK(clientId);
  // Sem resposta do Discord, não trava a página: segue e pede o código.
  await Promise.race([
    instance.ready(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Discord não respondeu')), 10000)),
  ]);
  sdk = instance;
  return sdk;
}

async function findRoom() {
  const fromUrl = String(params.get('sala') ?? '').toUpperCase();
  if (ROOM_RE.test(fromUrl)) return fromUrl;
  if (!sdk) return null;

  const custom = String(sdk.customId ?? '').toUpperCase();
  if (ROOM_RE.test(custom)) return custom;

  const q = new URLSearchParams();
  if (sdk.instanceId) q.set('instance', sdk.instanceId);
  if (sdk.channelId) q.set('channel', sdk.channelId);
  // O bot avisa o Blink logo depois de abrir a Activity: pode chegar um
  // pouco depois desta página. Tenta algumas vezes antes de pedir o código.
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch(`/api/discord/room?${q}`, { cache: 'no-store' });
      const data = await res.json();
      if (ROOM_RE.test(data.code || '')) return data.code;
    } catch { /* tenta de novo */ }
    await new Promise((r) => setTimeout(r, 800));
  }
  return null;
}

/* ── áudio ───────────────────────────────────────────────── */

let audioCtx = null;
let audioDecoder = null;
let playhead = 0;

$('#sound').onclick = async () => {
  try {
    audioCtx ??= new AudioContext({ latencyHint: 'interactive' });
    await audioCtx.resume();
    $('#sound').hidden = true;
  } catch { /* sem áudio neste aparelho */ }
};

function playAudio(data) {
  if (!audioCtx || audioCtx.state !== 'running') { data.close(); return; }
  const buf = audioCtx.createBuffer(data.numberOfChannels, data.numberOfFrames, data.sampleRate);
  for (let ch = 0; ch < data.numberOfChannels; ch++) {
    const plane = new Float32Array(data.numberOfFrames);
    data.copyTo(plane, { planeIndex: ch, format: 'f32-planar' });
    buf.copyToChannel(plane, ch);
  }
  data.close();
  const now = audioCtx.currentTime;
  if (playhead < now + AUDIO_LEAD / 2 || playhead > now + AUDIO_MAX_LAG) playhead = now + AUDIO_LEAD;
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  src.connect(audioCtx.destination);
  src.start(playhead);
  playhead += buf.duration;
}

async function setupAudio(cfg) {
  audioDecoder?.state !== 'closed' && audioDecoder?.close();
  audioDecoder = null;
  if (!cfg || typeof AudioDecoder === 'undefined') return;
  const conf = { codec: cfg.codec, sampleRate: cfg.sampleRate, numberOfChannels: cfg.numberOfChannels };
  const ok = await AudioDecoder.isConfigSupported(conf).then((r) => r.supported, () => false);
  if (!ok) return;
  audioDecoder = new AudioDecoder({ output: playAudio, error: () => { audioDecoder = null; } });
  audioDecoder.configure(conf);
  if (!audioCtx || audioCtx.state !== 'running') $('#sound').hidden = false;
}

/* ── vídeo ───────────────────────────────────────────────── */

let videoDecoder = null;
let videoConf = null;
let waitingKey = true;
let ws = null;

function drawFrame(frame) {
  if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
    canvas.width = frame.displayWidth;
    canvas.height = frame.displayHeight;
  }
  ctx2d.drawImage(frame, 0, 0);
  frame.close();
  stats.videoFrames++;
  if (stats.videoFrames === 1) { stats.state = 'playing'; showVideo(); }
}

function askKeyframe() {
  waitingKey = true;
  stats.keyRequests++;
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'keyframe' }));
}

function resetVideoDecoder() {
  if (!videoConf) return;
  try { videoDecoder?.state !== 'closed' && videoDecoder?.close(); } catch { /* ok */ }
  videoDecoder = new VideoDecoder({ output: drawFrame, error: () => { resetVideoDecoder(); askKeyframe(); } });
  videoDecoder.configure(videoConf);
  waitingKey = true;
}

async function setupVideo(cfg) {
  if (!cfg) return;
  if (typeof VideoDecoder === 'undefined') {
    panel('Seu Discord não suporta', 'Este aparelho não tem WebCodecs. Abra a live no navegador.', { actions: true });
    return;
  }
  const conf = { codec: cfg.codec, codedWidth: cfg.width, codedHeight: cfg.height, optimizeForLatency: true };
  const ok = await VideoDecoder.isConfigSupported(conf).then((r) => r.supported, () => false);
  if (!ok) {
    panel('Formato não suportado', `Este aparelho não decodifica ${cfg.codec}. Abra a live no navegador.`, { actions: true });
    return;
  }
  stats.codec = cfg.codec;
  videoConf = conf;
  resetVideoDecoder();
  askKeyframe();
}

function onPacket(buf) {
  const bytes = new Uint8Array(buf);
  if (bytes.length < 10) return;
  const kind = bytes[0];
  const isKey = (bytes[1] & 1) !== 0;
  const timestamp = new DataView(buf).getFloat64(2);
  const data = bytes.subarray(10);

  if (kind === KIND_VIDEO && videoDecoder?.state === 'configured') {
    if (waitingKey && !isKey) return;
    if (isKey) waitingKey = false;
    // Decodificador ficou pra trás (aparelho fraco): zera e pede keyframe.
    if (videoDecoder.decodeQueueSize > 12) { resetVideoDecoder(); askKeyframe(); return; }
    videoDecoder.decode(new EncodedVideoChunk({ type: isKey ? 'key' : 'delta', timestamp, data }));
  } else if (kind === KIND_AUDIO && audioDecoder?.state === 'configured') {
    stats.audioChunks++;
    audioDecoder.decode(new EncodedAudioChunk({ type: 'key', timestamp, data }));
  }
}

/* ── conexão ─────────────────────────────────────────────── */

let retry = 0;
let ended = false;
let pingTimer = null;

async function connect() {
  ended = false;
  stats.state = 'connecting';
  panel('Mini Blink', `Entrando na sala ${roomCode}…`);
  if ((await roomOpen(roomCode)) === false) {
    hideVideo();
    if (stats.videoFrames > 0) {
      stats.state = 'ended';
      panel('A live acabou', 'Valeu por colar!');
    } else {
      stats.state = 'not-found';
      panel('Sala não encontrada', `A sala ${roomCode} não está no ar. Confere o código:`, { form: true });
    }
    return;
  }
  const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
  const sock = new WebSocket(`${proto}${location.host}/relay/view?sala=${roomCode}`);
  sock.binaryType = 'arraybuffer';
  ws = sock;

  sock.onopen = () => {
    retry = 0;
    clearInterval(pingTimer);
    pingTimer = setInterval(() => sock.readyState === WebSocket.OPEN && sock.send('{"type":"ping"}'), 20000);
    if (stats.videoFrames === 0) panel('Mini Blink', 'Esperando a imagem do host…');
  };

  sock.onmessage = async (ev) => {
    if (typeof ev.data !== 'string') { onPacket(ev.data); return; }
    let m;
    try { m = JSON.parse(ev.data); } catch { return; }
    if (m.type === 'config') { await setupVideo(m.video); await setupAudio(m.audio); }
    if (m.type === 'status' && !m.publishing && stats.videoFrames === 0) panel('Mini Blink', 'Esperando o host mandar a imagem… (quem transmite precisa estar no Chrome ou no Edge)');
    if (m.type === 'ended') { ended = true; stats.state = 'ended'; hideVideo(); panel('A live acabou', 'Valeu por colar!'); }
  };

  sock.onclose = () => {
    if (ws !== sock) return;
    clearInterval(pingTimer);
    if (ended) return;
    stats.state = 'reconnecting';
    hideVideo();
    panel('Reconectando…', 'A conexão caiu, tentando de novo.', { actions: true });
    setTimeout(connect, Math.min(15000, 1000 * 2 ** retry++));
  };
}

/* ── início ──────────────────────────────────────────────── */

(async function main() {
  if (typeof VideoDecoder === 'undefined') {
    panel('Seu Discord não suporta', 'Este aparelho não tem WebCodecs. Atualize o app ou abra no navegador.');
  }
  if (inDiscord) {
    try {
      await discordSetup();
    } catch (e) {
      console.warn('Discord SDK:', e);
    }
  }
  try {
    const cfg = await (await fetch('/api/discord/config')).json();
    if (cfg.publicUrl) publicUrl = cfg.publicUrl.replace(/\/+$/, '');
  } catch { /* fica com location.origin */ }
  roomCode = (await findRoom()) || '';
  if (!roomCode) {
    stats.state = 'need-code';
    panel('Qual sala?', 'Cola o código da sala do Blink:', { form: true });
    return;
  }
  connect();
})();
