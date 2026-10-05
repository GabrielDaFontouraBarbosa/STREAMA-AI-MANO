// Amizades no banco. Uma linha por par; `accepted` vale pros dois lados.

import { and, eq, or, inArray } from 'drizzle-orm';
import { db, schema } from './db/index.js';

const { friendships: F, user: U } = schema;

export function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    name: u.name || u.displayUsername || u.username,
    image: u.image ?? null,
  };
}

function pairWhere(a, b) {
  return or(
    and(eq(F.requesterId, a), eq(F.addresseeId, b)),
    and(eq(F.requesterId, b), eq(F.addresseeId, a)),
  );
}

export async function findUserByUsername(username) {
  const [u] = await db.select().from(U).where(eq(U.username, String(username).toLowerCase())).limit(1);
  return u ?? null;
}

export async function getFriendship(a, b) {
  const [row] = await db.select().from(F).where(pairWhere(a, b)).limit(1);
  return row ?? null;
}

export async function areFriends(a, b) {
  const row = await getFriendship(a, b);
  return row?.status === 'accepted';
}

export async function friendIds(userId) {
  const rows = await db.select({ r: F.requesterId, a: F.addresseeId }).from(F)
    .where(and(eq(F.status, 'accepted'), or(eq(F.requesterId, userId), eq(F.addresseeId, userId))));
  return rows.map((x) => (x.r === userId ? x.a : x.r));
}

// Amigos aceitos + pedidos recebidos/enviados, já com os dados do outro lado.
export async function listFor(userId) {
  const rows = await db.select().from(F)
    .where(and(or(eq(F.requesterId, userId), eq(F.addresseeId, userId)), inArray(F.status, ['pending', 'accepted'])));

  const otherIds = [...new Set(rows.map((r) => (r.requesterId === userId ? r.addresseeId : r.requesterId)))];
  const users = otherIds.length ? await db.select().from(U).where(inArray(U.id, otherIds)) : [];
  const byId = new Map(users.map((u) => [u.id, publicUser(u)]));

  const friends = [], incoming = [], outgoing = [];
  for (const r of rows) {
    const other = byId.get(r.requesterId === userId ? r.addresseeId : r.requesterId);
    if (!other) continue;
    if (r.status === 'accepted') friends.push({ ...other, friendshipId: r.id });
    else if (r.addresseeId === userId) incoming.push({ requestId: r.id, user: other, createdAt: r.createdAt });
    else outgoing.push({ requestId: r.id, user: other, createdAt: r.createdAt });
  }
  return { friends, incoming, outgoing };
}

// Resultado: { ok, status, code, friendship, target }
export async function requestFriend(userId, username) {
  const target = await findUserByUsername(username);
  if (!target) return { ok: false, status: 404, code: 'not_found' };
  if (target.id === userId) return { ok: false, status: 400, code: 'self' };

  const existing = await getFriendship(userId, target.id);
  if (existing) {
    if (existing.status === 'accepted') return { ok: false, status: 409, code: 'already_friends' };
    if (existing.status === 'blocked') return { ok: false, status: 404, code: 'not_found' };
    // O outro já tinha me pedido → pedir de volta = aceitar.
    if (existing.addresseeId === userId) {
      const [f] = await db.update(F).set({ status: 'accepted', respondedAt: new Date() })
        .where(eq(F.id, existing.id)).returning();
      return { ok: true, status: 200, code: 'accepted', friendship: f, target };
    }
    return { ok: false, status: 409, code: 'already_requested' };
  }

  const [f] = await db.insert(F).values({ requesterId: userId, addresseeId: target.id }).returning();
  return { ok: true, status: 201, code: 'requested', friendship: f, target };
}

export async function acceptRequest(userId, requestId) {
  const [f] = await db.update(F).set({ status: 'accepted', respondedAt: new Date() })
    .where(and(eq(F.id, requestId), eq(F.addresseeId, userId), eq(F.status, 'pending')))
    .returning();
  return f ?? null;
}

// Recusar (quem recebeu) ou cancelar (quem enviou) um pedido pendente.
export async function dropRequest(userId, requestId) {
  const [f] = await db.delete(F)
    .where(and(eq(F.id, requestId), eq(F.status, 'pending'), or(eq(F.addresseeId, userId), eq(F.requesterId, userId))))
    .returning();
  return f ?? null;
}

export async function removeFriend(userId, otherId) {
  const [f] = await db.delete(F)
    .where(and(pairWhere(userId, otherId), eq(F.status, 'accepted')))
    .returning();
  return f ?? null;
}
