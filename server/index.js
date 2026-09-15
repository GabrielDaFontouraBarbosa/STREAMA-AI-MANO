// Servidor único: serve a página web (public/) E faz a sinalização por
// WebSocket, tudo na mesma porta. O vídeo em si nunca passa por aqui — só as
// mensagens de handshake do WebRTC (offer/answer/ICE) entre host e viewers.
//
// Rodar: node index.js
// Porta padrão: 8080 (pode mudar via variável de ambiente PORT)

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const crypto = require('crypto');

const PORT = process.env.PORT || 8080;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

const httpServer = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];
  const filePath = path.join(PUBLIC_DIR, urlPath === '/' ? 'index.html' : decodeURIComponent(urlPath));

  // Evita escapar da pasta public/ com "../"
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME_TYPES[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server: httpServer });

// rooms: Map<roomCode, { host: ws|null, viewers: Map<viewerId, ws> }>
const rooms = new Map();

function makeRoomCode() {
  // Código curto e fácil de ditar pro amigo (ex: "F4K9QZ")
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

function send(ws, msg) {
  if (ws && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

wss.on('connection', (ws) => {
  ws.role = null;
  ws.roomCode = null;
  ws.viewerId = null;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    switch (msg.type) {
      // Host cria uma sala nova e recebe o código pra compartilhar
      case 'host-create-room': {
        const roomCode = makeRoomCode();
        rooms.set(roomCode, { host: ws, viewers: new Map() });
        ws.role = 'host';
        ws.roomCode = roomCode;
        send(ws, { type: 'room-created', roomCode });
        break;
      }

      // Viewer entra numa sala existente
      case 'viewer-join': {
        const room = rooms.get(msg.roomCode);
        if (!room || !room.host) {
          send(ws, { type: 'error', message: 'Sala não encontrada ou host offline.' });
          return;
        }
        const viewerId = crypto.randomUUID();
        ws.role = 'viewer';
        ws.roomCode = msg.roomCode;
        ws.viewerId = viewerId;
        room.viewers.set(viewerId, ws);

        // Avisa o host que tem um novo viewer esperando uma oferta
        send(room.host, { type: 'viewer-joined', viewerId });
        send(ws, { type: 'joined', viewerId });
        break;
      }

      // Host manda a oferta SDP pra um viewer específico
      case 'offer': {
        const room = rooms.get(ws.roomCode);
        const viewerWs = room?.viewers.get(msg.viewerId);
        send(viewerWs, { type: 'offer', sdp: msg.sdp, viewerId: msg.viewerId });
        break;
      }

      // Viewer responde com a resposta SDP
      case 'answer': {
        const room = rooms.get(ws.roomCode);
        send(room?.host, { type: 'answer', sdp: msg.sdp, viewerId: ws.viewerId });
        break;
      }

      // Troca de candidatos ICE nos dois sentidos
      case 'ice-candidate': {
        const room = rooms.get(ws.roomCode);
        if (!room) return;
        if (ws.role === 'host') {
          send(room.viewers.get(msg.viewerId), { type: 'ice-candidate', candidate: msg.candidate });
        } else {
          send(room.host, { type: 'ice-candidate', candidate: msg.candidate, viewerId: ws.viewerId });
        }
        break;
      }
    }
  });

  ws.on('close', () => {
    const room = rooms.get(ws.roomCode);
    if (!room) return;
    if (ws.role === 'host') {
      // Avisa todo mundo que o host saiu e fecha a sala
      for (const viewerWs of room.viewers.values()) {
        send(viewerWs, { type: 'host-left' });
      }
      rooms.delete(ws.roomCode);
    } else if (ws.role === 'viewer') {
      room.viewers.delete(ws.viewerId);
      send(room.host, { type: 'viewer-left', viewerId: ws.viewerId });
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`📡 Streama aí, Mano! rodando em http://localhost:${PORT}`);
});
