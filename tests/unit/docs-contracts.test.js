// Roda o autoteste do caderno 07 (docs/blink/07_TESTES_E_OPERACAO.md): ele
// importa os blocos de código dos cadernos e confere as contas. Se alguém
// editar um exemplo dos docs e quebrar a conta, este teste avisa.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const docs = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'blink');

test('autoteste dos cadernos (07) passa', () => {
  const md = fs.readFileSync(path.join(docs, '07_TESTES_E_OPERACAO.md'), 'utf8');
  const block = md.match(/<!-- inicio-autoteste -->\s*```js\n([\s\S]*?)```\s*<!-- fim-autoteste -->/);
  assert.ok(block, 'bloco do autoteste não encontrado no caderno 07');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'blink-docs-')), 'contratos.test.mjs');
  fs.writeFileSync(file, block[1]);
  // Sem NODE_TEST_CONTEXT: senão o filho responde no formato interno do runner pai.
  const { NODE_TEST_CONTEXT, ...env } = process.env;
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', file], { env: { ...env, BLINK_DOCS: docs }, encoding: 'utf8' });
  const summary = (r.stdout.match(/^# (pass|fail) \d+/gm) ?? []).join(', ');
  assert.equal(r.status, 0, `autoteste falhou (${summary}):\n${r.stdout.slice(-2000)}${r.stderr.slice(-1000)}`);
  assert.match(summary, /# pass 30/);
});
