// Limite de "descoberta" de salas (rate-limiter-flexible, em memória): quem
// fica testando códigos em sequência. Uma cota por IP compartilhada entre
// GET /api/rooms/:code, GET /api/discord/room, viewer-join (sinalização) e o
// upgrade /relay/view. Reconexão (viewer-resume), mídia e ping ficam de fora.

import { RateLimiterMemory } from 'rate-limiter-flexible';

const PER_MIN = Math.max(1, Number(process.env.DISCOVERY_PER_MIN || 20));
const discovery = new RateLimiterMemory({ keyPrefix: 'discovery', points: PER_MIN, duration: 60 });

// { ok: true } ou { ok: false, retryAfterSec }
export async function consumeDiscovery(ip) {
  try {
    await discovery.consume(ip || 'unknown');
    return { ok: true };
  } catch (rej) {
    if (rej instanceof Error) throw rej; // erro de verdade, não "estourou a cota"
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((rej.msBeforeNext ?? 1000) / 1000)) };
  }
}

// Middleware Express. `trusted(req)` isenta chamadas internas (o bot, com o
// MINI_BLINK_SECRET), que consultam salas o tempo todo.
export function discoveryLimit({ ipOf, trusted = () => false }) {
  return async (req, res, next) => {
    if (trusted(req)) return next();
    try {
      const r = await consumeDiscovery(ipOf(req));
      if (r.ok) return next();
      res.set('Retry-After', String(r.retryAfterSec));
      return res.status(429).json({ error: 'too_many_requests', retryAfter: r.retryAfterSec });
    } catch (err) {
      return next(err);
    }
  };
}
