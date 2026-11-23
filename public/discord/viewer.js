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

import { createFailureTracker, mergeConfig } from './player-logic.js';

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

const SLOW_START_MS = 8000; // sem imagem nesse tempo: oferece abrir no navegador

const stats = { videoFrames: 0, audioChunks: 0, keyRequests: 0, videoDecoders: 0, codec: null, state: 'boot' };
window.__miniBlink = stats; // usado nos testes automatizados

let sdk = null;
let roomCode = '';
let publicUrl = location.origin; // trocado pelo endereço real do Blink (/api/discord/config)

/* ── UI ──────────────────────────────────────────────────── */

function panel(title, msg, { form = false, actions = false, retry = false } = {}) {
  $('#panel').hidden = false;
  $('#title').textContent = title;
  $('#msg').textContent = msg;
  $('#code-form').hidden = !form;
  $('#actions').hidden = !actions || !roomCode;
  $('#retry-video').hidden = !retry;
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

  // Só pela instância (vem do botão do bot). O ID do canal é público: por ele
  // qualquer um acharia o código da sala.
  if (!sdk.instanceId) return null;
  const q = new URLSearchParams({ instance: sdk.instanceId });
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

function markNoAudio(on) {
  stats.noAudio = on;
  $('#noaudio').hidden = !on;
  if (on) $('#sound').hidden = true;
}

async function setupAudio(cfg) {
  audioDecoder?.state !== 'closed' && audioDecoder?.close();
  audioDecoder = null;
  if (!cfg || typeof AudioDecoder === 'undefined') return;
  stats.audioConfigs = (stats.audioConfigs ?? 0) + 1;
  markNoAudio(false);
  const conf = { codec: cfg.codec, sampleRate: cfg.sampleRate, numberOfChannels: cfg.numberOfChannels };
  const ok = await AudioDecoder.isConfigSupported(conf).then((r) => r.supported, () => false);
  stats.audioSupported = ok;
  if (!ok) return;
  audioDecoder = new AudioDecoder({ output: playAudio, error: (e) => { stats.audioError = e?.message ?? 'erro'; audioDecoder = null; } });
  audioDecoder.configure(conf);
  if (!audioCtx || audioCtx.state !== 'running') $('#sound').hidden = false;
}

/* ── vídeo ───────────────────────────────────────────────── */

let videoDecoder = null;
let videoConf = null;
let videoGen = 0; // muda a cada config de vídeo: descarta resultado atrasado
let waitingKey = true;
let ws = null;
let config = { video: null, audio: null }; // a config atual, por trilha
let slowTimer = null;
const failures = createFailureTracker();

function drawFrame(frame) {
  if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
    canvas.width = frame.displayWidth;
    canvas.height = frame.displayHeight;
  }
  ctx2d.drawImage(frame, 0, 0);
  frame.close();
  stats.videoFrames++;
  failures.frame();
  if (stats.videoFrames === 1) { clearTimeout(slowTimer); stats.state = 'playing'; showVideo(); }
}

function askKeyframe() {
  waitingKey = true;
  stats.keyRequests++;
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'keyframe' }));
}

function closeVideoDecoder() {
  try { videoDecoder?.state !== 'closed' && videoDecoder?.close(); } catch { /* ok */ }
  videoDecoder = null;
}

function resetVideoDecoder() {
  if (!videoConf) return;
  closeVideoDecoder();
  const gen = videoGen;
  videoDecoder = new VideoDecoder({ output: drawFrame, error: () => onVideoError(gen) });
  videoDecoder.configure(videoConf);
  stats.videoDecoders++;
  waitingKey = true;
}

// Erro do decoder: tenta de novo algumas vezes; depois para e oferece o
// navegador, em vez de ficar reiniciando para sempre.
function onVideoError(gen) {
  if (gen !== videoGen) return; // erro de um decoder já substituído
  if (failures.fail() === 'retry') { resetVideoDecoder(); askKeyframe(); return; }
  closeVideoDecoder();
  stats.state = 'video-failed';
  hideVideo();
  panel('O vídeo não abriu no Discord', 'Este aparelho não conseguiu mostrar a live aqui. Abra no navegador.', { actions: true, retry: true });
}

