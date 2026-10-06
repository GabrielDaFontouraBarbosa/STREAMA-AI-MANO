// Sinalização WebRTC + presença, por WebSocket, na mesma porta do HTTP.
// O vídeo nunca passa por aqui — só offer/answer/ICE, nomes e chat.
//
// A sessão do Better Auth é lida do cookie no upgrade: o servidor sabe quem
// é cada conexão e não confia em nome/id que o cliente diga ser.
//
// Queda do WebSocket NÃO derruba a sala: o vídeo é P2P e continua passando.
// Quem cai tem GRACE_MS pra voltar (host-resume / viewer-resume) antes da
// sala ou do espectador serem encerrados. Só `leave` encerra na hora.

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
const GRACE_MS = 45000;
const ROOM_RE = /^[0-9A-F]{6}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// rooms: Map<roomCode, {
//   host: ws | null, hostUserId, hostName, hostUsername, hostTimer,
//   viewers: Map<viewerId, { ws: ws | null, name, username, timer }>
// }>
const rooms = new Map();

export function isRoomOpen(code) {
  return rooms.has(String(code ?? '').toUpperCase());
}

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
  for (const v of room.viewers.values()) hub.send(v.ws, msg);
}

function roomUsers(room) {
  const list = [{ name: room.hostName, username: room.hostUsername, role: 'host' }];
  for (const v of room.viewers.values()) list.push({ name: v.name, username: v.username, role: 'viewer' });
  return list;
}

function roomLinks(code, user) {
  return { room: `/s/${code}`, profile: user?.username ? `/@${user.username}` : null };
}

