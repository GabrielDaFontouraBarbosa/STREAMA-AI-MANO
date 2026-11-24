import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createActivityLinks } from '../../server/src/activity-links.js';

const INSTANCE = 'i-1234567890-gc-912952092627435520-912954213460484116';

test('resolve só pela instância que o bot registrou', () => {
  const l = createActivityLinks({ isOpen: () => true });
  assert.equal(l.link({ code: 'ab12cd', instanceId: INSTANCE }), true);
  assert.equal(l.resolve({ instanceId: INSTANCE }), 'AB12CD');
  assert.equal(l.resolve({ instanceId: 'i-outra-instancia' }), null);
  assert.equal(l.resolve({}), null);
});

test('o ID do canal não resolve mais nada', () => {
  const l = createActivityLinks({ isOpen: () => true });
  l.link({ code: 'AB12CD', instanceId: INSTANCE, channelId: '912954213460484116' });
  assert.equal(l.resolve({ channelId: '912954213460484116' }), null);
});

test('sala fechada ou vínculo vencido não resolve', () => {
  let open = true;
  let t = 0;
  const l = createActivityLinks({ isOpen: () => open, ttlMs: 1000, now: () => t });
  l.link({ code: 'AB12CD', instanceId: INSTANCE });
  open = false;
  assert.equal(l.resolve({ instanceId: INSTANCE }), null);
  open = true;
  t = 1001;
  assert.equal(l.resolve({ instanceId: INSTANCE }), null);
});

test('rejeita código e instância inválidos e respeita o teto', () => {
  const l = createActivityLinks({ isOpen: () => true, max: 1 });
  assert.equal(l.link({ code: 'xyz', instanceId: INSTANCE }), false);
  assert.equal(l.link({ code: 'AB12CD', instanceId: '../../x' }), false);
  assert.equal(l.link({ code: 'AB12CD', instanceId: INSTANCE }), true);
  assert.equal(l.link({ code: 'AB12CD', instanceId: 'i-segunda-instancia' }), false);
});
