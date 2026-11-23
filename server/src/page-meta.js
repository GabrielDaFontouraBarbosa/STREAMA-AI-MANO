// Meta tags do index.html na primeira resposta HTTP. Quem gera a prévia do
// link (Discord, WhatsApp, Telegram) não roda JS e costuma ignorar og:image
// relativa: a imagem e a URL têm de ser absolutas, a partir do PUBLIC_URL.
//
// Convite (/?sala=CODE, para onde /s/CODE redireciona): título genérico e
// igual para sala aberta ou encerrada. Nada do host, nada de presença: a
// prévia não pode revelar quem está ao vivo.

export const INVITE_TITLE = 'Convite para uma transmissão no Blink';
export const INVITE_DESCRIPTION = 'Abra o link para assistir no navegador. Não precisa instalar nada.';

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function pageMeta({ publicUrl, room = null }) {
  const base = String(publicUrl).replace(/\/+$/, '');
  const image = `${base}/icon-512.png`;
  if (room) return { title: INVITE_TITLE, description: INVITE_DESCRIPTION, url: `${base}/s/${room}`, image };
  return { title: null, description: null, url: `${base}/`, image };
}

// Troca só o atributo content das meta tags conhecidas (e o <title> do
// convite). Não toca em <script>: o hash da CSP é calculado sobre o arquivo.
export function renderPage(html, meta) {
  let out = html;
  const set = (attr, name, value) => {
    if (value == null) return;
    const re = new RegExp(`(<meta ${attr}="${name}" content=")[^"]*(")`);
    out = out.replace(re, (_, a, b) => a + esc(value) + b);
  };
  set('property', 'og:image', meta.image);
  set('name', 'twitter:image', meta.image);
  set('property', 'og:url', meta.url);
  set('property', 'og:title', meta.title);
  set('name', 'twitter:title', meta.title);
  set('property', 'og:description', meta.description);
  set('name', 'twitter:description', meta.description);
  set('name', 'description', meta.description);
  if (meta.title) out = out.replace(/<title>[^<]*<\/title>/, `<title>${esc(meta.title)}</title>`);
  return out;
}
