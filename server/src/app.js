// App HTTP (Express): Better Auth em /api/auth/*, API do Blink em /api/*,
// links diretos (/@username, /s/CODE) e os estáticos de public/.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { toNodeHandler, fromNodeHeaders } from 'better-auth/node';
import { auth } from './auth.js';
import { pool } from './db/index.js';
import * as friends from './friends.js';
import * as hub from './hub.js';
import * as push from './push.js';
import { getIceServers, turnConfigured } from './turn.js';
import { isRoomOpen } from './signaling.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');
const ROOM_RE = /^[0-9A-F]{6}$/;

async function sessionOf(req) {
  return auth.api.getSession({ headers: fromNodeHeaders(req.headers) }).catch(() => null);
}

// Middleware: exige sessão válida.
async function requireAuth(req, res, next) {
  const s = await sessionOf(req);
  if (!s) return res.status(401).json({ error: 'unauthorized' });
  req.user = s.user;
  req.session = s.session;
  next();
}

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // Railway fica na frente

  // Better Auth ANTES do express.json() — ele lê o corpo sozinho.
  app.all('/api/auth/{*any}', toNodeHandler(auth));

  app.use('/api', express.json({ limit: '32kb' }));
  app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

  /* ── saúde ─────────────────────────────────────────────── */
  app.get('/api/health', wrap(async (req, res) => {
    await pool.query('select 1');
    res.json({ ok: true, turn: turnConfigured(), push: push.pushEnabled });
  }));

  /* ── eu ────────────────────────────────────────────────── */
  app.get('/api/me', wrap(async (req, res) => {
    const s = await sessionOf(req);
    if (!s) return res.status(401).json({ user: null });
    res.json({ user: { ...friends.publicUser(s.user), email: s.user.email } });
  }));

  /* ── ICE / TURN ────────────────────────────────────────── */
  // TURN só pra quem está logado ou tem o código de uma sala aberta agora
  // (evita virar relay grátis pra qualquer um). Sem isso, espectador anônimo
  // atrás de NAT restrito ficava em "Sintonizando…" pra sempre.
  app.get('/api/ice', wrap(async (req, res) => {
    const sala = String(req.query.sala ?? '').toUpperCase();
    const allowed = (ROOM_RE.test(sala) && isRoomOpen(sala)) || !!(await sessionOf(req));
    if (!allowed) return res.json({ iceServers: [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }], turn: false });
    res.json(await getIceServers());
  }));

  /* ── perfis ────────────────────────────────────────────── */
  app.get('/api/users/:username', requireAuth, wrap(async (req, res) => {
    const u = await friends.findUserByUsername(req.params.username);
    if (!u) return res.status(404).json({ error: 'not_found' });
    const f = u.id === req.user.id ? null : await friends.getFriendship(req.user.id, u.id);
    const isFriend = f?.status === 'accepted';
    res.json({
      user: friends.publicUser(u),
      friendship: f ? { id: f.id, status: f.status, outgoing: f.requesterId === req.user.id } : null,
      status: isFriend ? hub.statusOf(u.id) : undefined,
    });
  }));

  /* ── amigos ────────────────────────────────────────────── */
  app.get('/api/friends', requireAuth, wrap(async (req, res) => {
    const data = await friends.listFor(req.user.id);
    data.friends = data.friends.map((f) => ({ ...f, status: hub.statusOf(f.id) }));
    res.json(data);
  }));

  app.post('/api/friends/request', requireAuth, wrap(async (req, res) => {
    const username = String(req.body?.username ?? '').trim().replace(/^@/, '');
    if (!username) return res.status(400).json({ error: 'username_required' });
    const r = await friends.requestFriend(req.user.id, username);
    if (!r.ok) return res.status(r.status).json({ error: r.code });
    if (r.code === 'requested') hub.sendToUser(r.target.id, { type: 'friend-request', from: friends.publicUser(req.user) });
    hub.friendsChanged(req.user.id, r.target.id);
    res.status(r.status).json({ result: r.code, user: friends.publicUser(r.target) });
  }));

  app.post('/api/friends/accept', requireAuth, wrap(async (req, res) => {
    const f = await friends.acceptRequest(req.user.id, String(req.body?.requestId ?? ''));
    if (!f) return res.status(404).json({ error: 'not_found' });
    hub.sendToUser(f.requesterId, { type: 'friend-accepted', by: friends.publicUser(req.user) });
    hub.friendsChanged(f.requesterId, f.addresseeId);
    res.json({ ok: true });
  }));

  app.post('/api/friends/decline', requireAuth, wrap(async (req, res) => {
    const f = await friends.dropRequest(req.user.id, String(req.body?.requestId ?? ''));
    if (!f) return res.status(404).json({ error: 'not_found' });
    hub.friendsChanged(f.requesterId, f.addresseeId);
    res.json({ ok: true });
  }));

  app.delete('/api/friends/:userId', requireAuth, wrap(async (req, res) => {
    const f = await friends.removeFriend(req.user.id, req.params.userId);
    if (!f) return res.status(404).json({ error: 'not_found' });
    hub.friendsChanged(f.requesterId, f.addresseeId);
    res.json({ ok: true });
  }));

  /* ── Web Push ──────────────────────────────────────────── */
  app.get('/api/push/key', (req, res) => {
    res.json({ publicKey: push.vapidPublicKey() });
  });

  app.post('/api/push/subscribe', requireAuth, wrap(async (req, res) => {
    const sub = req.body?.subscription;
    if (!push.pushEnabled) return res.status(503).json({ error: 'push_disabled' });
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth || !/^https:\/\//.test(sub.endpoint)) {
      return res.status(400).json({ error: 'invalid_subscription' });
    }
    await push.saveSubscription(req.user.id, { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }, req.get('user-agent')?.slice(0, 300));
    res.status(201).json({ ok: true });
  }));

  app.post('/api/push/unsubscribe', requireAuth, wrap(async (req, res) => {
    const endpoint = String(req.body?.endpoint ?? '');
    if (endpoint) await push.removeSubscription(req.user.id, endpoint);
    res.json({ ok: true });
  }));

  app.use('/api', (req, res) => res.status(404).json({ error: 'not_found' }));

  /* ── links diretos ─────────────────────────────────────── */

  // /s/ABC123 → abre direto na aba Assistir, já conectando.
  app.get('/s/:code', (req, res) => {
    const code = String(req.params.code).toUpperCase();
    res.redirect(302, ROOM_RE.test(code) ? `/?sala=${code}` : '/');
  });

  // /@username → se você é amigo e a pessoa está ao vivo, pede pra entrar.
  // O código da sala nunca vaza pra quem não é amigo: o front recebe só o
  // username e dispara o pedido; o host aceita ou não.
  app.get(/^\/@([a-zA-Z0-9_]{3,20})\/?$/, (req, res) => {
    res.redirect(302, `/?perfil=${encodeURIComponent(req.params[0].toLowerCase())}`);
  });

  /* ── estáticos ─────────────────────────────────────────── */
  app.use(express.static(PUBLIC_DIR, {
    extensions: ['html'],
    setHeaders(res, file) {
      // Ícones podem ficar em cache; HTML/CSS/JS revalidam sempre.
      res.set('Cache-Control', /\.(png|svg|ico|woff2)$/.test(file) ? 'public, max-age=604800' : 'no-cache');
      res.set('X-Content-Type-Options', 'nosniff');
      if (file.endsWith('sw.js')) res.set('Service-Worker-Allowed', '/');
    },
  }));

  // Erros
  app.use((err, req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: 'internal' });
  });

  return app;
}
