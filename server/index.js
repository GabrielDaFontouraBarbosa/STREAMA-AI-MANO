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
import { closeDanglingStreams } from './src/hub.js';

await runMigrations();
await closeDanglingStreams();

const server = http.createServer(createApp());
const wss = attachSignaling(server);

server.listen(config.port, () => {
  console.log(`⚡ Blink rodando em ${config.publicUrl} (porta ${config.port})`);
});

// Bot do Discord junto com o site — só se tiver token. Pra rodar o bot
// separado (no seu PC), deixe DISCORD_TOKEN fora daqui e use `npm run bot`.
if (process.env.DISCORD_TOKEN && process.env.DISCORD_BOT !== 'off') {
  import('./src/discord/bot.js')
    .then((m) => m.startDiscordBot())
    .catch((err) => console.error('⚠️  Bot do Discord não subiu:', err.message));
}

// Railway manda SIGTERM no redeploy: fecha tudo com calma.
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    console.log(`${sig} — encerrando…`);
    wss.close();
    server.close(() => pool.end().finally(() => process.exit(0)));
    setTimeout(() => process.exit(0), 8000).unref();
  });
}
