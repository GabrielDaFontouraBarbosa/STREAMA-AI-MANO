// Sinalização WebRTC + presença, por WebSocket, na mesma porta do HTTP.
// O vídeo nunca passa por aqui — só offer/answer/ICE, nomes e chat.
//
// A sessão do Better Auth é lida do cookie no upgrade: o servidor sabe quem
// é cada conexão e não confia em nome/id que o cliente diga ser.

import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';
import { fromNodeHeaders } from 'better-auth/node';
import { auth } from './auth.js';
import { config } from './config.js';
import { areFriends, publicUser } from './friends.js';
import * as hub from './hub.js';

const MAX_VIEWERS = 50;
const MAX_NAME = 24;
const MAX_CHAT = 300;
const HEARTBEAT_MS = 30000;

// rooms: Map<roomCode, { host: ws, hostUserId, viewers: Map<viewerId, ws> }>
const rooms = new Map();

function makeRoomCode() {
  let code;
  do { code = crypto.randomBytes(3).toString('hex').toUpperCase(); } while (rooms.has(code));
  return code;
}

function clean(str, max) {
  return String(str ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
}

function broadcast(room, msg) {
  hub.send(room.host, msg);
  for (const v of room.viewers.values()) hub.send(v, msg);
}

function roomUsers(room) {
  const list = [{ name: room.host.name, username: room.host.user?.username ?? null, role: 'host' }];
  for (const v of room.viewers.values()) list.push({ name: v.name, username: v.user?.username ?? null, role: 'viewer' });
  return list;
}

function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // clientes não-navegador
  try {
    const o = new URL(origin);
    if (o.host === req.headers.host) return true;
    return config.trustedOrigins.includes(o.origin) || o.origin === new URL(config.publicUrl).origin;
  } catch { return false; }
}

export function attachSignaling(httpServer) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });

  httpServer.on('upgrade', async (req, socket, head) => {
    if (!originAllowed(req)) { socket.destroy(); return; }
    let session = null;
    try {
      session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    } catch { /* sem sessão = anônimo */ }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, session));
  });

  wss.on('connection', (ws, session) => {
    ws.user = session?.user ? { ...publicUser(session.user), id: session.user.id } : null;
    ws.role = null;
    ws.roomCode = null;
    ws.viewerId = null;
    ws.social = false;
    ws.name = ws.user?.name || 'Anônimo';
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      handle(ws, msg).catch((err) => console.error('ws:', err.message));
    });

    ws.on('close', () => onClose(ws));
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

