import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { inlineScriptHashes, isActivityRequest, socketOrigins } from '../../server/src/security-headers.js';

test('hash do script inline no formato da CSP', () => {
  const code = "document.documentElement.classList.add('js')";
  const want = `'sha256-${crypto.createHash('sha256').update(code).digest('base64')}'`;
  assert.deepEqual(inlineScriptHashes(`<head><script>${code}</script><script src="a.js"></script></head>`), [want]);
});

test('origens viram ws/wss sem repetir', () => {
  assert.deepEqual(socketOrigins(['https://x.onrender.com', 'http://localhost:8080', 'https://x.onrender.com/', 'lixo']),
    ['wss://x.onrender.com', 'ws://localhost:8080']);
});

test('o que conta como Activity do Discord', () => {
  assert.equal(isActivityRequest({ path: '/', query: { frame_id: 'f' } }), true);
  assert.equal(isActivityRequest({ path: '/discord/viewer.js', query: {} }), true);
  assert.equal(isActivityRequest({ path: '/relay/view', query: {} }), true);
  assert.equal(isActivityRequest({ path: '/', query: {} }), false);
  assert.equal(isActivityRequest({ path: '/app.js', query: {} }), false);
});
