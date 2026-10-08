// Blink — processo único: página (public/), API (/api/*), auth (Better Auth)
// e sinalização WebRTC por WebSocket, tudo na mesma porta.
//
// Rodar local: cp .env.example .env (na raiz), ajuste DATABASE_URL, e
//   cd server && npm install && npm run dev

import http from 'node:http';
import { config } from './src/config.js';
import { runMigrations, pool } from './src/db/index.js';
import { createApp } from './src/app.js';
import { attachSignaling } from './src/signaling.js';
import { closeDanglingStreams, liveNow } from './src/hub.js';
import { startDiscordBot, stopDiscordBot } from './src/discord.js';

await runMigrations();
await closeDanglingStreams();

const server = http.createServer(createApp());
const wss = attachSignaling(server);

server.listen(config.port, () => {
  console.log(`⚡ Blink rodando em ${config.publicUrl} (porta ${config.port})`);
});

startDiscordBot({ getLiveNow: liveNow });

// Railway manda SIGTERM no redeploy: fecha tudo com calma.
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    console.log(`${sig} — encerrando…`);
    wss.close();
    stopDiscordBot();
    server.close(() => pool.end().finally(() => process.exit(0)));
    setTimeout(() => process.exit(0), 8000).unref();
  });
}
