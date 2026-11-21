// Blink — processo único: página (public/), API (/api/*), auth (Better Auth)
// e sinalização WebRTC por WebSocket, tudo na mesma porta.
//
// Rodar local: cp .env.example .env (na raiz), ajuste DATABASE_URL, e
//   cd server && npm install && npm run dev

import http from 'node:http';
import { config } from './src/config.js';
import { runMigrations, pool } from './src/db/index.js';
import { createApp } from './src/app.js';
import { attachSignaling, originAllowed } from './src/signaling.js';
import { attachRelay } from './src/relay.js';
import { closeDanglingStreams } from './src/hub.js';
import { startMiniBot, stopMiniBot } from './src/minibot.js';

await runMigrations();
await closeDanglingStreams();

const server = http.createServer(createApp());
const wss = attachSignaling(server);
const relay = attachRelay(server, { originAllowed });

server.listen(config.port, () => {
  console.log(`⚡ Blink rodando em ${config.publicUrl} (porta ${config.port})`);
  startMiniBot(); // só liga se DISCORD_TOKEN estiver definido
});

// Railway manda SIGTERM no redeploy: fecha tudo com calma.
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    console.log(`${sig} — encerrando…`);
    wss.close();
    relay.close();
    stopMiniBot();
    server.close(() => pool.end().finally(() => process.exit(0)));
    setTimeout(() => process.exit(0), 8000).unref();
  });
}
