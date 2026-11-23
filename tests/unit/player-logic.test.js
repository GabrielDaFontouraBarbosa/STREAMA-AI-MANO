import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFailureTracker, mergeConfig, videoSignature } from '../../public/discord/player-logic.js';
import { videoSignature as relayVideoSignature } from '../../server/src/relay-policy.js';

const v = { codec: 'avc1.42E01F', width: 1280, height: 720 };
const a = { codec: 'opus', sampleRate: 48000, numberOfChannels: 2 };

test('config só de áudio não reconfigura o vídeo', () => {
  const d = mergeConfig({ video: v, audio: null }, { video: { ...v }, audio: a });
  assert.equal(d.reconfigureVideo, false);
  assert.equal(d.reconfigureAudio, true);
  assert.deepEqual(d.next, { video: v, audio: a });
});

test('campo ausente mantém a trilha; null desliga', () => {
  assert.deepEqual(mergeConfig({ video: v, audio: a }, { audio: null }).next, { video: v, audio: null });
  assert.equal(mergeConfig({ video: v, audio: a }, {}).reconfigureVideo, false);
  assert.equal(mergeConfig({ video: v, audio: a }, { video: null }).reconfigureVideo, true);
});

test('mudar codec, tamanho ou descrição reconfigura o vídeo', () => {
  for (const next of [{ ...v, codec: 'vp8' }, { ...v, width: 640 }, { ...v, descriptionB64: 'AQ==' }]) {
    assert.equal(mergeConfig({ video: v }, { video: next }).reconfigureVideo, true);
  }
});

test('primeira config liga as duas trilhas', () => {
  const d = mergeConfig(null, { video: v, audio: a });
  assert.equal(d.reconfigureVideo, true);
  assert.equal(d.reconfigureAudio, true);
});

test('player e relay usam a mesma assinatura de vídeo', () => {
  for (const x of [v, { ...v, width: 640 }, null]) assert.equal(videoSignature(x), relayVideoSignature(x));
});

test('decoder: 3 falhas seguidas e desiste; quadro solto não zera', () => {
  let t = 0;
  const f = createFailureTracker({ now: () => t });
  assert.equal(f.fail(), 'retry');
  f.frame(); t += 500; f.frame();     // quadro isolado entre erros
  assert.equal(f.fail(), 'retry');
  assert.equal(f.fail(), 'give-up');
  assert.equal(f.gaveUp, true);
  assert.equal(f.fail(), 'give-up');
});

test('decoder: 10 s de imagem saudável zeram as falhas', () => {
  let t = 0;
  const f = createFailureTracker({ now: () => t });
  f.fail(); f.fail();
  f.frame(); t += 9999; f.frame();
  assert.equal(f.failures, 2);
  t += 1; f.frame();
  assert.equal(f.failures, 0);
  assert.equal(f.fail(), 'retry');
});

test('"Tentar de novo" recomeça a contagem', () => {
  const f = createFailureTracker();
  f.fail(); f.fail(); f.fail();
  f.reset();
  assert.equal(f.gaveUp, false);
  assert.equal(f.fail(), 'retry');
});
