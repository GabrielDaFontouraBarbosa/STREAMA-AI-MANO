// Conexão com o Postgres (Railway injeta DATABASE_URL) + instância do Drizzle.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import * as schema from './schema.js';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL não definida. No Railway, adicione um Postgres ao projeto e referencie ${{Postgres.DATABASE_URL}} nas variáveis do serviço.');
}

// A URL interna do Railway (*.railway.internal) não usa TLS; a pública
// (proxy.rlwy.net) usa. PGSSL=1 força TLS se precisar.
const useSsl = process.env.PGSSL === '1' || /sslmode=require/.test(DATABASE_URL);

export const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  max: Number(process.env.PG_POOL_MAX || 10),
  ssl: useSsl ? { rejectUnauthorized: false } : undefined,
});

export const db = drizzle(pool, { schema });
export { schema };

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'drizzle');

// Aplica as migrations pendentes. Roda no boot — assim cada deploy no
// Railway já sobe com o schema certo, sem passo manual.
export async function runMigrations() {
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
}
