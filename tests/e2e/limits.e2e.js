// Limite de descoberta de salas: testar códigos em sequência esbarra numa
// cota por IP compartilhada entre HTTP e WebSocket. O bot (com o segredo)
// fica de fora, e IP falso no começo do X-Forwarded-For não ajuda.

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from '../../server/node_modules/ws/wrapper.mjs';
import { skipReason, startServer } from './helpers.js';

const SECRET = 'e2e-mini-blink-secret';
const PER_MIN = 20;

describe('limite de descoberta de salas', { skip: skipReason }, () => {
  let server;

  before(async () => {
    server = await startServer({ MINI_BLINK_SECRET: SECRET, DISCOVERY_PER_MIN: String(PER_MIN) });
  });
  after(async () => {
    await server?.stop();
  });

  // Simula a chegada por um proxy: o último salto do X-Forwarded-For é o IP real.
  const viaProxy = (realIp, spoofed = '6.6.6.6') => ({ 'X-Forwarded-For': `${spoofed}, ${realIp}` });
  const room = (headers) => fetch(`${server.base}/api/rooms/ABCDEF`, { headers }).then((r) => r.status);

  test('a 21ª consulta do mesmo IP leva 429, outro IP passa, IP falso não ajuda', async () => {
    const statuses = [];
    for (let i = 0; i < PER_MIN + 1; i++) statuses.push(await room(viaProxy('203.0.113.7', `9.9.9.${i}`)));
    assert.deepEqual(statuses.slice(0, PER_MIN), Array(PER_MIN).fill(200));
    assert.equal(statuses[PER_MIN], 429);

    const r = await fetch(`${server.base}/api/rooms/ABCDEF`, { headers: viaProxy('203.0.113.7') });
    assert.ok(Number(r.headers.get('retry-after')) >= 1, 'faltou Retry-After');

    assert.equal(await room(viaProxy('198.51.100.9')), 200);
  });

  test('HTTP e WebSocket dividem a mesma cota', async () => {
    const ip = '203.0.113.50';
    for (let i = 0; i < PER_MIN; i++) assert.equal(await room(viaProxy(ip)), 200);

    // viewer-join pela sinalização, já sem cota
    const sig = await new Promise((resolve, reject) => {
      const ws = new WebSocket(server.base.replace('http', 'ws'), { headers: { ...viaProxy(ip), Origin: server.base } });
      ws.on('open', () => ws.send(JSON.stringify({ type: 'viewer-join', roomCode: 'ABCDEF', name: 'x' })));
      ws.on('message', (d) => { const m = JSON.parse(d); if (m.type === 'error') { ws.close(); resolve(m.message); } });
      ws.on('error', reject);
      setTimeout(() => reject(new Error('sem resposta da sinalização')), 5000);
    });
    assert.match(sig, /Muitas tentativas/);

    // /relay/view, já sem cota: recusado com 429 antes de dizer se a sala existe
    const relayStatus = await new Promise((resolve) => {
      const ws = new WebSocket(`${server.base.replace('http', 'ws')}/relay/view?sala=ABCDEF`, { headers: viaProxy(ip) });
      ws.on('unexpected-response', (req, res) => resolve(res.statusCode));
      ws.on('open', () => { ws.close(); resolve(101); });
      ws.on('error', () => {});
    });
    assert.equal(relayStatus, 429);
  });

  test('o bot com o segredo não entra na cota', async () => {
    const headers = { ...viaProxy('203.0.113.99'), Authorization: `Bearer ${SECRET}` };
    for (let i = 0; i < PER_MIN + 5; i++) assert.equal(await room(headers), 200);
    const wrong = { ...viaProxy('203.0.113.98'), Authorization: 'Bearer errado' };
    const statuses = [];
    for (let i = 0; i < PER_MIN + 1; i++) statuses.push(await room(wrong));
    assert.equal(statuses.at(-1), 429, 'segredo errado também tem que ser limitado');
  });
});
