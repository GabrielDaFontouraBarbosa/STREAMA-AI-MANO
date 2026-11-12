// Vínculo conta do Blink ↔ conta do Discord, via código curto.
//
//   1. No Discord: /vincular → o bot grava um código (10 min) e manda o link
//      blink…/discord/CODIGO só pra pessoa (mensagem efêmera).
//   2. No site, logado: o front troca o código pela ligação (POST /api/discord/link).
//
// Este arquivo não importa discord.js — o servidor web usa ele mesmo sem bot.

import crypto from 'node:crypto';
import { and, eq, gt, lt, or } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

const { discordLinks, discordLinkCodes } = schema;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem 0/O/1/I
export const CODE_RE = /^[A-HJ-NP-Z2-9]{8}$/;
const CODE_TTL_MS = 10 * 60 * 1000;

export async function createCode(discordId) {
  await db.delete(discordLinkCodes).where(or(
    lt(discordLinkCodes.expiresAt, new Date()),
    eq(discordLinkCodes.discordId, discordId),
  ));
  const code = Array.from({ length: 8 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');
  await db.insert(discordLinkCodes).values({ code, discordId, expiresAt: new Date(Date.now() + CODE_TTL_MS) });
  return code;
}

// Troca o código pela ligação. Refazer substitui o vínculo antigo dos dois lados.
export async function redeemCode(userId, code) {
  return db.transaction(async (tx) => {
    const [row] = await tx.delete(discordLinkCodes)
      .where(and(eq(discordLinkCodes.code, code), gt(discordLinkCodes.expiresAt, new Date())))
      .returning();
    if (!row) return null;
    await tx.delete(discordLinks).where(or(eq(discordLinks.userId, userId), eq(discordLinks.discordId, row.discordId)));
    await tx.insert(discordLinks).values({ userId, discordId: row.discordId });
    return row.discordId;
  });
}

export async function linkOfUser(userId) {
  const [row] = await db.select().from(discordLinks).where(eq(discordLinks.userId, userId));
  return row ?? null;
}

export async function userOfDiscord(discordId) {
  const [row] = await db.select({ id: schema.user.id, name: schema.user.name, username: schema.user.username })
    .from(discordLinks)
    .innerJoin(schema.user, eq(schema.user.id, discordLinks.userId))
    .where(eq(discordLinks.discordId, discordId));
  return row ?? null;
}

export async function unlinkUser(userId) {
  const rows = await db.delete(discordLinks).where(eq(discordLinks.userId, userId)).returning();
  return rows.length > 0;
}

export async function unlinkDiscord(discordId) {
  const rows = await db.delete(discordLinks).where(eq(discordLinks.discordId, discordId)).returning();
  return rows.length > 0;
}
