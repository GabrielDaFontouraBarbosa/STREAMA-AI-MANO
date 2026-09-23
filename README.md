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

## Rodar local

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
