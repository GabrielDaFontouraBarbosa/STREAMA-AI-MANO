// Conversa com o Blink: valida código de sala e pergunta se ela está no ar.

export const ROOM_RE = /^[0-9A-F]{6}$/;

export function normalizeCode(input) {
  // Aceita o código puro ("ab12cd") ou o link inteiro (".../s/AB12CD" ou "?sala=AB12CD").
  const s = String(input ?? '').trim();
  const m = s.match(/(?:\/s\/|[?&]sala=)([0-9a-f]{6})/i) || s.match(/^([0-9a-f]{6})$/i);
  return m ? m[1].toUpperCase() : null;
}

export function createBlinkClient(baseUrl, { fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  if (!/^https?:\/\//.test(base)) throw new Error('BLINK_URL inválida — use algo como https://seu-blink.onrender.com');

  return {
    base,
    roomUrl: (code) => `${base}/s/${code}`,

    // Liga a instância/canal da Activity a uma sala (precisa do MINI_BLINK_SECRET).
    async link({ code, instanceId, channelId, secret }) {
      if (!secret) return false;
      try {
        const res = await fetchImpl(`${base}/api/discord/link`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, instanceId, channelId }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        return res.ok;
      } catch {
        return false;
      }
    },

    // true = no ar, false = fechada, null = não deu pra saber (Blink fora/dormindo).
    async isOpen(code) {
      try {
        const res = await fetchImpl(`${base}/api/rooms/${code}`, { signal: AbortSignal.timeout(timeoutMs) });
        if (!res.ok) return null;
        const data = await res.json();
        return typeof data.open === 'boolean' ? data.open : null;
      } catch {
        return null;
      }
    },
  };
}