function newRoom(ws) {
  return {
    host: null, hostUserId: ws.user.id, hostName: ws.name, hostUsername: ws.user.username ?? null,
    hostTimer: null, viewers: new Map(),
  };
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
    ws.left = false;
    ws.name = ws.user?.name || 'Anônimo';
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (raw) => {
      ws.isAlive = true;
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

/* ── ciclo de vida da sala ───────────────────────────────────── */

function endRoom(code) {
  const room = rooms.get(code);
  if (!room) return;
  clearTimeout(room.hostTimer);
  for (const v of room.viewers.values()) {
    clearTimeout(v.timer);
    hub.send(v.ws, { type: 'host-left' });
  }
  rooms.delete(code);
  hub.endLive(room.hostUserId).catch((err) => console.error('endLive:', err.message));
}

function removeViewer(room, viewerId) {
  const v = room.viewers.get(viewerId);
  if (!v) return;
  clearTimeout(v.timer);
  room.viewers.delete(viewerId);
  hub.send(room.host, { type: 'viewer-left', viewerId, name: v.name });
  broadcast(room, { type: 'room-users', users: roomUsers(room) });
}

// Conexão nova assume o lugar da antiga (aba que reconectou antes do
// servidor perceber que a velha morreu).
function replaceSocket(old, ws) {
  if (old && old !== ws) {
    old.role = null; // o close atrasado da antiga não mexe mais na sala
    old.terminate();
  }
}

async function handle(ws, msg) {
  switch (msg.type) {
    case 'ping':
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
      const current = hub.liveRoomOf(ws.user.id);
      if (current) {
        if (rooms.get(current)?.host) {
          hub.send(ws, { type: 'error', message: 'Você já está transmitindo em outra aba.' });
          return;
        }
        // Sala antiga sem host (aba fechada, esperando reconexão): encerra.
        endRoom(current);
      }
      const roomCode = makeRoomCode();
      const room = newRoom(ws);
      room.host = ws;
      rooms.set(roomCode, room);
      ws.role = 'host';
      ws.roomCode = roomCode;
      hub.send(ws, { type: 'room-created', roomCode, links: roomLinks(roomCode, ws.user) });
      await hub.goLive(ws.user, roomCode, msg.source === 'camera' ? 'camera' : 'screen');
      break;
    }

    // Host voltou depois de uma queda (rede, celular, redeploy do servidor).
    case 'host-resume': {
      if (ws.role) return;
      if (!ws.user) { hub.send(ws, { type: 'error', message: 'Sua sessão expirou. Entre de novo.' }); return; }
      const code = clean(msg.roomCode, 6).toUpperCase();
      if (!ROOM_RE.test(code)) return;
      let room = rooms.get(code);

      if (room && room.hostUserId !== ws.user.id) {
        hub.send(ws, { type: 'error', message: 'Essa sala é de outra pessoa.' });
        return;
      }
      if (!room) {
        // Servidor reiniciou e a sala (que mora em memória) sumiu: recria com
        // o mesmo código, pra quem já estava assistindo conseguir voltar.
        const other = hub.liveRoomOf(ws.user.id);
        if (other && other !== code) {
          hub.send(ws, { type: 'error', message: 'Você já está transmitindo em outra aba.' });
          return;
        }
        room = newRoom(ws);
        rooms.set(code, room);
        await hub.goLive(ws.user, code, msg.source === 'camera' ? 'camera' : 'screen', { silent: true });
      }

      clearTimeout(room.hostTimer);
      room.hostTimer = null;
      replaceSocket(room.host, ws);
      room.host = ws;
      ws.role = 'host';
      ws.roomCode = code;
      hub.send(ws, {
        type: 'room-resumed',
        roomCode: code,
        links: roomLinks(code, ws.user),
        viewers: [...room.viewers].map(([viewerId, v]) => ({ viewerId, name: v.name, username: v.username })),
      });
      broadcast(room, { type: 'room-users', users: roomUsers(room) });
      break;
    }

    case 'viewer-join': {
      if (ws.role) return;
      const code = clean(msg.roomCode, 6).toUpperCase();
      const room = rooms.get(code);
      if (!room) { hub.send(ws, { type: 'error', message: 'Sala não encontrada ou host offline.' }); return; }
      if (room.viewers.size >= MAX_VIEWERS) { hub.send(ws, { type: 'error', message: 'Essa sala já está lotada.' }); return; }
      const viewerId = crypto.randomUUID();
      ws.role = 'viewer';
      ws.roomCode = code;
      ws.viewerId = viewerId;
      if (!ws.user) ws.name = clean(msg.name, MAX_NAME) || 'Anônimo';
      room.viewers.set(viewerId, { ws, name: ws.name, username: ws.user?.username ?? null, timer: null });
      // Se o host estiver reconectando, ele recebe este espectador na lista do room-resumed.
      hub.send(room.host, { type: 'viewer-joined', viewerId, name: ws.name, username: ws.user?.username ?? null });
      hub.send(ws, { type: 'joined', viewerId, host: { name: room.hostName, username: room.hostUsername } });
      broadcast(room, { type: 'room-users', users: roomUsers(room) });
      break;
    }

    // Espectador voltou depois de uma queda. A conexão P2P provavelmente
    // continua de pé; o host decide se precisa renegociar.
    case 'viewer-resume': {
      if (ws.role) return;
      const code = clean(msg.roomCode, 6).toUpperCase();
      const viewerId = clean(msg.viewerId, 36);
      if (!UUID_RE.test(viewerId)) return;
      const room = rooms.get(code);
      // Sala ainda não voltou (servidor reiniciando, host reconectando): tenta de novo.
      if (!room) { hub.send(ws, { type: 'resume-failed', retry: true }); return; }

      let v = room.viewers.get(viewerId);
      if (!v) {
        if (room.viewers.size >= MAX_VIEWERS) { hub.send(ws, { type: 'resume-failed', retry: false }); return; }
        if (!ws.user) ws.name = clean(msg.name, MAX_NAME) || 'Anônimo';
        v = { ws: null, name: ws.name, username: ws.user?.username ?? null, timer: null };
        room.viewers.set(viewerId, v);
      }
      clearTimeout(v.timer);
      v.timer = null;
      replaceSocket(v.ws, ws);
      v.ws = ws;
      ws.name = v.name;
      ws.role = 'viewer';
      ws.roomCode = code;
      ws.viewerId = viewerId;
      hub.send(ws, { type: 'joined', viewerId, resumed: true, host: { name: room.hostName, username: room.hostUsername } });
      hub.send(room.host, { type: 'viewer-resumed', viewerId, name: v.name, username: v.username });
      broadcast(room, { type: 'room-users', users: roomUsers(room) });
      break;
    }

    // Saída de propósito: encerra na hora, sem período de tolerância.
    case 'leave': {
      const room = rooms.get(ws.roomCode);
      ws.left = true;
      if (room) {
        if (ws.role === 'host' && room.host === ws) endRoom(ws.roomCode);
        else if (ws.role === 'viewer' && room.viewers.get(ws.viewerId)?.ws === ws) removeViewer(room, ws.viewerId);
      }
      ws.role = null;
      break;
    }

    case 'offer': {
      if (ws.role !== 'host') return;
      // fresh: conexão nova (o espectador descarta a antiga); senão é ICE restart.
      hub.send(rooms.get(ws.roomCode)?.viewers.get(msg.viewerId)?.ws, { type: 'offer', sdp: msg.sdp, viewerId: msg.viewerId, fresh: !!msg.fresh });
      break;
    }

    case 'answer': {
      if (ws.role !== 'viewer') return;
      hub.send(rooms.get(ws.roomCode)?.host, { type: 'answer', sdp: msg.sdp, viewerId: ws.viewerId });
      break;
    }

    // Espectador percebeu a mídia caindo: pede pro host renegociar o ICE.
    case 'restart-ice': {
      if (ws.role !== 'viewer') return;
      hub.send(rooms.get(ws.roomCode)?.host, { type: 'restart-ice', viewerId: ws.viewerId });
      break;
    }

    case 'ice-candidate': {
      const room = rooms.get(ws.roomCode);
      if (!room) return;
      if (ws.role === 'host') hub.send(room.viewers.get(msg.viewerId)?.ws, { type: 'ice-candidate', candidate: msg.candidate });
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
      // A sala vive na conexão de sinalização; o pedido chega pela social.
      // Se a social do host caiu (reconectando), sendToUser não entrega pra
      // ninguém e quem pediu ficava esperando uma resposta que nunca vem.
      if (!hub.liveRoomOf(targetId) || !hub.isOnline(targetId) || !(await areFriends(ws.user.id, targetId))) {
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
  if (room && !ws.left) {
    if (ws.role === 'host' && room.host === ws) {
      // Não avisa os espectadores: o vídeo P2P segue enquanto o host volta.
      const code = ws.roomCode;
      room.host = null;
      clearTimeout(room.hostTimer);
      room.hostTimer = setTimeout(() => endRoom(code), GRACE_MS);
    } else if (ws.role === 'viewer') {
      const v = room.viewers.get(ws.viewerId);
      if (v?.ws === ws) {
        const id = ws.viewerId;
        v.ws = null;
        clearTimeout(v.timer);
        v.timer = setTimeout(() => removeViewer(room, id), GRACE_MS);
      }
    }
  }
  if (ws.social && ws.user) hub.removeSocial(ws.user.id, ws);
}
