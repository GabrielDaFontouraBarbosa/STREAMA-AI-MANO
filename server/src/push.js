// Web Push (VAPID): avisa os amigos que você entrou ao vivo mesmo com o
// Blink fechado. No iOS só funciona com o app instalado na tela inicial.

import webpush from 'web-push';
import { eq, inArray } from 'drizzle-orm';
import { db, schema } from './db/index.js';
import { config } from './config.js';

const { publicKey, privateKey, subject } = config.vapid;
export const pushEnabled = !!(publicKey && privateKey);

if (pushEnabled) webpush.setVapidDetails(subject, publicKey, privateKey);
else console.warn('ℹ️  VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY ausentes — Web Push desligado.');

export function vapidPublicKey() {
  return pushEnabled ? publicKey : null;
}

export async function saveSubscription(userId, sub, userAgent) {
  await db.insert(schema.pushSubscriptions)
    .values({ userId, endpoint: sub.endpoint, keys: sub.keys, userAgent })
    .onConflictDoUpdate({
      target: schema.pushSubscriptions.endpoint,
      set: { userId, keys: sub.keys, userAgent },
    });
}

export async function removeSubscription(userId, endpoint) {
  await db.delete(schema.pushSubscriptions)
    .where(eq(schema.pushSubscriptions.endpoint, endpoint));
}

// Manda o mesmo payload pra todos os dispositivos desses usuários.
// Inscrições mortas (404/410) são apagadas.
export async function sendToUsers(userIds, payload) {
  if (!pushEnabled || !userIds.length) return;
  const subs = await db.select().from(schema.pushSubscriptions)
    .where(inArray(schema.pushSubscriptions.userId, userIds));

  const body = JSON.stringify(payload);
  const dead = [];
  await Promise.allSettled(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, body, { TTL: 60 * 10, urgency: 'high' });
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) dead.push(s.endpoint);
      else console.error('push: falha ao enviar —', err.statusCode || err.message);
    }
  }));
  if (dead.length) {
    await db.delete(schema.pushSubscriptions).where(inArray(schema.pushSubscriptions.endpoint, dead));
  }
}
