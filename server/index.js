// Servidor único: serve a página web (public/) E faz a sinalização por
// WebSocket, tudo na mesma porta. O vídeo em si nunca passa por aqui — só as
// mensagens de handshake do WebRTC (offer/answer/ICE), os nomes e o chat.
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

const MAX_VIEWERS = 50;
const MAX_NAME = 24;
const MAX_CHAT = 300;
const MAX_FRIENDS_WATCHED = 200;
const HEARTBEAT_MS = 30000;
const SOCIAL_ID_RE = /^[0-9A-F]{6,16}$/;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

// Ícones podem ficar guardados; HTML/CSS/JS revalidam sempre, senão o
// usuário continua vendo a versão anterior depois de um deploy.
const IMMUTABLE = new Set(['.png', '.svg', '.ico', '.woff2']);

// Momento em que este processo subiu. Junto com o commit, é o que responde
// "o deploy pegou ou não?" sem depender do painel do Railway.
const BOOT_TIME = new Date().toISOString();

const httpServer = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];

  // Qual versão está realmente no ar. O Railway injeta RAILWAY_GIT_COMMIT_SHA
  // no build; local não tem, então responde "local". Ficamos dias sem saber
  // que o site rodava um commit de 12 dias atrás — isso torna a resposta
  // instantânea e não dá pra confundir com cache: é JSON, sem service worker.
  if (urlPath === '/version') {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify({
      app: 'Blink',
      commit: (process.env.RAILWAY_GIT_COMMIT_SHA || 'local').slice(0, 7),
      bootedAt: BOOT_TIME,
    }));
    return;
  }

  // decodeURIComponent estoura em URL malformada ("/%", "/%zz"). Sem esse
  // try/catch o throw sobe pro callback do createServer e derruba o processo
  // inteiro — junto com todas as salas ao vivo, que só existem em memória.
  let decoded;
  try {
    decoded = urlPath === '/' ? 'index.html' : decodeURIComponent(urlPath);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad request');
    return;
  }

  const filePath = path.join(PUBLIC_DIR, decoded);

  // Evita escapar da pasta public/ com "../". O separador no fim importa:
  // sem ele, uma pasta vizinha chamada "public-algo" passaria no startsWith.
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': IMMUTABLE.has(ext) ? 'public, max-age=604800' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server: httpServer });

// rooms: Map<roomCode, { host: ws|null, viewers: Map<viewerId, ws> }>
const rooms = new Map();

// Presença de amigos — independente das salas, existe enquanto a aba
// estiver aberta. Nunca guarda o código da sala: quem quer entrar tem
// que pedir, e só o host decide revelar o código no aceite.
// social: Map<personalId, { ws, name, live }>
const social = new Map();
// watchers: Map<personalId, Set<ws>> — quem está de olho em cada id
const watchers = new Map();

function socialStatus(id) {
  const entry = social.get(id);
  if (!entry) return { status: 'offline', name: null };
  return { status: entry.live ? 'live' : 'idle', name: entry.name };
}

function notifyWatchers(id) {
  const set = watchers.get(id);
  if (!set || !set.size) return;
  const { status, name } = socialStatus(id);
  for (const w of set) send(w, { type: 'presence', id, name, status });
}

function unwatchAll(ws) {
  if (!ws.watching) return;
  for (const id of ws.watching) {
    const set = watchers.get(id);
    if (!set) continue;
    set.delete(ws);
    // Sem isso o Map cresce pra sempre: qualquer cliente pode pedir pra
    // observar 200 ids inventados e cada Set vazio fica alocado.
    if (!set.size) watchers.delete(id);
  }
  ws.watching = null;
}

// Uma entrada social só deve existir enquanto houver conexão social viva ou
// transmissão no ar. Se sobrar entrada órfã (ws null e live false), o
// socialStatus responde "idle" e os amigos veem "Online" pra sempre.
function pruneSocial(id) {
  const entry = social.get(id);
  if (entry && !entry.ws && !entry.live) social.delete(id);
}

function makeRoomCode() {
  // Código curto e fácil de ditar pro amigo (ex: "F4K9QZ")
  let code;
  do { code = crypto.randomBytes(3).toString('hex').toUpperCase(); } while (rooms.has(code));
  return code;
}

function clean(str, max) {
  return String(str ?? '').replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, max);
}

