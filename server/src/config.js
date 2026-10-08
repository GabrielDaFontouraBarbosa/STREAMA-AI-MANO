// Tudo que vem de variável de ambiente mora aqui. Segredos NUNCA vão pro
// public/ — o front só recebe o que os endpoints /api/* devolvem.

const env = process.env;

const railwayUrl = env.RAILWAY_PUBLIC_DOMAIN ? `https://${env.RAILWAY_PUBLIC_DOMAIN}` : null;
const port = Number(env.PORT || 8080);

export const config = {
  port,
  isProd: env.NODE_ENV === 'production' || !!env.RAILWAY_ENVIRONMENT,
  publicUrl: env.PUBLIC_URL || railwayUrl || `http://localhost:${port}`,
  trustedOrigins: (env.TRUSTED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),

  authSecret: env.BETTER_AUTH_SECRET,

  // Cloudflare Realtime TURN — https://developers.cloudflare.com/realtime/turn/
  turn: {
    keyId: env.CLOUDFLARE_TURN_KEY_ID,
    apiToken: env.CLOUDFLARE_TURN_API_TOKEN,
    ttl: Number(env.TURN_CREDENTIAL_TTL || 60 * 60 * 6), // 6h
  },

  // Web Push — gere com `npm run vapid:keys` (em server/)
  vapid: {
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
    subject: env.VAPID_SUBJECT || 'mailto:contato@blink.app',
  },

  // Bot do Discord — discord.com/developers/applications → Bot → Reset Token
  discord: {
    token: env.DISCORD_BOT_TOKEN,
    channelId: env.DISCORD_CHANNEL_ID, // canal dos avisos "fulano está ao vivo"
    guildId: env.DISCORD_GUILD_ID,     // opcional: registra os comandos na hora nesse servidor
  },
};

if (!config.authSecret) {
  if (config.isProd) throw new Error('BETTER_AUTH_SECRET não definida (gere com: openssl rand -base64 32).');
  config.authSecret = 'dev-secret-nao-use-em-producao-0123456789abcdef';
  console.warn('⚠️  BETTER_AUTH_SECRET ausente — usando segredo de desenvolvimento.');
}
