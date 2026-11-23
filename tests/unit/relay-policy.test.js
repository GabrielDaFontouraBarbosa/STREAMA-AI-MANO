import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HARD_LIMIT, LOW_WATER, SOFT_LIMIT, decidePacket } from '../../server/src/relay-policy.js';

test('fila normal: manda tudo', () => {
  assert.deepEqual(decidePacket(0, 1000, false, 'delta'), { action: 'send', waitingForKey: false });
  assert.deepEqual(decidePacket(0, 1000, false, 'key'), { action: 'send', waitingForKey: false });
});

test('acima do soft limit: descarta delta e passa a esperar keyframe', () => {
  assert.deepEqual(decidePacket(SOFT_LIMIT - 1, 1, false, 'delta'), { action: 'drop', waitingForKey: true });
});

test('esperando keyframe: delta é descartado, keyframe com fila drenada recupera', () => {
  assert.equal(decidePacket(0, 100, true, 'delta').action, 'drop');
  assert.deepEqual(decidePacket(0, 700 * 1024, true, 'key'), { action: 'send', waitingForKey: false });
  assert.equal(decidePacket(LOW_WATER + 1, 100, true, 'key').action, 'drop');
});

test('áudio passa no congestionamento moderado, mas o hard limit fecha até com áudio', () => {
  assert.deepEqual(decidePacket(700 * 1024, 100, true, 'audio'), { action: 'send', waitingForKey: true });
  assert.equal(decidePacket(HARD_LIMIT - 1, 1, false, 'audio').action, 'close');
});

test('entradas inválidas', () => {
  assert.throws(() => decidePacket(-1, 1, false, 'delta'), RangeError);
  assert.throws(() => decidePacket(0, 1, false, 'video'), RangeError);
});
