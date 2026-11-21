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

  // Login do Discord (só pra VINCULAR à conta do Blink, não cria conta nova).
  // Discord Developer Portal → OAuth2: Client ID e Client Secret; redirect:
  //   <PUBLIC_URL>/api/auth/callback/discord
  discord: {
    clientId: env.DISCORD_CLIENT_ID || '',
    clientSecret: env.DISCORD_CLIENT_SECRET || '',
  },

  // Link de doação/apoio (Livepix, Ko-fi, Apoia.se…). Vazio = botão escondido.
  supportUrl: /^https:\/\//.test(env.SUPPORT_URL || '') ? env.SUPPORT_URL : '',

  // Mini Blink (bot do Discord): segredo compartilhado entre o bot e o Blink.
  miniBlinkSecret: env.MINI_BLINK_SECRET || '',

  // Web Push — gere com `npm run vapid:keys` (em server/)
  vapid: {
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
    subject: env.VAPID_SUBJECT || 'mailto:contato@blink.app',
  },
};

if (!config.authSecret) {
  if (config.isProd) throw new Error('BETTER_AUTH_SECRET não definida (gere com: openssl rand -base64 32).');
  config.authSecret = 'dev-secret-nao-use-em-producao-0123456789abcdef';
  console.warn('⚠️  BETTER_AUTH_SECRET ausente — usando segredo de desenvolvimento.');
}
