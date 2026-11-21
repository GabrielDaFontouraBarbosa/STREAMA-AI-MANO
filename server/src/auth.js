// Better Auth: cadastro/login com email+senha, login também por username,
// sessão em cookie httpOnly com validade rolante ("o navegador lembra").

import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { username } from 'better-auth/plugins';
import { eq } from 'drizzle-orm';
import crypto from 'node:crypto';
import { db, schema } from './db/index.js';
import { config } from './config.js';

// Discord: entra, cria conta (gerando o @usuario) ou vincula a uma conta já
// logada. Entrar pelo Discord NUNCA junta sozinho com uma conta que tenha o
// mesmo e-mail (disableImplicitLinking): senão quem criasse um Discord com o
// e-mail de outra pessoa, sem confirmar, entraria na conta dela. Juntar só
// estando logado, pelo botão "Conectar Discord".
export const discordLoginEnabled = !!(config.discord.clientId && config.discord.clientSecret);

export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
const USERNAME_INPUT_RE = /^[a-zA-Z0-9_]{3,20}$/; // antes de normalizar pra minúsculas

export const auth = betterAuth({
  appName: 'Blink',
  baseURL: config.publicUrl,
  secret: config.authSecret,
  trustedOrigins: config.trustedOrigins,

  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
  }),

  ...(discordLoginEnabled && {
    socialProviders: {
      discord: {
        clientId: config.discord.clientId,
        clientSecret: config.discord.clientSecret,
      },
    },
    account: {
      accountLinking: {
        enabled: true,
        disableImplicitLinking: true,
        trustedProviders: ['discord'], // vale só pro vínculo estando logado
        allowDifferentEmails: true,
      },
    },
  }),

  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    autoSignIn: true,
  },

  // Conta criada pelo Discord não tem @usuario: gera um a partir do nome.
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          if (user.username) return;
          const u = await uniqueUsername(user.name || String(user.email || '').split('@')[0]);
          return { data: { ...user, username: u, displayUsername: u } };
        },
      },
    },
  },

  plugins: [
    username({
      minUsernameLength: 3,
      maxUsernameLength: 20,
      // só minúsculas, números e _ — vira o link blink.../@username
      usernameValidator: (u) => USERNAME_INPUT_RE.test(u),
    }),
  ],

  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 dias
    updateAge: 60 * 60 * 24,      // renova (rolling) no máx. 1x por dia de uso
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },

  advanced: {
    cookiePrefix: 'blink',
    useSecureCookies: config.isProd,
    defaultCookieAttributes: { sameSite: 'lax', httpOnly: true },
  },

  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    customRules: {
      '/sign-in/email': { window: 60, max: 10 },
      '/sign-in/username': { window: 60, max: 10 },
      '/sign-up/email': { window: 60, max: 5 },
    },
  },
});

// "Gabriel Fontoura" → "gabrielfontoura"; se já existir, "gabrielfontoura4821".
export function usernameBase(name) {
  let base = String(name ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9_]/g, '')
    .slice(0, 15);
  if (base.length < 3) base = `blink${base}`.slice(0, 15);
  return base;
}

async function usernameTaken(u) {
  const [row] = await db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.username, u)).limit(1);
  return !!row;
}

async function uniqueUsername(name) {
  const base = usernameBase(name);
  if (!(await usernameTaken(base))) return base;
  for (let i = 0; i < 20; i++) {
    const u = base + crypto.randomInt(1000, 100000);
    if (!(await usernameTaken(u))) return u;
  }
  return 'blink' + crypto.randomBytes(6).toString('hex');
}
