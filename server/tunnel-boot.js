// Boot pra rodar no seu PC atrás de um túnel grátis da Cloudflare
// (docker-compose.yml). O túnel "rápido" ganha uma URL aleatória
// (https://algo.trycloudflare.com) toda vez que liga, então aqui:
//   1. pergunta pro cloudflared qual URL ele pegou e usa como PUBLIC_URL;
//   2. se não tiver BETTER_AUTH_SECRET, gera um e guarda em /app/data
//      (volume), pra ninguém ser deslogado quando o container reinicia;
//   3. sobe o servidor normal (index.js).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const metrics = process.env.TUNNEL_METRICS_URL; // ex.: http://tunnel:2000

async function tunnelUrl() {
  for (let i = 0; i < 90; i++) {
    try {
      const res = await fetch(`${metrics}/quicktunnel`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        const { hostname } = await res.json();
        if (hostname) return `https://${hostname}`;
      }
    } catch { /* cloudflared ainda subindo */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Não consegui pegar a URL do túnel em ${metrics}/quicktunnel.`);
}

if (metrics && !process.env.PUBLIC_URL) {
  process.env.PUBLIC_URL = await tunnelUrl();
}

if (!process.env.BETTER_AUTH_SECRET) {
  const dir = process.env.DATA_DIR || '/app/data';
  const file = path.join(dir, 'auth-secret');
  try {
    process.env.BETTER_AUTH_SECRET = fs.readFileSync(file, 'utf8').trim();
  } catch {
    const secret = crypto.randomBytes(32).toString('base64');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, secret, { mode: 0o600 });
    process.env.BETTER_AUTH_SECRET = secret;
  }
}

await import('./index.js');

console.log('');
console.log('==========================================================');
console.log(`  Link pra mandar pra sua namorada: ${process.env.PUBLIC_URL}`);
console.log('==========================================================');
console.log('');