$('#retry-video').onclick = () => {
  failures.reset();
  resetVideoDecoder();
  askKeyframe();
  panel('Mini Blink', 'Tentando de novo…');
};

async function setupVideo(cfg) {
  const gen = ++videoGen;
  if (!cfg) { closeVideoDecoder(); videoConf = null; return; }
  if (typeof VideoDecoder === 'undefined') {
    panel('Seu Discord não suporta', 'Este aparelho não tem WebCodecs. Abra a live no navegador.', { actions: true });
    return;
  }
  const conf = { codec: cfg.codec, codedWidth: cfg.width, codedHeight: cfg.height, optimizeForLatency: true };
  const ok = await VideoDecoder.isConfigSupported(conf).then((r) => r.supported, () => false);
  if (gen !== videoGen) return; // chegou outra config enquanto checava
  if (!ok) {
    panel('Formato não suportado', `Este aparelho não decodifica ${cfg.codec}. Abra a live no navegador.`, { actions: true });
    return;
  }
  stats.codec = cfg.codec;
  videoConf = conf;
  failures.reset();
  resetVideoDecoder();
  askKeyframe();
}

// O host avisou que não consegue mandar uma trilha.
const UNSUPPORTED_VIDEO = {
  browser: 'Quem transmite está num navegador que não manda vídeo pro Discord (precisa ser Chrome ou Edge).',
  codec: 'O navegador de quem transmite não conseguiu codificar o vídeo pro Discord.',
};
function onUnsupported(m) {
  if (m.track === 'audio') { markNoAudio(true); return; }
  clearTimeout(slowTimer);
  stats.state = 'unsupported';
  hideVideo();
  panel('Não dá pra assistir aqui', `${UNSUPPORTED_VIDEO[m.reason] ?? UNSUPPORTED_VIDEO.codec} Abra a live no navegador.`, { actions: true });
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
  } else if (kind === KIND_AUDIO) {
    stats.audioPackets = (stats.audioPackets ?? 0) + 1;
    if (audioDecoder?.state !== 'configured') return;
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
    // Demorou demais: oferece o navegador sem parar de esperar.
    clearTimeout(slowTimer);
    slowTimer = setTimeout(() => {
      if (stats.videoFrames === 0 && stats.state === 'connecting') {
        panel('Mini Blink', 'A imagem está demorando. Dá pra abrir no navegador enquanto isso.', { actions: true });
      }
    }, SLOW_START_MS);
  };

  sock.onmessage = async (ev) => {
    if (typeof ev.data !== 'string') { onPacket(ev.data); return; }
    let m;
    try { m = JSON.parse(ev.data); } catch { return; }
    if (m.type === 'config') {
      // Por trilha: uma config que só muda o áudio não reinicia o vídeo.
      const { next, reconfigureVideo, reconfigureAudio } = mergeConfig(config, m);
      config = next;
      if (reconfigureVideo) await setupVideo(next.video);
      if (reconfigureAudio) await setupAudio(next.audio);
    }
    if (m.type === 'unsupported') onUnsupported(m);
    if (m.type === 'status' && !m.publishing && stats.videoFrames === 0 && stats.state !== 'unsupported') panel('Mini Blink', 'Esperando o host mandar a imagem… (quem transmite precisa estar no Chrome ou no Edge)');
    if (m.type === 'ended') { ended = true; stats.state = 'ended'; hideVideo(); panel('A live acabou', 'Valeu por colar!'); }
  };

  sock.onclose = () => {
    if (ws !== sock) return;
    clearInterval(pingTimer);
    clearTimeout(slowTimer);
    config = { video: null, audio: null }; // a conexão nova recebe a config de novo
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
