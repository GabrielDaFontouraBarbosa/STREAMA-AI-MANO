// Som na live pelo navegador (WebRTC): botão "Toque pra ouvir" quando o
// navegador barra o som, e aviso de "Live sem som" quando o host não manda.

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, signUp, skipReason, startServer, uniqueUser } from './helpers.js';

describe('áudio da live no navegador', { skip: skipReason }, () => {
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

  async function hostLive(withAudio) {
    const ctx = await browser.newContext();
    await ctx.addInitScript((withAudio) => {
      navigator.mediaDevices.getDisplayMedia = async () => {
        const c = document.createElement('canvas');
        c.width = 320; c.height = 180;
        const g = c.getContext('2d');
        let f = 0;
        setInterval(() => { g.fillStyle = (f++ % 2) ? '#c0392b' : '#2471a3'; g.fillRect(0, 0, 320, 180); }, 50);
        const tracks = [...c.captureStream(15).getVideoTracks()];
        if (withAudio) {
          const ac = new AudioContext();
          const o = ac.createOscillator();
          const d = ac.createMediaStreamDestination();
          o.connect(d);
          o.start();
          tracks.push(...d.stream.getAudioTracks());
        }
        return new MediaStream(tracks);
      };
    }, withAudio);
    const page = await ctx.newPage();
    await page.goto(server.base + '/');
    assert.equal(await signUp(page, uniqueUser('aud')), 200);
    await page.reload();
    await page.waitForTimeout(800);
    await page.click('#host-start');
    await page.waitForFunction(() => /^Sala [0-9A-F]{6}$/.test(document.querySelector('#room-tag').textContent), null, { timeout: 15000 });
    await page.waitForTimeout(500);
    return { ctx, page, code: (await page.textContent('#room-tag')).slice(5), noAudioFlag: await page.isVisible('#host-noaudio') };
  }

  // realClick=false: entra sozinho ao carregar, sem gesto (como o "pedir pra
  // entrar"); o som só libera depois de um toque de verdade (regra do iPhone).
  async function viewer(code, { realClick }) {
    const ctx = await browser.newContext();
    await ctx.addInitScript(() => {
      window.__touched = false;
      for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, (e) => { if (e.isTrusted) window.__touched = true; }, true);
      const orig = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () {
        if (!this.muted && !window.__touched) return Promise.reject(new DOMException('sem gesto', 'NotAllowedError'));
        return orig.call(this);
      };
    });
    if (!realClick) {
      await ctx.addInitScript(() => addEventListener('load', () => setTimeout(() => {
        document.querySelector('#viewer-name').value = 'Amigo';
        document.querySelector('#viewer-join').click();
      }, 800)));
    }
    const page = await ctx.newPage();
    await page.goto(`${server.base}/?sala=${code}`);
    if (realClick) {
      await page.fill('#viewer-name', 'Amigo');
      await page.click('#viewer-join');
    }
    await page.waitForFunction(() => {
      const v = document.querySelector('#remote-video');
      return v && !v.hidden && v.currentTime > 0.3;
    }, null, { timeout: 20000 });
    await page.waitForTimeout(500);
    return { ctx, page };
  }

  const state = (page) => page.evaluate(() => {
    const v = document.querySelector('#remote-video');
    return {
      muted: v.muted,
      audioTracks: v.srcObject?.getAudioTracks().length ?? 0,
      unmuteButton: !document.querySelector('#viewer-unmute').hidden,
      noAudioFlag: !document.querySelector('#viewer-noaudio').hidden,
    };
  });

  test('sem gesto: toca mudo com "Toque pra ouvir"; ao tocar, o som volta', async () => {
    const host = await hostLive(true);
    assert.equal(host.noAudioFlag, false);
    const v = await viewer(host.code, { realClick: false });
    assert.deepEqual(await state(v.page), { muted: true, audioTracks: 1, unmuteButton: true, noAudioFlag: false });
    await v.page.click('#viewer-unmute');
    await v.page.waitForTimeout(300);
    assert.deepEqual(await state(v.page), { muted: false, audioTracks: 1, unmuteButton: false, noAudioFlag: false });
    await v.ctx.close();

    const clicked = await viewer(host.code, { realClick: true });
    assert.equal((await state(clicked.page)).muted, false);
    await clicked.ctx.close();
    await host.ctx.close();
  });

  test('host sem som: selo para o host e aviso para quem assiste', async () => {
    const host = await hostLive(false);
    assert.equal(host.noAudioFlag, true);
    const v = await viewer(host.code, { realClick: true });
    const s = await state(v.page);
    assert.equal(s.audioTracks, 0);
    assert.equal(s.noAudioFlag, true);
    await v.ctx.close();
    await host.ctx.close();
  });
});
