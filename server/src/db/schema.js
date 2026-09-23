// Schema do Blink (Drizzle + Postgres).
//
// As 4 primeiras tabelas (user, session, account, verification) são as que o
// Better Auth espera — nomes de colunas batem com o adaptador Drizzle dele.
// O plugin `username` adiciona `username` e `display_username` em `user`.
//
// Mudou algo aqui? Rode `npm run db:generate` (em server/) pra gerar a
// migration nova. Ela é aplicada sozinha quando o servidor sobe.

import { relations, sql } from 'drizzle-orm';
import {
  pgTable, text, timestamp, boolean, uuid, jsonb, index, uniqueIndex, check, pgEnum,
} from 'drizzle-orm/pg-core';

/* ── Better Auth ─────────────────────────────────────────────── */

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  username: text('username').unique(),
  displayUsername: text('display_username'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
}, (t) => [index('session_user_idx').on(t.userId)]);

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [index('account_user_idx').on(t.userId)]);

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [index('verification_identifier_idx').on(t.identifier)]);

/* ── App ─────────────────────────────────────────────────────── */

export const friendshipStatus = pgEnum('friendship_status', ['pending', 'accepted', 'blocked']);

// Um pedido de amizade é uma linha só (requester → addressee). Quando aceito,
// vale pros dois lados. O índice único em (menor, maior) impede que A→B e
// B→A existam ao mesmo tempo.
export const friendships = pgTable('friendships', {
  id: uuid('id').primaryKey().defaultRandom(),
  requesterId: text('requester_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  addresseeId: text('addressee_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  status: friendshipStatus('status').notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  respondedAt: timestamp('responded_at', { withTimezone: true }),
}, (t) => [
  uniqueIndex('friendships_pair_uq').on(
    sql`least(${t.requesterId}, ${t.addresseeId})`,
    sql`greatest(${t.requesterId}, ${t.addresseeId})`,
  ),
  index('friendships_addressee_idx').on(t.addresseeId),
  check('friendships_not_self', sql`${t.requesterId} <> ${t.addresseeId}`),
]);

// Histórico de transmissões. A que está no ar tem ended_at nulo — no máximo
// uma por usuário (índice único parcial).
export const liveStreams = pgTable('live_streams', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  roomCode: text('room_code').notNull(),
  source: text('source'), // 'screen' | 'camera'
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
}, (t) => [
  uniqueIndex('live_streams_one_live_per_user').on(t.userId).where(sql`${t.endedAt} is null`),
  index('live_streams_room_idx').on(t.roomCode),
]);

// Inscrições de Web Push (uma por navegador/dispositivo).
export const pushSubscriptions = pgTable('push_subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  endpoint: text('endpoint').notNull().unique(),
  keys: jsonb('keys').$type().notNull(), // { p256dh, auth }
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('push_subscriptions_user_idx').on(t.userId)]);

/* ── Relações (pro query builder relacional) ─────────────────── */

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  liveStreams: many(liveStreams),
  pushSubscriptions: many(pushSubscriptions),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, { fields: [session.userId], references: [user.id] }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, { fields: [account.userId], references: [user.id] }),
}));

export const liveStreamRelations = relations(liveStreams, ({ one }) => ({
  user: one(user, { fields: [liveStreams.userId], references: [user.id] }),
}));

export const pushSubscriptionRelations = relations(pushSubscriptions, ({ one }) => ({
  user: one(user, { fields: [pushSubscriptions.userId], references: [user.id] }),
}));
