// Mini Blink rodando sozinho (no seu PC): npm start
// Pra rodar dentro do Blink no Render (24h), veja o README.

import { startBot } from './bot.js';

let bot;
try {
  bot = startBot(process.env);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { bot.stop().finally(() => process.exit(0)); });
}
