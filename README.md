# Blink

Sua tela (ou câmera) ao vivo pros amigos, direto do navegador. O vídeo vai
ponto a ponto via WebRTC — o servidor só apresenta um navegador ao outro.

## Stack

| Camada | O que usa |
|---|---|
| Servidor | Node 22 + Express 5, um processo só (HTTP + WebSocket na mesma porta) |
| Banco | Postgres (Railway) via **Drizzle ORM** — migrations em `server/drizzle/` |
| Contas | **Better Auth** — email/senha + login por usuário, cookie httpOnly rolante (30 dias) |
| TURN | **Cloudflare Realtime** — credencial temporária gerada em `/api/ice` |
| Avisos | WebSocket (app aberto) + **Web Push/VAPID** (app fechado) |
| Front | HTML/CSS/JS puro em `public/` (PWA) |
| Mídia | Mesh P2P — bom pra até ~5 espectadores por sala |

## Estrutura

```
server/
  index.js            boot: migrations → HTTP + WS
  drizzle.config.js   config do drizzle-kit
  drizzle/            migrations SQL versionadas (aplicadas no boot)
  src/
    config.js         variáveis de ambiente
    db/schema.js      tabelas (auth + friendships, live_streams, push_subscriptions)
    db/index.js       pool pg + instância Drizzle + runMigrations()
    auth.js           Better Auth (plugin username)
    app.js            rotas HTTP (/api/*, /@user, /s/CODE, estáticos)
    signaling.js      WebSocket: salas WebRTC, presença, pedidos de entrada
    hub.js            quem está online / ao vivo (memória + live_streams)
    friends.js        amizades no banco
    turn.js           Cloudflare TURN
    push.js           Web Push
public/               a página (index.html, app.js, styles.css, sw.js)
```

## Documentação

- [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md): como o Blink funciona por dentro, limites e decisões.
- [`docs/MELHORIAS.md`](docs/MELHORIAS.md): plano de melhorias (visual, uso, desempenho, bugs).

## Mini Blink (Discord)

Bot que anuncia a live no Discord e deixa assistir **dentro do próprio
Discord**. Como lá não tem WebRTC, o vídeo vai por WebSocket com WebCodecs
(`server/src/relay.js`, `public/relay-host.js`, `public/discord/`). Configuração
e testes em [`mini-blink/README.md`](mini-blink/README.md).

## Rodar com Docker (recomendado)

Precisa só do Docker. Sobe o app e um Postgres, com dados persistidos num volume.

```bash
cp .env.example .env                  # preencha BETTER_AUTH_SECRET e POSTGRES_PASSWORD
docker compose up -d --build db app   # http://localhost:8080
docker compose logs -f app            # acompanhar
docker compose down                   # parar (o banco continua no volume)
```

### Mostrar pros amigos (túnel Cloudflare)

**Opção A — rápido, sem conta.** A URL é aleatória e muda a cada vez que o túnel sobe.

```bash
docker compose up -d --build db app
docker compose --profile quick up -d tunnel
docker compose logs tunnel | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | head -1
```

Copie a URL que aparecer e coloque no `.env`:

```
PUBLIC_URL=https://SUA-URL.trycloudflare.com
TRUSTED_ORIGINS=http://localhost:8080,https://SUA-URL.trycloudflare.com
```

Depois reaplique o app com o novo `.env`:

```bash
docker compose up -d app
```

Mande a URL pros amigos. Se você reiniciar o túnel, a URL muda: repita os dois últimos passos.

**Opção B — link fixo.** Precisa de um domínio na Cloudflare. Em **Zero Trust → Networks → Tunnels**, crie um túnel, aponte um hostname (ex.: `blink.seudominio.com`) para `http://app:8080` e copie o token. No `.env`:

```
CLOUDFLARE_TUNNEL_TOKEN=eyJ...
PUBLIC_URL=https://blink.seudominio.com
TRUSTED_ORIGINS=http://localhost:8080,https://blink.seudominio.com
```

```bash
docker compose up -d --build
docker compose --profile named up -d tunnel-named
```

O link não muda e funciona enquanto o seu PC estiver ligado com o Docker rodando.

> O túnel encaminha tráfego pro seu PC: enquanto ele estiver no ar, quem tiver o link acessa o app. Só compartilhe com quem você quer.

## Rodar local (sem Docker)

Precisa de Node 22+ e um Postgres.

```bash
cp .env.example .env          # ajuste DATABASE_URL
cd server
npm install
npm run dev                   # aplica migrations e sobe em http://localhost:8080
```

Mudou o schema (`server/src/db/schema.js`)? Gere a migration e faça commit dela:

```bash
cd server
npm run db:generate           # cria server/drizzle/XXXX_*.sql
npm run db:studio             # (opcional) navegar no banco
```

## Deploy no Railway

1. No projeto, **+ New → Database → PostgreSQL**.
2. No serviço do app, em **Variables**:
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`
   - `BETTER_AUTH_SECRET` = saída de `openssl rand -base64 32`
   - `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (gere com `cd server && npm run vapid:keys`)
   - `CLOUDFLARE_TURN_KEY_ID`, `CLOUDFLARE_TURN_API_TOKEN` (Cloudflare → Realtime → TURN Server)
3. Deploy. As migrations rodam sozinhas no boot. Confira em `/api/health`
   (`{"ok":true,"turn":true,"push":true}`).

Sem TURN o app funciona, mas quem estiver atrás de NAT restrito (rede de
empresa, alguns 4G) fica em "Sintonizando…" pra sempre.

## API

| Método | Rota | O que faz |
|---|---|---|
| * | `/api/auth/*` | Better Auth (`sign-up/email`, `sign-in/email`, `sign-in/username`, `sign-out`, …) |
| GET | `/api/me` | usuário logado (401 se não) |
| GET | `/api/ice` | ICE servers (TURN só pra logado) |
| GET | `/api/users/:username` | perfil + amizade + status (se amigo) |
| GET | `/api/friends` | amigos (com status), pedidos recebidos e enviados |
| POST | `/api/friends/request` | `{ username }` — pede amizade (ou aceita, se o outro já tinha pedido) |
| POST | `/api/friends/accept` | `{ requestId }` |
| POST | `/api/friends/decline` | `{ requestId }` — recusa ou cancela |
| DELETE | `/api/friends/:userId` | desfaz amizade |
| GET | `/api/push/key` | chave pública VAPID |
| POST | `/api/push/subscribe` / `unsubscribe` | inscrição Web Push |
| GET | `/s/:code` | link direto da sala → abre Assistir já preenchido |
| GET | `/@:username` | link fixo da pessoa → se amigo e ao vivo, pede pra entrar |

## Privacidade das salas

- O link `/s/CODE` entra direto (quem tem o link, assiste — inclusive sem conta).
- O link `/@usuario` nunca revela o código: só amigos aceitos conseguem pedir
  pra entrar, e o host aceita ou recusa na hora.

## Limites

- Mesh: o upload do host multiplica por espectador. Passou de ~5, pense em SFU (LiveKit).
- Push no iPhone só com o Blink instalado na tela inicial (PWA).
- O free tier do Railway pode dormir; a primeira conexão demora uns segundos.
