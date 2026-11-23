// Ponte com o Mini Blink (bot do Discord): o bot avisa "a Activity aberta
// na instância X é da sala Z", e a página da Activity pergunta qual sala
// abrir. Tudo em memória — some com a sala ou em 12h (activity-links.js).

import crypto from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { config } from './config.js';
import { db, schema } from './db/index.js';
import { isRoomOpen } from './signaling.js';
import { createActivityLinks } from './activity-links.js';

const links = createActivityLinks({ isOpen: isRoomOpen });

// ID do Discord vinculado à conta do Blink (null se não vinculou).
export async function discordIdOf(userId) {
  const [row] = await db
    .select({ accountId: schema.account.accountId })
    .from(schema.account)
    .where(and(eq(schema.account.userId, userId), eq(schema.account.providerId, 'discord')))
    .limit(1);
  return row?.accountId ?? null;
}

export function miniBlinkEnabled() {
  return !!config.miniBlinkSecret;
}

export function secretOk(header) {
  if (!config.miniBlinkSecret) return false;
  const want = Buffer.from(`Bearer ${config.miniBlinkSecret}`);
  const got = Buffer.from(String(header ?? ''));
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

export const link = (args) => links.link(args);
export const resolve = (args) => links.resolve(args);
