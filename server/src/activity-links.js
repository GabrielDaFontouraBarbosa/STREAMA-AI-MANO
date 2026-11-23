// Vínculo "esta instância da Activity é da sala X", gravado pelo bot no
// clique de "Assistir aqui no Discord" (LAUNCH_ACTIVITY devolve a instância).
//
// Só a instância serve: o ID do canal aparece em qualquer link de mensagem,
// então resolver por canal entregava o código da sala a quem nem está no
// servidor. Módulo puro (testado em tests/unit) — quem chama diz se a sala
// está aberta.

const ROOM_RE = /^[0-9A-F]{6}$/;
const INSTANCE_RE = /^[A-Za-z0-9_-]{5,100}$/;

export function createActivityLinks({ isOpen, ttlMs = 12 * 60 * 60 * 1000, now = () => Date.now(), max = 5000 } = {}) {
  const byInstance = new Map(); // instanceId → { code, at }

  function sweep() {
    const t = now();
    for (const [k, v] of byInstance) if (t - v.at > ttlMs || !isOpen(v.code)) byInstance.delete(k);
  }

  return {
    link({ code, instanceId }) {
      const room = String(code ?? '').toUpperCase();
      const id = String(instanceId ?? '');
      if (!ROOM_RE.test(room) || !INSTANCE_RE.test(id)) return false;
      sweep();
      if (byInstance.size >= max && !byInstance.has(id)) return false;
      byInstance.set(id, { code: room, at: now() });
      return true;
    },

    resolve({ instanceId }) {
      const hit = instanceId ? byInstance.get(String(instanceId)) : null;
      if (!hit || now() - hit.at > ttlMs || !isOpen(hit.code)) return null;
      return hit.code;
    },

    get size() { return byInstance.size; },
  };
}
