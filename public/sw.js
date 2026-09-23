/* Service worker — estratégia "rede primeiro, cache como rede reserva".
 *
 * Deliberadamente NÃO é cache-first: num app que atualiza por deploy
 * contínuo, cache-first faz o usuário ver a versão velha depois do deploy.
 * Aqui a rede sempre ganha quando está disponível; o cache só entra
 * quando o usuário está offline.
 *
 * Suba o CACHE ao mudar a lista de arquivos do shell.
 */

const CACHE = 'blink-v1';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './icon.svg',
  './manifest.webmanifest',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;

  // Só GET de mesma origem. POST, WebSocket e CDNs passam direto.
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  e.respondWith(
    fetch(request)
      .then((res) => {
        // Só guarda resposta boa. Sem esse teste, um 404 ou um 500 passageiro
        // virava a versão "offline" do arquivo e o usuário continuava vendo
        // o erro mesmo depois da rede voltar.
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(async () => {
        const hit = await caches.match(request);
        if (hit) return hit;
        // Navegação offline sem cache da rota: cai no shell.
        if (request.mode === 'navigate') return caches.match('./index.html');
        return new Response('Offline', { status: 503, statusText: 'Offline' });
      })
  );
});