function send(ws, msg) {
  if (ws && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function broadcast(room, msg) {
  send(room.host, msg);
  for (const viewerWs of room.viewers.values()) send(viewerWs, msg);
}

wss.on('connection', (ws) => {
  ws.role = null;
  ws.roomCode = null;
  ws.viewerId = null;
  ws.name = 'Anônimo';
  ws.isAlive = true;

  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    switch (msg.type) {
      // Mantém a conexão viva através de proxies que derrubam socket ocioso
      case 'ping':
        ws.isAlive = true;
        send(ws, { type: 'pong' });
        break;

      // Host cria uma sala nova e recebe o código pra compartilhar
      case 'host-create-room': {
        if (ws.role) return;
        const roomCode = makeRoomCode();
        rooms.set(roomCode, { host: ws, viewers: new Map() });
        ws.role = 'host';
        ws.roomCode = roomCode;
        ws.name = clean(msg.name, MAX_NAME) || 'Host';
        send(ws, { type: 'room-created', roomCode });

        // Liga essa sala à presença social do host (conexão separada),
        // pra avisar os amigos que estão de olho que ele foi ao ar. Cria
        // a entrada mesmo se o "identify" da conexão social ainda não
        // chegou (as duas conexões abrem em paralelo, sem ordem garantida) —
        // quando o identify chegar, ele preserva esse `live` e só completa
        // o `ws` que faltava.
        const hostSocialId = clean(msg.hostSocialId, 16).toUpperCase();
        if (SOCIAL_ID_RE.test(hostSocialId)) {
          ws.socialLinkedId = hostSocialId;
          let entry = social.get(hostSocialId);
          if (!entry) { entry = { ws: null, name: ws.name, live: false }; social.set(hostSocialId, entry); }
          entry.live = true;
          notifyWatchers(hostSocialId);
        }
        break;
      }

      // Viewer entra numa sala existente
      case 'viewer-join': {
        if (ws.role) return;
        const room = rooms.get(clean(msg.roomCode, 6).toUpperCase());
        if (!room || !room.host) {
          send(ws, { type: 'error', message: 'Sala não encontrada ou host offline.' });
          return;
        }
        if (room.viewers.size >= MAX_VIEWERS) {
          send(ws, { type: 'error', message: 'Essa sala já está lotada.' });
          return;
        }
        const viewerId = crypto.randomUUID();
        ws.role = 'viewer';
        ws.roomCode = clean(msg.roomCode, 6).toUpperCase();
        ws.viewerId = viewerId;
        ws.name = clean(msg.name, MAX_NAME) || 'Anônimo';
        room.viewers.set(viewerId, ws);

        // Avisa o host que tem um novo viewer esperando uma oferta
        send(room.host, { type: 'viewer-joined', viewerId, name: ws.name });
        send(ws, { type: 'joined', viewerId });
        break;
      }

      // Host manda a oferta SDP pra um viewer específico
      case 'offer': {
        if (ws.role !== 'host') return;
        const room = rooms.get(ws.roomCode);
        send(room?.viewers.get(msg.viewerId), { type: 'offer', sdp: msg.sdp, viewerId: msg.viewerId });
        break;
      }

      // Viewer responde com a resposta SDP
      case 'answer': {
        if (ws.role !== 'viewer') return;
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
        } else if (ws.role === 'viewer') {
          send(room.host, { type: 'ice-candidate', candidate: msg.candidate, viewerId: ws.viewerId });
        }
        break;
      }

      // Chat da sala — vai pra todo mundo, inclusive quem mandou
      case 'chat': {
        const room = rooms.get(ws.roomCode);
        if (!room || !ws.role) return;
        const text = clean(msg.text, MAX_CHAT);
        if (!text) return;
        broadcast(room, { type: 'chat', name: ws.name, text });
        break;
      }

      // Se apresenta com um id pessoal estável (gerado e guardado no
      // navegador do usuário) — é assim que os amigos te reconhecem.
      case 'identify': {
        const id = clean(msg.id, 16).toUpperCase();
        if (!SOCIAL_ID_RE.test(id)) return;
        const prev = social.get(id);
        social.set(id, { ws, name: clean(msg.name, MAX_NAME) || 'Anônimo', live: prev?.live || false });
        ws.socialId = id;
        notifyWatchers(id); // pega o caso de reidentificar com nome novo enquanto já tem watcher
        break;
      }

      // Define a lista de amigos que essa conexão quer acompanhar, e
      // devolve o status atual de cada um (snapshot inicial).
      case 'watch-friends': {
        if (!Array.isArray(msg.ids)) return;
        unwatchAll(ws);
        const ids = msg.ids
          .map((x) => clean(x, 16).toUpperCase())
          .filter((x) => SOCIAL_ID_RE.test(x))
          .slice(0, MAX_FRIENDS_WATCHED);
        ws.watching = new Set(ids);
        for (const id of ids) {
          if (!watchers.has(id)) watchers.set(id, new Set());
          watchers.get(id).add(ws);
          const { status, name } = socialStatus(id);
          send(ws, { type: 'presence', id, name, status });
        }
        break;
      }

      // Pede pra entrar na sala de um amigo que está ao vivo. O host
      // decide; o servidor nunca revela o código da sala sozinho.
      case 'join-request': {
        if (!ws.socialId) return;
        const targetId = clean(msg.targetId, 16).toUpperCase();
        const target = social.get(targetId);
        const fromEntry = social.get(ws.socialId);
        // `target.ws` pode ser null: a conexão de sinalização abre a sala e
        // marca live antes do identify da conexão social chegar, ou o socket
        // social caiu e está reconectando. Sem esse teste o pedido sumia no
        // silêncio e quem pediu ficava 20s vendo "Pedido enviado…".
        if (!target || !target.live || !target.ws) {
          send(ws, { type: 'join-response', accept: false, reason: 'offline', targetId });
          return;
        }
        send(target.ws, {
          type: 'incoming-request',
          fromId: ws.socialId,
          fromName: clean(msg.fromName, MAX_NAME) || fromEntry?.name || 'Alguém',
        });
        break;
      }

      // Resposta do host a um pedido de entrada — só ele decide revelar
      // o código, e só pra quem pediu.
      case 'join-response': {
        if (!ws.socialId) return;
        const toId = clean(msg.toId, 16).toUpperCase();
        const target = social.get(toId);
        if (!target) return;
        send(target.ws, {
          type: 'join-response',
          accept: !!msg.accept,
          roomCode: msg.accept ? clean(msg.roomCode, 6).toUpperCase() : undefined,
          fromId: ws.socialId,
        });
        break;
      }
    }
  });

  ws.on('close', () => {
    const room = rooms.get(ws.roomCode);
    if (room) {
      if (ws.role === 'host') {
        // Avisa todo mundo que o host saiu e fecha a sala
        for (const viewerWs of room.viewers.values()) {
          send(viewerWs, { type: 'host-left' });
        }
        rooms.delete(ws.roomCode);
        if (ws.socialLinkedId) {
          const entry = social.get(ws.socialLinkedId);
          if (entry) {
            entry.live = false;
            pruneSocial(ws.socialLinkedId);
            notifyWatchers(ws.socialLinkedId);
          }
        }
      } else if (ws.role === 'viewer') {
        room.viewers.delete(ws.viewerId);
        send(room.host, { type: 'viewer-left', viewerId: ws.viewerId, name: ws.name });
      }
    }

    // Conexão social (identify/watch-friends) fechando: fica offline de
    // verdade, não só "não hospedando".
    unwatchAll(ws);
    if (ws.socialId) {
      const entry = social.get(ws.socialId);
      // Só limpa se a entrada ainda for desta conexão: se outra aba já
      // reidentificou o mesmo id, ela é a dona agora.
      if (entry && entry.ws === ws) {
        // Se a transmissão continua no ar (ela vive na outra conexão, a de
        // sinalização), preserva o `live` e só solta o socket social. Apagar
        // a entrada aqui fazia o reconnect do socket social recriá-la com
        // live=false, e o host ficava "no ar" sem ninguém poder entrar.
        entry.ws = null;
        if (!entry.live) social.delete(ws.socialId);
        notifyWatchers(ws.socialId);
      }
    }
  });
});

// Derruba conexões que pararam de responder, senão salas viram zumbis
// e o host continua achando que tem espectador do outro lado.
const sweep = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, HEARTBEAT_MS);

wss.on('close', () => clearInterval(sweep));

httpServer.listen(PORT, () => {
  console.log(`📡 Blink rodando em http://localhost:${PORT}`);
});
