import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { INVITE_TITLE, pageMeta, renderPage } from '../../server/src/page-meta.js';
import { inlineScriptHashes } from '../../server/src/security-headers.js';

const html = fs.readFileSync(new URL('../../public/index.html', import.meta.url), 'utf8');
const meta = (page, attr, name) => new RegExp(`<meta ${attr}="${name}" content="([^"]*)"`).exec(page)?.[1];

test('imagem e URL absolutas a partir do PUBLIC_URL (sem barra dobrada)', () => {
  const page = renderPage(html, pageMeta({ publicUrl: 'https://blink.example/' }));
  assert.equal(meta(page, 'property', 'og:image'), 'https://blink.example/icon-512.png');
  assert.equal(meta(page, 'name', 'twitter:image'), 'https://blink.example/icon-512.png');
  assert.equal(meta(page, 'property', 'og:url'), 'https://blink.example/');
  // controle: no arquivo cru a imagem é relativa (é o que os apps ignoram)
  assert.equal(meta(html, 'property', 'og:image'), 'icon-512.png');
});

test('convite: título genérico, URL canônica /s/CODE, nada do host', () => {
  const page = renderPage(html, pageMeta({ publicUrl: 'https://blink.example', room: 'ABC123' }));
  assert.equal(meta(page, 'property', 'og:title'), INVITE_TITLE);
  assert.equal(meta(page, 'name', 'twitter:title'), INVITE_TITLE);
  assert.equal(meta(page, 'property', 'og:url'), 'https://blink.example/s/ABC123');
  assert.match(page, new RegExp(`<title>${INVITE_TITLE}</title>`));
});

test('o script inline continua igual (o hash da CSP não muda)', () => {
  const page = renderPage(html, pageMeta({ publicUrl: 'https://blink.example', room: 'ABC123' }));
  assert.deepEqual(inlineScriptHashes(page), inlineScriptHashes(html));
  assert.ok(inlineScriptHashes(html).length > 0);
});

test('valor com aspas não quebra a tag', () => {
  const page = renderPage('<meta property="og:url" content="/" />', { url: 'https://x/"><script>' });
  assert.equal(page, '<meta property="og:url" content="https://x/&quot;&gt;&lt;script&gt;" />');
});

test('o texto público não promete o que o código não cumpre', () => {
  for (const frase of ['sem servidor no meio', 'menos de um segundo', 'P2P, sem instalar', 'num piscar de olhos']) {
    assert.ok(!html.includes(frase), `ainda tem "${frase}" no index.html`);
  }
});
