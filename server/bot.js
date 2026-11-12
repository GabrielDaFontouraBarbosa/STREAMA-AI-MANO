// Bot do Discord SOZINHO — pra rodar no seu PC (ou em qualquer máquina)
// sem subir o site. Precisa do mesmo Postgres que o Blink usa.
//
//   cd server && npm run bot
//
// Se o servidor do Blink também tiver DISCORD_TOKEN, os avisos saem em dobro:
// deixe o token em um lugar só.

import { runMigrations, pool } from './src/db/index.js';
import { startDiscordBot } from './src/discord/bot.js';

await runMigrations();
const client = await startDiscordBot();

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    console.log(`${sig} — desligando o bot…`);
    client.destroy().finally(() => pool.end().finally(() => process.exit(0)));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
