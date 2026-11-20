import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createBlinkClient, normalizeCode } from '../src/blink.js';
import { createStore } from '../src/store.js';
import { endedMessage, liveMessage } from '../src/messages.js';

test('normalizeCode aceita código, link /s/ e ?sala=', () => {
  assert.equal(normalizeCode('ab12cd'), 'AB12CD');
  assert.equal(normalizeCode('  AB12CD '), 'AB12CD');
  assert.equal(normalizeCode('https://x.onrender.com/s/ab12cd'), 'AB12CD');
  assert.equal(normalizeCode('https://x.onrender.com/?sala=ab12cd'), 'AB12CD');
  assert.equal(normalizeCode('xyz'), null);
  assert.equal(normalizeCode('AB12CDE'), null);
  assert.equal(normalizeCode(''), null);
});

test('isOpen: true/false do Blink, null quando falha', async () => {
  const mk = (impl) => createBlinkClient('https://b.test/', { fetchImpl: impl });
  const ok = (body) => async () => ({ ok: true, json: async () => body });
  assert.equal(await mk(ok({ open: true })).isOpen('AB12CD'), true);
  assert.equal(await mk(ok({ open: false })).isOpen('AB12CD'), false);
  assert.equal(await mk(async () => ({ ok: false })).isOpen('AB12CD'), null);
  assert.equal(await mk(async () => { throw new Error('down'); }).isOpen('AB12CD'), null);
  assert.equal(await mk(ok({})).isOpen('AB12CD'), null);
});

test('roomUrl tira a barra final da BLINK_URL', () => {
  assert.equal(createBlinkClient('https://b.test///').roomUrl('AB12CD'), 'https://b.test/s/AB12CD');
  assert.throws(() => createBlinkClient('b.test'));
});

test('store persiste e recarrega', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mb-')), 'data', 'lives.json');
  const s = createStore(file);
  s.add({ messageId: '1', userId: 'u', channelId: 'c', code: 'AB12CD' });
  s.update('1', { closedChecks: 1 });
  const again = createStore(file);
  assert.equal(again.all().length, 1);
  assert.equal(again.byUser('u')[0].closedChecks, 1);
  again.remove('1');
  assert.equal(createStore(file).all().length, 0);
});

test('mensagens: ao vivo tem botão Assistir ativo; encerrada desativado', () => {
  const live = { name: 'Gabi', code: 'AB12CD', title: '', url: 'https://b.test/s/AB12CD', startedAt: Date.now() - 30 * 60000 };
  const on = liveMessage(live);
  const btnOn = on.components[0].toJSON().components[0];
  assert.equal(btnOn.url, live.url);
  assert.equal(btnOn.disabled, false);
  assert.match(on.embeds[0].toJSON().title, /ao vivo/);

  const off = endedMessage({ ...live, endedAt: live.startedAt + 30 * 60000 });
  const btnOff = off.components[0].toJSON().components[0];
  assert.equal(btnOff.disabled, true);
  assert.equal(off.embeds[0].toJSON().fields[1].value, '30 min');
});
