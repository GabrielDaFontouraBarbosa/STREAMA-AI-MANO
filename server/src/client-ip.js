// IP de quem chamou, só de onde o PROXY escreve (nunca de um cabeçalho que o
// visitante possa inventar). Vale para rotas HTTP e para upgrades de
// WebSocket (que não passam pelo Express).
//
// 1. `header` (CLIENT_IP_HEADER; no Render, cf-connecting-ip: a Cloudflare
//    na frente do Render sobrescreve esse cabeçalho a cada pedido);
// 2. senão, o ÚLTIMO item do X-Forwarded-For — o que o proxy acrescentou
//    (o Render só acrescenta, então o começo da lista é do visitante);
// 3. senão, o endereço do socket.

import net from 'node:net';

const strip = (ip) => String(ip ?? '').trim().replace(/^::ffff:/, '');

export function ipFrom({ headers = {}, socketAddress = '' }, { header = '' } = {}) {
  if (header) {
    const ip = strip(String(headers[header] ?? '').split(',')[0]);
    if (net.isIP(ip)) return ip;
  }
  const hops = String(headers['x-forwarded-for'] ?? '').split(',').map(strip).filter(Boolean);
  const last = hops.at(-1);
  if (last && net.isIP(last)) return last;
  const sock = strip(socketAddress);
  return net.isIP(sock) ? sock : '0.0.0.0';
}

export function requestIp(req, header) {
  return ipFrom({ headers: req.headers, socketAddress: req.socket?.remoteAddress }, { header });
}
