import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ipFrom } from '../../server/src/client-ip.js';

test('cabeçalho configurado do proxy vence (cf-connecting-ip no Render)', () => {
  const headers = { 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '6.6.6.6, 10.0.0.1' };
  assert.equal(ipFrom({ headers, socketAddress: '10.0.0.2' }, { header: 'cf-connecting-ip' }), '203.0.113.7');
});

test('sem cabeçalho configurado: o ÚLTIMO salto do X-Forwarded-For (o começo o visitante inventa)', () => {
  const headers = { 'x-forwarded-for': '6.6.6.6, 203.0.113.7', 'cf-connecting-ip': '9.9.9.9' };
  assert.equal(ipFrom({ headers, socketAddress: '10.0.0.2' }), '203.0.113.7');
});

test('cabeçalho configurado inválido ou ausente cai para o X-Forwarded-For e depois o socket', () => {
  assert.equal(ipFrom({ headers: { 'cf-connecting-ip': 'lixo', 'x-forwarded-for': '203.0.113.8' } }, { header: 'cf-connecting-ip' }), '203.0.113.8');
  assert.equal(ipFrom({ headers: {}, socketAddress: '::ffff:127.0.0.1' }), '127.0.0.1');
  assert.equal(ipFrom({ headers: { 'x-forwarded-for': 'lixo' }, socketAddress: '' }), '0.0.0.0');
});
