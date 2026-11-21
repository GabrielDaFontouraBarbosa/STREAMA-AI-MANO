// Mini Blink (bot do Discord) rodando DENTRO do Blink — assim ele fica no ar
// 24h junto com o site, sem depender do PC de ninguém. Liga sozinho quando
// DISCORD_TOKEN está definido.
//
// No Render grátis o serviço dorme sem tráfego de fora; com o bot ligado, o
// Blink se cutuca pelo endereço público a cada 10 min (rota /version, que
// não toca no banco — o Neon continua podendo dormir).

import { config } from './config.js';

const KEEP_AWAKE_MS = 10 * 60 * 1000;

let bot = null;
let keepAwakeTimer = null;

export function getBot() {
  return bot;
}

export async function startMiniBot(env = process.env) {
  if (!env.DISCORD_TOKEN) return null;
  try {
    const { startBot } = await import('../../mini-blink/src/bot.js');
    bot = startBot({
      ...env,
      BLINK_URL: env.BLINK_URL || config.publicUrl,
      MINI_BLINK_SECRET: config.miniBlinkSecret,
    }, { dataDir: env.MINI_BLINK_DATA_DIR || undefined });
  } catch (err) {
    console.error('Mini Blink não subiu:', err.message);
    bot = null;
  }
  if (bot) startKeepAwake(env);
  return bot;
}

function startKeepAwake(env) {
  const wanted = env.KEEP_AWAKE ? env.KEEP_AWAKE === '1' : !!env.RENDER;
  if (!wanted || !/^https:\/\//.test(config.publicUrl)) return;
  const url = `${config.publicUrl.replace(/\/+$/, '')}/version`;
  keepAwakeTimer = setInterval(() => {
    fetch(url, { signal: AbortSignal.timeout(15000) }).catch(() => {});
  }, KEEP_AWAKE_MS);
  keepAwakeTimer.unref();
  console.log(`⏰ Mantendo o serviço acordado (${url} a cada 10 min).`);
}

export async function stopMiniBot() {
  clearInterval(keepAwakeTimer);
  await bot?.stop().catch(() => {});
  bot = null;
}
