// Utilitários dos testes ponta a ponta: sobem o Blink de verdade (Postgres
// real, porta livre) e abrem navegadores com Playwright.
//
// Precisa de DATABASE_URL apontando para um Postgres de teste. Sem ela os
// testes são pulados (o CI sobe um Postgres como service).

import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const hasDb = !!process.env.DATABASE_URL;
export const skipReason = hasDb ? false : 'defina DATABASE_URL (Postgres de teste) para rodar os E2E';

async function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

// Sobe o servidor do Blink e espera o /api/health responder.
export async function startServer(extraEnv = {}) {
  const port = await freePort();
  const base = `http://localhost:${port}`;
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      PUBLIC_URL: base,
      BETTER_AUTH_SECRET: 'e2e-secret-0123456789abcdef0123456789abcdef',
      NODE_ENV: 'production',
      // Todos os testes saem de 127.0.0.1: cota alta para não esbarrar no
      // limite de descoberta (o teste do limite define a própria).
      DISCOVERY_PER_MIN: '1000',
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });

  const deadline = Date.now() + 30000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`servidor saiu (${child.exitCode}):\n${log}`);
    try {
      const r = await fetch(`${base}/api/health`);
      if (r.ok) break;
    } catch { /* ainda subindo */ }
    if (Date.now() > deadline) throw new Error(`servidor não respondeu em 30 s:\n${log}`);
    await new Promise((r) => setTimeout(r, 300));
  }

  return {
    base,
    port,
    log: () => log,
    async stop() {
      if (child.exitCode !== null) return;
      child.kill('SIGTERM');
      await new Promise((r) => child.once('exit', r));
    },
  };
}

export async function launchBrowser(args = []) {
  return chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', ...args] });
}

let userSeq = 0;
export function uniqueUser(prefix = 'e2e') {
  return `${prefix}${Date.now().toString(36)}${(userSeq++).toString(36)}`.slice(0, 20);
}

// Cadastra uma conta na página (o cookie de sessão fica no contexto).
export async function signUp(page, username) {
  return page.evaluate(async (u) => {
    const r = await fetch('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `${u}@t.dev`, password: 'senha12345', name: 'Host E2E', username: u }),
    });
    return r.status;
  }, username);
}

// Abre a sala pela sinalização e começa a publicar no relay com uma fonte
// sintética: canvas animado (alterna cores) e, opcionalmente, um tom de 440 Hz.
// `forceNoCodec` simula um host sem nenhum codec de vídeo para o relay.
export async function hostRelay(page, { audio = true, forceNoCodec = false } = {}) {
  return page.evaluate(async ({ audio, forceNoCodec }) => {
    if (forceNoCodec) {
      VideoEncoder.isConfigSupported = async () => ({ supported: false });
    }
    const ws = new WebSocket(location.origin.replace('http', 'ws'));
    window.__sig = ws;
    await new Promise((r) => (ws.onopen = r));
    ws.send(JSON.stringify({ type: 'host-create-room', source: 'screen' }));
    const room = await new Promise((resolve, reject) => {
      setTimeout(() => reject(new Error('sem room-created')), 8000);
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.type === 'room-created') resolve(m);
      };
    });
    window.__keepalive = setInterval(() => ws.send('{"type":"ping"}'), 15000);

    const c = document.createElement('canvas');
    c.width = 1280; c.height = 720;
    document.body.append(c);
    const g = c.getContext('2d');
    let f = 0;
    window.__draw = setInterval(() => {
      g.fillStyle = (f++ % 2) ? '#c0392b' : '#2471a3';
      g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = '#fff';
      g.font = 'bold 120px sans-serif';
      g.fillText(String(f), 80, 300);
    }, 50);
    const tracks = [...c.captureStream(20).getVideoTracks()];
    if (audio) {
      const ac = new AudioContext();
      await ac.resume();
      const osc = ac.createOscillator();
      osc.frequency.value = 440;
      const dst = ac.createMediaStreamDestination();
      osc.connect(dst);
      osc.start();
      tracks.push(...dst.stream.getAudioTracks());
    }
    const stream = new MediaStream(tracks);
    const { createRelayPublisher } = await import('/relay-host.js');
    window.__pub = createRelayPublisher({ log: () => {} });
    window.__pub.start({ stream, roomCode: room.roomCode, relayKey: room.relayKey });
    return { roomCode: room.roomCode, relayKey: room.relayKey };
  }, { audio, forceNoCodec });
}

export async function endHostRoom(page) {
  await page.evaluate(() => {
    window.__pub?.stop();
    window.__sig?.send('{"type":"leave"}');
  });
}

// Conta quantos VideoDecoder a página cria (o bug do áudio fazia o player
// recriar o decoder de vídeo a cada config).
export async function countVideoDecoders(context) {
  await context.addInitScript(() => {
    window.__videoDecodersCreated = 0;
    const Native = window.VideoDecoder;
    if (!Native) return;
    window.VideoDecoder = class extends Native {
      constructor(...args) {
        super(...args);
        window.__videoDecodersCreated++;
      }
    };
    window.VideoDecoder.isConfigSupported = Native.isConfigSupported.bind(Native);
  });
}
