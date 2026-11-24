// Cabeçalhos de segurança (Helmet), com uma política por superfície:
//
// - Site principal: CSP estrita (tudo do próprio domínio; o único script
//   inline do index.html entra pelo hash, calculado no boot), proibido de ser
//   embutido em outro site (frame-ancestors 'none' + X-Frame-Options DENY).
// - Activity do Discord (`/?frame_id=…`, `/discord/*`, `/relay/*`): roda num
//   iframe do Discord, servida pelo proxy deles. Sem CSP/frame-ancestors aqui
//   para não arriscar quebrar o cliente do Discord; só nosniff e Referrer.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import helmet from 'helmet';

const REFERRER = { policy: 'strict-origin-when-cross-origin' };

// Hash de cada <script> inline do HTML, no formato da CSP.
export function inlineScriptHashes(html) {
  return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map((m) => `'sha256-${crypto.createHash('sha256').update(m[1]).digest('base64')}'`);
}

// ws:// ou wss:// de cada origem do site (WebSocket da sinalização e do relay).
export function socketOrigins(origins) {
  const out = new Set();
  for (const o of origins) {
    try {
      const u = new URL(o);
      out.add(`${u.protocol === 'https:' ? 'wss' : 'ws'}://${u.host}`);
    } catch { /* origem inválida: ignora */ }
  }
  return [...out];
}

export function isActivityRequest(req) {
  return (req.path === '/' && req.query?.frame_id != null) ||
    req.path.startsWith('/discord/') || req.path.startsWith('/relay/');
}

export function securityHeaders({ publicDir, publicUrl, trustedOrigins = [] }) {
  const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
  const scriptHashes = inlineScriptHashes(html);

  const site = helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'", ...scriptHashes],
        'style-src': ["'self'"],
        'img-src': ["'self'", 'data:'],
        'font-src': ["'self'"],
        'connect-src': ["'self'", ...socketOrigins([publicUrl, ...trustedOrigins])],
        'media-src': ["'self'", 'blob:'],
        'worker-src': ["'self'"],
        'manifest-src': ["'self'"],
        'object-src': ["'none'"],
        'base-uri': ["'none'"],
        'form-action': ["'self'"],
        'frame-ancestors': ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    frameguard: { action: 'deny' },
    referrerPolicy: REFERRER,
  });

  const activity = helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: false,
    frameguard: false,
    referrerPolicy: REFERRER,
  });

  return (req, res, next) => {
    if (isActivityRequest(req)) return activity(req, res, next);
    // Só o site usa câmera, microfone e captura de tela.
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), display-capture=(self), geolocation=(), payment=()');
    return site(req, res, next);
  };
}
