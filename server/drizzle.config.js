import { defineConfig } from 'drizzle-kit';

// Lê o .env da raiz, se existir (local). No Railway as variáveis já vêm prontas.
try { process.loadEnvFile('../.env'); } catch { /* sem .env */ }

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.js',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
  strict: true,
  verbose: true,
});
