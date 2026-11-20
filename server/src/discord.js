// Ponte com o Mini Blink (bot do Discord): o bot avisa "a Activity aberta
// na instância X / canal Y é da sala Z", e a página da Activity pergunta
// qual sala abrir. Tudo em memória — some com a sala ou em 12h.

import crypto from 'node:crypto';
import { config } from './config.js';
import { isRoomOpen } from './signaling.js';

const TTL_MS = 12 * 60 * 60 * 1000;
const ID_RE = /^\d{5,25}$|^[A-Za-z0-9_-]{5,100}$/;
const ROOM_RE = /^[0-9A-F]{6}$/;

const byInstance = new Map(); // instanceId → { code, at }
const byChannel = new Map();  // channelId  → { code, at }

export function miniBlinkEnabled() {
  return !!config.miniBlinkSecret;
}

export function secretOk(header) {
  if (!config.miniBlinkSecret) return false;
  const want = Buffer.from(`Bearer ${config.miniBlinkSecret}`);
  const got = Buffer.from(String(header ?? ''));
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

function sweep() {
  const now = Date.now();
  for (const m of [byInstance, byChannel]) {
    for (const [k, v] of m) if (now - v.at > TTL_MS || !isRoomOpen(v.code)) m.delete(k);
  }
}

export function link({ code, instanceId, channelId }) {
  code = String(code ?? '').toUpperCase();
  if (!ROOM_RE.test(code)) return false;
  sweep();
  const at = Date.now();
  if (instanceId && ID_RE.test(instanceId)) byInstance.set(String(instanceId), { code, at });
  if (channelId && ID_RE.test(channelId)) byChannel.set(String(channelId), { code, at });
  return true;
}

// Instância é a pista mais exata (veio do botão); canal é o plano B.
export function resolve({ instanceId, channelId }) {
  for (const [m, id] of [[byInstance, instanceId], [byChannel, channelId]]) {
    const hit = id && m.get(String(id));
    if (hit && Date.now() - hit.at <= TTL_MS && isRoomOpen(hit.code)) return hit.code;
  }
  return null;
}
