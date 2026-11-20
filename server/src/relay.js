// Relay de vídeo por WebSocket — o caminho do Mini Blink (Discord).
//
// Por que existe: dentro de uma Activity do Discord não tem WebRTC ("WebRTC
// is not supported", docs de networking das Activities), mas WebSocket passa
// pelo proxy deles. Então, só pra quem assiste pelo Discord, o host codifica a
// tela com WebCodecs e manda os pedaços pra cá; o servidor repassa pra cada
// viewer, que decodifica com WebCodecs num <canvas>.
//
// O fluxo WebRTC normal do Blink não muda: o host só codifica pro relay
// enquanto houver alguém assistindo por aqui (mensagem "demand").
//
//   /relay/host?sala=CODE&key=KEY   host publica (KEY = HMAC do código, vem
//                                   da sinalização só pro host da sala)
//   /relay/view?sala=CODE           qualquer um com o código assiste
//
// Pacote binário (host → servidor → viewer):
//   byte 0      tipo: 1 = vídeo, 2 = áudio
//   byte 1      flags: 1 = keyframe
//   bytes 2..9  timestamp em µs (float64, big-endian)
//   resto       dados codificados (H.264 Annex B / VP8 / VP9 / Opus)
// Texto JSON: { type: 'config', video: {...}, audio: {...} } do host;
//             { type: 'demand', viewers }, { type: 'keyframe' } pro host;
//             { type: 'config' | 'status' | 'ended' } pro viewer.

import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';
import { config } from './config.js';
import { isRoomOpen } from './signaling.js';

const ROOM_RE = /^[0-9A-F]{6}$/;
const MAX_VIEWERS_PER_ROOM = 20;
const MAX_HOST_PACKET = 1024 * 1024;       // keyframe 1080p cabe com folga
const VIDEO_BACKLOG_LIMIT = 1.5 * 1024 * 1024; // viewer atrasado: pula até o próximo keyframe
const HARD_BACKLOG_LIMIT = 8 * 1024 * 1024;    // viewer travado: derruba
const KEYFRAME_REQUEST_GAP_MS = 1000;
const HEARTBEAT_MS = 25000;

export const KIND_VIDEO = 1;
export const KIND_AUDIO = 2;
export const FLAG_KEY = 1;

// code → { host, viewers: Set<ws>, config: string|null, lastKeyRequest }
const channels = new Map();

export function relayKey(code) {
  return crypto.createHmac('sha256', config.authSecret).update(`relay:${code}`).digest('base64url').slice(0, 32);
}

