// Better Auth: cadastro/login com email+senha, login também por username,
// sessão em cookie httpOnly com validade rolante ("o navegador lembra").

import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { username } from 'better-auth/plugins';
import { db, schema } from './db/index.js';
import { config } from './config.js';

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

  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    autoSignIn: true,
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
