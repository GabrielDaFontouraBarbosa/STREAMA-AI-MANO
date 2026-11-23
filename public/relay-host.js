/* ═══════════════════════════════════════════════════════════
   Blink — publicador do relay (Mini Blink / Discord)

   Dentro do Discord não existe WebRTC, então quem assiste por lá recebe
   o vídeo por WebSocket: aqui a tela é codificada com WebCodecs e os
   pedaços vão pro servidor (/relay/host), que repassa.

   Só codifica enquanto o servidor disser que tem alguém assistindo pelo
   Discord ("demand" > 0) — sem ninguém lá, custo zero.

   MediaStreamTrackProcessor continua entregando frames com a aba em
   segundo plano (o host está no jogo, não no Blink), ao contrário de
   requestAnimationFrame/timers, que o navegador congela.
   ═══════════════════════════════════════════════════════════ */

const MAX_W = 1280;
const MAX_H = 720;
const FPS = 30;
const VIDEO_BPS = 2_000_000;
const AUDIO_BPS = 96_000;
const KEY_EVERY_US = 2_000_000; // keyframe a cada 2s: quem entra no meio espera no máximo isso
const SOCKET_BACKLOG = 4 * 1024 * 1024;

export const KIND_VIDEO = 1;
export const KIND_AUDIO = 2;

// H.264 primeiro: decodifica em tudo, iPhone incluso. Depois VP8/VP9.
const VIDEO_CANDIDATES = [
  { codec: 'avc1.42E01F', avc: { format: 'annexb' } },
  { codec: 'vp8' },
  { codec: 'vp09.00.10.08' },
];

export function relaySupported() {
  return typeof VideoEncoder !== 'undefined' && typeof MediaStreamTrackProcessor !== 'undefined';
}

function fit(w, h) {
  const s = Math.min(1, MAX_W / w, MAX_H / h);
  const even = (n) => Math.max(2, Math.round((n * s) / 2) * 2);
  return { width: even(w), height: even(h) };
}

export function packet(kind, isKey, timestamp, chunk) {
  const buf = new Uint8Array(10 + chunk.byteLength);
  buf[0] = kind;
  buf[1] = isKey ? 1 : 0;
  new DataView(buf.buffer).setFloat64(2, timestamp);
  chunk.copyTo(buf.subarray(10));
  return buf;
}

async function pickVideoConfig(width, height) {
  for (const c of VIDEO_CANDIDATES) {
    const cfg = { ...c, width, height, bitrate: VIDEO_BPS, framerate: FPS, latencyMode: 'realtime' };
    try {
      const { supported } = await VideoEncoder.isConfigSupported(cfg);
      if (supported) return cfg;
    } catch { /* tenta o próximo */ }
  }
  return null;
}

