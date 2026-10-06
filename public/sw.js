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
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // /version existe pra dizer a verdade sobre o que está no ar. Se passasse
  // pelo cache, poderia responder a versão antiga — justamente o erro que
  // ele serve pra detectar.
  if (url.pathname === '/version') return;
  // API, auth e links de redirect nunca vão pro cache.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/s/') || url.pathname.startsWith('/@')) return;

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

/* ── Web Push: "fulano entrou ao vivo" ─────────────────────── */

self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { title: 'Blink', body: e.data?.text() }; }
  e.waitUntil(self.registration.showNotification(data.title || 'Blink', {
    body: data.body || '',
    icon: './icon-192.png',
    badge: './icon-192.png',
    tag: data.tag,
    renotify: !!data.tag,
    data: { url: data.url || '/' },
  }));
});

// Clicar na notificação: foca uma aba do Blink se já tiver, senão abre.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = new URL(e.notification.data?.url || '/', self.location.origin).href;
  e.waitUntil((async () => {
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const tab = tabs.find((c) => new URL(c.url).origin === self.location.origin);
    if (tab) { await tab.focus(); return tab.navigate(target); }
    return self.clients.openWindow(target);
  })());
});
