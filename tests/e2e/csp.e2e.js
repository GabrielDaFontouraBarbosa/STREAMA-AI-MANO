// Cabeçalhos de segurança: a CSP não pode bloquear nada do próprio Blink
// (login, transmitir, assistir pelo navegador e pela Activity), e a
// Activity não pode receber regras de enquadramento.

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { endHostRoom, hostRelay, launchBrowser, signUp, skipReason, startServer, uniqueUser } from './helpers.js';

// Coleta violações de CSP (evento do navegador + mensagens do console).
async function watchCsp(context) {
  await context.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
}

describe('cabeçalhos de segurança', { skip: skipReason }, () => {
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

  test('site tem CSP e não pode ser embutido; a Activity fica sem regra de enquadramento', async () => {
    const site = await fetch(server.base + '/');
    assert.match(site.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
    assert.equal(site.headers.get('x-frame-options'), 'DENY');

    for (const p of ['/?frame_id=abc', '/discord/viewer.js']) {
      const r = await fetch(server.base + p);
      assert.equal(r.headers.get('content-security-policy'), null, `${p} recebeu CSP`);
      assert.equal(r.headers.get('x-frame-options'), null, `${p} recebeu X-Frame-Options`);
    }
  });

  test('nenhuma violação de CSP em login, transmissão, navegador e Activity', async () => {
    const consoleCsp = [];
    const hostCtx = await browser.newContext();
    await watchCsp(hostCtx);
    await hostCtx.addInitScript(() => {
      navigator.mediaDevices.getDisplayMedia = async () => {
        const c = document.createElement('canvas');
        c.width = 320; c.height = 180;
        const g = c.getContext('2d');
        let f = 0;
        setInterval(() => { g.fillStyle = (f++ % 2) ? '#c0392b' : '#2471a3'; g.fillRect(0, 0, 320, 180); }, 50);
        return c.captureStream(15);
      };
    });
    const host = await hostCtx.newPage();
    host.on('console', (m) => { if (/Content Security Policy/i.test(m.text())) consoleCsp.push(m.text()); });

    await host.goto(server.base + '/');
    await host.click('#login-btn');
    await host.waitForTimeout(300);
    assert.equal(await signUp(host, uniqueUser('csp')), 200);
    await host.reload();
    await host.waitForTimeout(800);
    await host.click('#host-start');
    await host.waitForFunction(() => /^Sala [0-9A-F]{6}$/.test(document.querySelector('#room-tag').textContent), null, { timeout: 15000 });
    const code = (await host.textContent('#room-tag')).slice(5);

    const viewerCtx = await browser.newContext();
    await watchCsp(viewerCtx);
    const viewer = await viewerCtx.newPage();
    viewer.on('console', (m) => { if (/Content Security Policy/i.test(m.text())) consoleCsp.push(m.text()); });
    await viewer.goto(`${server.base}/?sala=${code}`);
    await viewer.fill('#viewer-name', 'Amigo');
    await viewer.click('#viewer-join');
    await viewer.waitForFunction(() => {
      const v = document.querySelector('#remote-video');
      return v && !v.hidden && v.currentTime > 0.2;
    }, null, { timeout: 20000 });

    const activity = await viewerCtx.newPage();
    activity.on('console', (m) => { if (/Content Security Policy/i.test(m.text())) consoleCsp.push(m.text()); });
    await activity.goto(`${server.base}/discord/?sala=${code}`);
    await activity.waitForTimeout(1500);

    const violations = [
      ...(await host.evaluate(() => window.__csp)),
      ...(await viewer.evaluate(() => window.__csp)),
      ...(await activity.evaluate(() => window.__csp ?? [])),
      ...consoleCsp,
    ];
    await viewerCtx.close();
    await hostCtx.close();
    assert.deepEqual(violations, [], `violações de CSP:\n${violations.join('\n')}`);
  });

  test('controle: o detector pega uma violação de verdade', async () => {
    const ctx = await browser.newContext();
    await watchCsp(ctx);
    const page = await ctx.newPage();
    await page.goto(server.base + '/');
    await page.evaluate(() => {
      const img = document.createElement('img');
      img.src = 'https://example.com/fora-do-blink.png';
      document.body.append(img);
    });
    await page.waitForFunction(() => window.__csp.length > 0, null, { timeout: 5000 });
    assert.match((await page.evaluate(() => window.__csp)).join(' '), /img-src/);
    await ctx.close();
  });

  test('a página do relay (publicar) continua funcionando com a CSP do site', async () => {
    const ctx = await browser.newContext();
    await watchCsp(ctx);
    const page = await ctx.newPage();
    await page.goto(server.base + '/');
    assert.equal(await signUp(page, uniqueUser('cspr')), 200);
    const room = await hostRelay(page, { audio: true });
    assert.match(room.roomCode, /^[0-9A-F]{6}$/);
    await page.waitForTimeout(500);
    assert.deepEqual(await page.evaluate(() => window.__csp), []);
    await endHostRoom(page);
    await ctx.close();
  });
});