export function createRelayPublisher({ onViewers = () => {}, log = () => {} } = {}) {
  let ws = null;
  let stream = null;
  let roomCode = '';
  let key = '';
  let stopped = true;
  let retry = 0;
  let retryTimer = null;
  let demand = 0;
  let session = null; // pipelines rodando agora
  let forceKey = false;
  let videoCfg = null;
  let audioCfg = null;
  const notes = new Map(); // trilha → aviso de "não consigo mandar" (reenviado ao reconectar)

  const open = () => ws && ws.readyState === WebSocket.OPEN;

  function send(data) {
    if (open()) ws.send(data);
  }

  function sendConfig() {
    send(JSON.stringify({ type: 'config', video: videoCfg, audio: audioCfg }));
  }

  // Avisa quem assiste pelo Discord que esta trilha não vai chegar, em vez
  // de deixar a pessoa esperando. reason: 'browser' | 'codec' | 'none'.
  function unsupported(track, reason) {
    const note = JSON.stringify({ type: 'unsupported', track, reason });
    notes.set(track, note);
    send(note);
    log(`relay: sem ${track === 'video' ? 'vídeo' : 'áudio'} pro Discord (${reason})`);
  }

  function connect() {
    clearTimeout(retryTimer);
    if (stopped) return;
    const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    const sock = new WebSocket(`${proto}${location.host}/relay/host?sala=${roomCode}&key=${encodeURIComponent(key)}`);
    sock.binaryType = 'arraybuffer';
    ws = sock;

    sock.onopen = () => {
      retry = 0;
      if (session) sendConfig();
      for (const note of notes.values()) sock.send(note);
    };
    sock.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (m.type === 'demand') setDemand(m.viewers | 0);
      if (m.type === 'keyframe') forceKey = true;
    };
    sock.onclose = () => {
      if (ws !== sock) return;
      ws = null;
      setDemand(0);
      if (stopped) return;
      // Sala pode estar se recuperando (queda/redeploy): tenta de novo, com calma.
      retryTimer = setTimeout(connect, Math.min(30000, 1000 * 2 ** retry++));
    };
  }

  function setDemand(n) {
    if (n !== demand) onViewers(n);
    demand = n;
    if (n > 0 && !session && stream) startPipelines();
    if (n === 0 && session) stopPipelines();
  }

  /* ── vídeo ─────────────────────────────────────────────── */

  async function runVideo(s, track) {
    const processor = new MediaStreamTrackProcessor({ track });
    const reader = processor.readable.getReader();
    s.readers.push(reader);
    let encoder = null;
    let dims = null;
    let lastTs = -Infinity;
    let lastKeyTs = -Infinity;
    let canvas = null;
    let ctx = null;

    try {
      while (s.alive) {
        const { value: frame, done } = await reader.read();
        if (done || !s.alive) { frame?.close(); break; }

        // Limita o FPS (tela pode vir a 60).
        if (frame.timestamp - lastTs < 1e6 / FPS - 4000) { frame.close(); continue; }

        const want = fit(frame.displayWidth, frame.displayHeight);
        if (!encoder || want.width !== dims.width || want.height !== dims.height) {
          encoder?.close();
          const cfg = await pickVideoConfig(want.width, want.height);
          if (!cfg) { frame.close(); unsupported('video', 'codec'); break; }
          dims = want;
          encoder = new VideoEncoder({
            output: (chunk) => {
              if (open() && ws.bufferedAmount > SOCKET_BACKLOG && chunk.type !== 'key') { forceKey = true; return; }
              send(packet(KIND_VIDEO, chunk.type === 'key', chunk.timestamp, chunk));
            },
            error: (e) => log('relay: encoder', e.message),
          });
          s.closers.push(() => encoder.state !== 'closed' && encoder.close());
          encoder.configure(cfg);
          videoCfg = { codec: cfg.codec, width: dims.width, height: dims.height };
          sendConfig();
          forceKey = true;
          canvas = null;
        }

        // Codificador atrasado (CPU apertada): pula o frame em vez de acumular.
        if (encoder.encodeQueueSize > 2) { frame.close(); continue; }

        let out = frame;
        if (frame.displayWidth !== dims.width || frame.displayHeight !== dims.height) {
          if (!canvas) { canvas = new OffscreenCanvas(dims.width, dims.height); ctx = canvas.getContext('2d'); }
          ctx.drawImage(frame, 0, 0, dims.width, dims.height);
          out = new VideoFrame(canvas, { timestamp: frame.timestamp });
          frame.close();
        }

        const keyFrame = forceKey || out.timestamp - lastKeyTs >= KEY_EVERY_US;
        if (keyFrame) { forceKey = false; lastKeyTs = out.timestamp; }
        lastTs = out.timestamp;
        encoder.encode(out, { keyFrame });
        out.close();
      }
    } catch (e) {
      if (s.alive) log('relay: vídeo parou', e.message);
    }
  }

  /* ── áudio ─────────────────────────────────────────────── */

  async function runAudio(s, track) {
    if (typeof AudioEncoder === 'undefined') { unsupported('audio', 'codec'); return; }
    const processor = new MediaStreamTrackProcessor({ track });
    const reader = processor.readable.getReader();
    s.readers.push(reader);
    let encoder = null;

    try {
      while (s.alive) {
        const { value: data, done } = await reader.read();
        if (done || !s.alive) { data?.close(); break; }
        if (!encoder) {
          const cfg = {
            codec: 'opus',
            sampleRate: data.sampleRate,
            numberOfChannels: Math.min(2, data.numberOfChannels),
            bitrate: AUDIO_BPS,
          };
          const { supported } = await AudioEncoder.isConfigSupported(cfg).catch(() => ({ supported: false }));
          if (!supported) { data.close(); unsupported('audio', 'codec'); break; }
          encoder = new AudioEncoder({
            output: (chunk) => {
              if (open() && ws.bufferedAmount > SOCKET_BACKLOG) return;
              send(packet(KIND_AUDIO, true, chunk.timestamp, chunk));
            },
            error: (e) => log('relay: áudio', e.message),
          });
          s.closers.push(() => encoder.state !== 'closed' && encoder.close());
          encoder.configure(cfg);
          audioCfg = { codec: 'opus', sampleRate: cfg.sampleRate, numberOfChannels: cfg.numberOfChannels };
          sendConfig();
        }
        if (data.numberOfChannels > 2) { data.close(); continue; } // 5.1 etc.: raro, ignora
        encoder.encode(data);
        data.close();
      }
    } catch (e) {
      if (s.alive) log('relay: áudio parou', e.message);
    }
  }

  /* ── ciclo de vida ─────────────────────────────────────── */

  function startPipelines() {
    if (!stream) return;
    notes.clear();
    // Firefox/Safari: sem MediaStreamTrackProcessor/VideoEncoder. Conecta
    // mesmo assim só pra avisar quem está no Discord.
    if (!relaySupported()) { unsupported('video', 'browser'); return; }
    const s = { alive: true, readers: [], closers: [], clones: [] };
    session = s;
    videoCfg = null;
    audioCfg = null;
    // Clones: parar o relay não pode parar a track que vai pro WebRTC.
    const v = stream.getVideoTracks()[0]?.clone();
    const a = stream.getAudioTracks()[0]?.clone();
    if (v) { s.clones.push(v); runVideo(s, v); }
    if (a) { s.clones.push(a); runAudio(s, a); } else unsupported('audio', 'none');
    log('relay: transmitindo pro Discord');
  }

  function stopPipelines() {
    const s = session;
    session = null;
    if (!s) return;
    s.alive = false;
    for (const r of s.readers) r.cancel().catch(() => {});
    for (const close of s.closers) { try { close(); } catch { /* já fechado */ } }
    for (const t of s.clones) t.stop();
  }

  return {
    supported: relaySupported,

    start(opts) {
      if (!opts?.relayKey || !opts?.roomCode) return false;
      stream = opts.stream;
      const same = !stopped && roomCode === opts.roomCode && key === opts.relayKey && ws;
      roomCode = opts.roomCode;
      key = opts.relayKey;
      stopped = false;
      if (!same) { ws?.close(); ws = null; retry = 0; connect(); }
      return relaySupported();
    },

    // Fonte trocada (tela ↔ câmera): recomeça a codificação com a track nova.
    setStream(next) {
      stream = next;
      if (session) { stopPipelines(); startPipelines(); }
    },

    stop() {
      stopped = true;
      clearTimeout(retryTimer);
      stopPipelines();
      const sock = ws;
      ws = null;
      sock?.close();
      demand = 0;
    },

    get viewers() { return demand; },
  };
}
