// Relay do Discord (Activity) ponta a ponta: host sintético publica, viewers
// assistem por /discord/?sala=CODE (o mesmo player da Activity, fora do Discord).

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  countVideoDecoders, endHostRoom, hostRelay, launchBrowser, signUp, skipReason, startServer, uniqueUser,
} from './helpers.js';

describe('relay da Activity', { skip: skipReason }, () => {
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

  async function newHost(opts) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const logs = [];
    page.on('console', (m) => { if (m.text().includes('[relay]')) logs.push(m.text()); });
    await page.goto(server.base + '/');
    assert.equal(await signUp(page, uniqueUser('relay')), 200);
    const room = await hostRelay(page, opts);
    return { ctx, page, room, logs };
  }

  async function newViewer(code) {
    const ctx = await browser.newContext();
    await countVideoDecoders(ctx);
    const page = await ctx.newPage();
    await page.goto(`${server.base}/discord/?sala=${code}`);
    return { ctx, page };
  }

  const stats = (page) => page.evaluate(() => ({ ...window.__miniBlink, decoders: window.__videoDecodersCreated }));

  // Cor do pixel central do canvas: o host alterna vermelho e azul.
  const tone = (page) => page.evaluate(() => {
    const c = document.querySelector('#screen');
    if (!c.width) return null;
    const [r, , b] = c.getContext('2d').getImageData(c.width / 2, c.height / 2, 1, 1).data;
    return r >= b ? 'red' : 'blue';
  });

  test('a config do áudio não recria o decoder de vídeo, e a imagem continua mudando', async () => {
    const host = await newHost({ audio: true });
    const viewer = await newViewer(host.room.roomCode);
    try {
      await viewer.page.waitForFunction(() => window.__miniBlink?.videoFrames > 20, null, { timeout: 20000 });
      // Tempo de sobra para a config do áudio chegar depois da do vídeo.
      await viewer.page.waitForTimeout(1500);
      const a = await stats(viewer.page);
      await viewer.page.waitForTimeout(2000);
      const b = await stats(viewer.page);

      assert.equal(b.decoders, 1, `decoders de vídeo criados: ${b.decoders} (esperado 1)`);
      assert.ok(b.videoFrames > a.videoFrames + 10, `quadros parados: ${a.videoFrames} → ${b.videoFrames}`);
      if (!(b.audioChunks > a.audioChunks)) {
        const hostDiag = await host.page.evaluate(() => ({ ...window.__hostDiag, ...window.__pub?.stats }));
        assert.fail(`áudio não chegou — viewer: ${JSON.stringify(b)} | host: ${JSON.stringify(hostDiag)} | avisos do host: ${host.logs.join(' ; ') || 'nenhum'}`);
      }

      const seen = new Set();
      for (let i = 0; i < 20 && seen.size < 2; i++) {
        seen.add(await tone(viewer.page));
        await viewer.page.waitForTimeout(60);
      }
      assert.equal(seen.size, 2, 'a imagem não alternou de cor (cena congelada)');
    } finally {
      await endHostRoom(host.page);
      await viewer.ctx.close();
      await host.ctx.close();
    }
  });

  test('quem entra no meio recebe imagem rápido', async () => {
    const host = await newHost({ audio: false });
    const first = await newViewer(host.room.roomCode);
    try {
      await first.page.waitForFunction(() => window.__miniBlink?.videoFrames > 5, null, { timeout: 20000 });
      const late = await newViewer(host.room.roomCode);
      const t0 = Date.now();
      await late.page.waitForFunction(() => window.__miniBlink?.videoFrames > 0, null, { timeout: 10000 });
      assert.ok(Date.now() - t0 < 5000, `primeiro quadro demorou ${Date.now() - t0} ms`);
      await late.ctx.close();
    } finally {
      await endHostRoom(host.page);
      await first.ctx.close();
      await host.ctx.close();
    }
  });

  test('host sem codec de vídeo: o viewer não fica esperando para sempre', async () => {
    const host = await newHost({ audio: false, forceNoCodec: true });
    const viewer = await newViewer(host.room.roomCode);
    try {
      await viewer.page.waitForFunction(() => window.__miniBlink?.state === 'unsupported', null, { timeout: 10000 });
      assert.ok(await viewer.page.isVisible('#open-browser'), 'botão "Abrir no navegador" não apareceu');
    } finally {
      await endHostRoom(host.page);
      await viewer.ctx.close();
      await host.ctx.close();
    }
  });

  test('sala inexistente e fim da live mostram a mensagem certa', async () => {
    const ghost = await newViewer('000000');
    await ghost.page.waitForFunction(() => window.__miniBlink?.state === 'not-found', null, { timeout: 10000 });
    await ghost.ctx.close();

    const host = await newHost({ audio: false });
    const viewer = await newViewer(host.room.roomCode);
    try {
      await viewer.page.waitForFunction(() => window.__miniBlink?.videoFrames > 0, null, { timeout: 20000 });
      await endHostRoom(host.page);
      await viewer.page.waitForFunction(() => window.__miniBlink?.state === 'ended', null, { timeout: 10000 });
    } finally {
      await viewer.ctx.close();
      await host.ctx.close();
    }
  });
});
