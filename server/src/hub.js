// Estado em memória compartilhado entre a API HTTP e a sinalização WS:
// quem está online (conexão "social" aberta) e quem está ao vivo.
// O banco guarda o histórico (live_streams); aqui fica o tempo real.

import { and, eq, isNull } from 'drizzle-orm';
import { db, schema } from './db/index.js';
import { friendIds } from './friends.js';
import { sendToUsers } from './push.js';

// userId → Set<ws>  (só as conexões sociais — a aba aberta)
const online = new Map();
// userId → { roomCode, name, username }
const live = new Map();

export function send(ws, msg) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

export function sendToUser(userId, msg) {
  for (const ws of online.get(userId) ?? []) send(ws, msg);
}

export function statusOf(userId) {
  if (live.has(userId)) return 'live';
  if (online.get(userId)?.size) return 'online';
  return 'offline';
}

export function isOnline(userId) {
  return !!online.get(userId)?.size;
}

export function liveRoomOf(userId) {
  return live.get(userId)?.roomCode ?? null;
}

async function broadcastPresence(userId) {
  const ids = await friendIds(userId);
  const status = statusOf(userId);
  for (const id of ids) sendToUser(id, { type: 'presence', userId, status });
}

function safe(p) {
  p.catch((err) => console.error('hub:', err.message));
}

/* ── online ─────────────────────────────────────────────────── */

export function addSocial(userId, ws) {
  const first = !online.get(userId)?.size;
  if (!online.has(userId)) online.set(userId, new Set());
  online.get(userId).add(ws);
  if (first) safe(broadcastPresence(userId));
}

export function removeSocial(userId, ws) {
  const set = online.get(userId);
  if (!set) return;
  set.delete(ws);
  if (!set.size) {
    online.delete(userId);
    safe(broadcastPresence(userId));
  }
}

// Status atual de todos os amigos de alguém (snapshot ao conectar).
export async function friendsPresence(userId) {
  const ids = await friendIds(userId);
  return ids.map((id) => ({ userId: id, status: statusOf(id) }));
}

// Quando uma amizade muda, os dois lados recarregam a lista.
export function friendsChanged(...userIds) {
  for (const id of userIds) sendToUser(id, { type: 'friends-changed' });
}

/* ── ao vivo ────────────────────────────────────────────────── */

export async function goLive(user, roomCode, source) {
  live.set(user.id, { roomCode, name: user.name, username: user.username });

  // Encerra qualquer transmissão "pendurada" antes de abrir a nova.
  await db.update(schema.liveStreams).set({ endedAt: new Date() })
    .where(and(eq(schema.liveStreams.userId, user.id), isNull(schema.liveStreams.endedAt)));
  await db.insert(schema.liveStreams).values({ userId: user.id, roomCode, source });

  const ids = await friendIds(user.id);
  const who = { userId: user.id, name: user.name, username: user.username };
  for (const id of ids) {
    sendToUser(id, { type: 'presence', userId: user.id, status: 'live' });
    sendToUser(id, { type: 'friend-went-live', ...who });
  }
  // App fechado: Web Push. O link /@username resolve o resto.
  await sendToUsers(ids, {
    title: `${user.name} está ao vivo no Blink`,
    body: 'Toca pra pedir pra entrar.',
    url: user.username ? `/@${user.username}` : '/',
    tag: `live-${user.id}`,
  });
}

export async function endLive(userId) {
  if (!live.delete(userId)) return;
  await db.update(schema.liveStreams).set({ endedAt: new Date() })
    .where(and(eq(schema.liveStreams.userId, userId), isNull(schema.liveStreams.endedAt)));
  await broadcastPresence(userId);
}

// No boot, nenhuma sala sobreviveu (ficam em memória) — fecha as abertas.
export async function closeDanglingStreams() {
  await db.update(schema.liveStreams).set({ endedAt: new Date() })
    .where(isNull(schema.liveStreams.endedAt));
}
