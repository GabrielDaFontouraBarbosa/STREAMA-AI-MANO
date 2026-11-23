// Front do site (caderno 05): primeira tela no celular, entrada antes de
// transmitir, menu de conta e prévia do convite.

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, signUp, skipReason, startServer, uniqueUser } from './helpers.js';

describe('front do site', { skip: skipReason }, () => {
  let server;
  let browser;

  before(async () => {
    server = await startServer();
    browser = await launchBrowser();
  });
  after(async () => {
    await browser?.close();
    await server?.stop();
  });

  test('celular 390×844 sem conta: título em até 2 linhas e entrada sem rolar', async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    try {
      await page.goto(server.base + '/');
      await page.waitForSelector('#host-guest:not([hidden])');
      assert.equal(await page.isVisible('#host-setup'), false, 'opções de transmitir aparecem sem conta');
      assert.equal(await page.isVisible('.console-head'), false, '"Sem sala/offline" aparece antes de abrir sala');

      const lines = await page.evaluate(() => {
        const h = document.querySelector('.blink-title');
        return Math.round(h.getBoundingClientRect().height / parseFloat(getComputedStyle(h).lineHeight));
      });
      assert.ok(lines <= 2, `título com ${lines} linhas`);

      const cta = await page.locator('#host-guest-login').boundingBox();
      assert.ok(cta && cta.y + cta.height <= 844, `botão de entrar abaixo da dobra (y=${cta?.y})`);

      // controle positivo: numa tela baixa a mesma medida acusa o botão fora
      await page.setViewportSize({ width: 390, height: 480 });
      const low = await page.locator('#host-guest-login').boundingBox();
      assert.ok(low.y + low.height > 480, 'a medida da dobra não acusaria nada');
    } finally {
      await ctx.close();
    }
  });

  test('menu da conta: abre no avatar, mostra o @ e fecha no Escape devolvendo o foco', async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    try {
      await page.goto(server.base + '/');
      const user = uniqueUser('menu');
      assert.equal(await signUp(page, user), 200);
      await page.reload();
      await page.waitForSelector('#account:not([hidden])');
      assert.equal(await page.isVisible('.hero'), false, 'logado ainda vê a capa');
      assert.equal(await page.isVisible('#host-setup'), true);

      await page.click('#me-chip');
      assert.equal(await page.getAttribute('#me-chip', 'aria-expanded'), 'true');
      assert.equal(await page.textContent('#menu-user'), '@' + user);
      await page.keyboard.press('Escape');
      assert.equal(await page.isVisible('#account-menu'), false);
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'me-chip');
    } finally {
      await ctx.close();
    }
  });

  test('convite: HTML inicial com título de convite, imagem absoluta e sem cache', async () => {
    const r = await fetch(`${server.base}/?sala=abc123`);
    const html = await r.text();
    assert.match(html, /<meta property="og:title" content="Convite para uma transmissão no Blink"/);
    assert.match(html, new RegExp(`<meta property="og:image" content="${server.base}/icon-512.png"`));
    assert.match(html, new RegExp(`<meta property="og:url" content="${server.base}/s/ABC123"`));
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.equal(r.headers.get('referrer-policy'), 'no-referrer');

    const home = await (await fetch(server.base + '/')).text();
    assert.match(home, /<meta property="og:title" content="Blink"/);
  });
});