async function handle(ws, msg) {
  switch (msg.type) {
    case 'ping':
      ws.isAlive = true;
      hub.send(ws, { type: 'pong' });
      break;

    // Conexão "social" da aba: presença, avisos de amigo, pedidos de entrada.
    case 'identify': {
      if (!ws.user) { hub.send(ws, { type: 'auth-required' }); return; }
      if (ws.social) return;
      ws.social = true;
      hub.addSocial(ws.user.id, ws);
      hub.send(ws, { type: 'me', user: ws.user });
      hub.send(ws, { type: 'presence-snapshot', friends: await hub.friendsPresence(ws.user.id) });
      break;
    }

    // Host cria a sala — precisa estar logado (é assim que os amigos sabem).
    case 'host-create-room': {
      if (ws.role) return;
      if (!ws.user) { hub.send(ws, { type: 'error', message: 'Entre na sua conta pra transmitir.' }); return; }
      if (hub.liveRoomOf(ws.user.id)) {
        hub.send(ws, { type: 'error', message: 'Você já está transmitindo em outra aba.' });
        return;
      }
      const roomCode = makeRoomCode();
      rooms.set(roomCode, { host: ws, hostUserId: ws.user.id, viewers: new Map() });
      ws.role = 'host';
      ws.roomCode = roomCode;
      hub.send(ws, {
        type: 'room-created',
        roomCode,
        links: {
          room: `/s/${roomCode}`,
          profile: ws.user.username ? `/@${ws.user.username}` : null,
        },
      });
      await hub.goLive(ws.user, roomCode, msg.source === 'camera' ? 'camera' : 'screen');
      break;
    }

    case 'viewer-join': {
      if (ws.role) return;
      const code = clean(msg.roomCode, 6).toUpperCase();
      const room = rooms.get(code);
      if (!room || !room.host) { hub.send(ws, { type: 'error', message: 'Sala não encontrada ou host offline.' }); return; }
      if (room.viewers.size >= MAX_VIEWERS) { hub.send(ws, { type: 'error', message: 'Essa sala já está lotada.' }); return; }
      const viewerId = crypto.randomUUID();
      ws.role = 'viewer';
      ws.roomCode = code;
      ws.viewerId = viewerId;
      if (!ws.user) ws.name = clean(msg.name, MAX_NAME) || 'Anônimo';
      room.viewers.set(viewerId, ws);
      hub.send(room.host, { type: 'viewer-joined', viewerId, name: ws.name, username: ws.user?.username ?? null });
      hub.send(ws, { type: 'joined', viewerId, host: { name: room.host.name, username: room.host.user?.username } });
      broadcast(room, { type: 'room-users', users: roomUsers(room) });
      break;
    }

    case 'offer': {
      if (ws.role !== 'host') return;
      hub.send(rooms.get(ws.roomCode)?.viewers.get(msg.viewerId), { type: 'offer', sdp: msg.sdp, viewerId: msg.viewerId });
      break;
    }

    case 'answer': {
      if (ws.role !== 'viewer') return;
      hub.send(rooms.get(ws.roomCode)?.host, { type: 'answer', sdp: msg.sdp, viewerId: ws.viewerId });
      break;
    }

    case 'ice-candidate': {
      const room = rooms.get(ws.roomCode);
      if (!room) return;
      if (ws.role === 'host') hub.send(room.viewers.get(msg.viewerId), { type: 'ice-candidate', candidate: msg.candidate });
      else if (ws.role === 'viewer') hub.send(room.host, { type: 'ice-candidate', candidate: msg.candidate, viewerId: ws.viewerId });
      break;
    }

    case 'chat': {
      const room = rooms.get(ws.roomCode);
      if (!room || !ws.role) return;
      const text = clean(msg.text, MAX_CHAT);
      if (!text) return;
      broadcast(room, { type: 'chat', name: ws.name, username: ws.user?.username ?? null, text });
      break;
    }

    // Amigo pede pra entrar numa sala ao vivo. Só entre amigos aceitos.
    case 'join-request': {
      if (!ws.user || !ws.social) return;
      const targetId = clean(msg.targetUserId, 64);
      if (!hub.liveRoomOf(targetId) || !(await areFriends(ws.user.id, targetId))) {
        hub.send(ws, { type: 'join-response', accept: false, reason: 'offline', targetUserId: targetId });
        return;
      }
      hub.sendToUser(targetId, { type: 'incoming-request', from: ws.user });
      break;
    }

    // Resposta do host. O código vem do servidor, nunca do cliente.
    case 'join-response': {
      if (!ws.user || !ws.social) return;
      const toId = clean(msg.toUserId, 64);
      const roomCode = hub.liveRoomOf(ws.user.id);
      const accept = !!msg.accept && !!roomCode && (await areFriends(ws.user.id, toId));
      hub.sendToUser(toId, {
        type: 'join-response',
        accept,
        roomCode: accept ? roomCode : undefined,
        targetUserId: ws.user.id,
      });
      break;
    }
  }
}

function onClose(ws) {
  const room = rooms.get(ws.roomCode);
  if (room) {
    if (ws.role === 'host') {
      for (const v of room.viewers.values()) hub.send(v, { type: 'host-left' });
      rooms.delete(ws.roomCode);
      hub.endLive(room.hostUserId).catch((err) => console.error('endLive:', err.message));
    } else if (ws.role === 'viewer') {
      room.viewers.delete(ws.viewerId);
      hub.send(room.host, { type: 'viewer-left', viewerId: ws.viewerId, name: ws.name });
      broadcast(room, { type: 'room-users', users: roomUsers(room) });
    }
  }
  if (ws.social && ws.user) hub.removeSocial(ws.user.id, ws);
}