function keyOk(code, key) {
  const want = Buffer.from(relayKey(code));
  const got = Buffer.from(String(key ?? ''));
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

function channel(code) {
  let ch = channels.get(code);
  if (!ch) {
    ch = { host: null, viewers: new Set(), config: null, lastKeyRequest: 0 };
    channels.set(code, ch);
  }
  return ch;
}

function sendJson(ws, msg) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function sendDemand(ch) {
  sendJson(ch.host, { type: 'demand', viewers: ch.viewers.size });
}

function requestKeyframe(ch) {
  const now = Date.now();
  if (now - ch.lastKeyRequest < KEYFRAME_REQUEST_GAP_MS) return;
  ch.lastKeyRequest = now;
  sendJson(ch.host, { type: 'keyframe' });
}

function dropIfEmpty(code) {
  const ch = channels.get(code);
  if (ch && !ch.host && !ch.viewers.size) channels.delete(code);
}

// Chamado quando a sala acaba de vez (signaling.endRoom).
export function closeRelay(code) {
  const ch = channels.get(code);
  if (!ch) return;
  for (const v of ch.viewers) { sendJson(v, { type: 'ended' }); v.close(1000, 'ended'); }
  ch.host?.close(1000, 'ended');
  channels.delete(code);
}

export function relayStats(code) {
  const ch = channels.get(code);
  return { viewers: ch?.viewers.size ?? 0, publishing: !!ch?.host, hasConfig: !!ch?.config };
}

// Repasse de um pacote do host: decide por viewer o que mandar.
export function forwardPacket(ch, data) {
  if (data.length < 10) return;
  const kind = data[0];
  const isKey = (data[1] & FLAG_KEY) !== 0;
  let needKey = false;

  for (const v of ch.viewers) {
    if (v.readyState !== v.OPEN) continue;
    if (v.bufferedAmount > HARD_BACKLOG_LIMIT) { v.terminate(); continue; }

    if (kind === KIND_VIDEO) {
      if (v.bufferedAmount > VIDEO_BACKLOG_LIMIT) {
        v.waitingKey = true; // atrasou demais: joga fora até o próximo keyframe
        needKey = true;
        continue;
      }
      if (v.waitingKey) {
        if (!isKey) { needKey = true; continue; }
        v.waitingKey = false;
      }
    }
    v.send(data, { binary: true });
  }
  if (needKey) requestKeyframe(ch);
}

function onHost(ws, code) {
  const ch = channel(code);
  if (ch.host && ch.host !== ws) ch.host.terminate(); // aba nova assume
  ch.host = ws;
  ch.config = null;
  sendDemand(ch);

  ws.on('message', (data, isBinary) => {
    ws.isAlive = true;
    if (ch.host !== ws) return;
    if (isBinary) { forwardPacket(ch, data); return; }
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    if (msg?.type === 'config') {
      ch.config = JSON.stringify({ type: 'config', video: msg.video ?? null, audio: msg.audio ?? null });
      for (const v of ch.viewers) {
        v.waitingKey = true;
        if (v.readyState === v.OPEN) v.send(ch.config);
      }
    }
  });

  ws.on('close', () => {
    if (ch.host !== ws) return;
    ch.host = null;
    ch.config = null;
    for (const v of ch.viewers) sendJson(v, { type: 'status', publishing: false });
    dropIfEmpty(code);
  });
}

function onViewer(ws, code) {
  const ch = channel(code);
  ws.waitingKey = true;
  ch.viewers.add(ws);
  sendJson(ws, { type: 'status', publishing: !!ch.host });
  if (ch.config) ws.send(ch.config);
  sendDemand(ch);
  requestKeyframe(ch);

  ws.on('message', (data, isBinary) => {
    ws.isAlive = true;
    if (isBinary) return;
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    if (msg?.type === 'ping') sendJson(ws, { type: 'pong' });
    if (msg?.type === 'keyframe') { ws.waitingKey = true; requestKeyframe(ch); }
  });

  ws.on('close', () => {
    ch.viewers.delete(ws);
    sendDemand(ch);
    dropIfEmpty(code);
  });
}

export function isRelayPath(url) {
  return /^\/relay\/(host|view)(\?|$)/.test(url || '');
}

export function attachRelay(httpServer, { originAllowed }) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_HOST_PACKET, perMessageDeflate: false });

  httpServer.on('upgrade', (req, socket, head) => {
    if (!isRelayPath(req.url)) return; // o resto é da sinalização
    const url = new URL(req.url, 'http://x');
    const role = url.pathname.endsWith('/host') ? 'host' : 'view';
    const code = String(url.searchParams.get('sala') ?? '').toUpperCase();

    const reject = (status) => { socket.write(`HTTP/1.1 ${status}\r\n\r\n`); socket.destroy(); };
    if (!ROOM_RE.test(code)) return reject('400 Bad Request');
    if (!isRoomOpen(code)) return reject('404 Not Found');
    if (role === 'host') {
      // Publicar exige a chave da sala e origem do próprio Blink.
      if (!originAllowed(req) || !keyOk(code, url.searchParams.get('key'))) return reject('403 Forbidden');
    } else if ((channels.get(code)?.viewers.size ?? 0) >= MAX_VIEWERS_PER_ROOM) {
      return reject('503 Service Unavailable');
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.isAlive = true;
      ws.on('pong', () => { ws.isAlive = true; });
      if (role === 'host') onHost(ws, code); else onViewer(ws, code);
    });
  });

  const sweep = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }, HEARTBEAT_MS);
  wss.on('close', () => clearInterval(sweep));
  return wss;
}
