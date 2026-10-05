// Credenciais TURN temporárias (Cloudflare Realtime). O front pede em
// /api/turn e nunca vê a chave da API. Sem configuração, cai só pro STUN —
// funciona na maioria das redes, mas falha atrás de NAT simétrico.

import { config } from './config.js';

const STUN_ONLY = [
  { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] },
];

let cache = null; // { iceServers, expiresAt }

export function turnConfigured() {
  return !!(config.turn.keyId && config.turn.apiToken);
}

// A porta 53 costuma ser bloqueada pelos navegadores e só atrasa o ICE.
function dropPort53(servers) {
  return servers
    .map((s) => {
      const urls = (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => !/:53(\?|$)/.test(u));
      return urls.length ? { ...s, urls } : null;
    })
    .filter(Boolean);
}

export async function getIceServers() {
  if (!turnConfigured()) return { iceServers: STUN_ONLY, turn: false };

  // Reaproveita a mesma credencial por um tempo (ela vale config.turn.ttl);
  // renova quando passa da metade da validade.
  if (cache && cache.expiresAt > Date.now()) return { iceServers: cache.iceServers, turn: true };

  const { keyId, apiToken, ttl } = config.turn;
  try {
    const res = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl }),
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!res.ok) throw new Error(`Cloudflare TURN respondeu ${res.status}`);
    const data = await res.json();
    const raw = Array.isArray(data.iceServers) ? data.iceServers : [data.iceServers];
    const iceServers = dropPort53(raw);
    cache = { iceServers, expiresAt: Date.now() + (ttl * 1000) / 2 };
    return { iceServers, turn: true };
  } catch (err) {
    console.error('TURN: falha ao gerar credencial —', err.message);
    return { iceServers: STUN_ONLY, turn: false };
  }
}
