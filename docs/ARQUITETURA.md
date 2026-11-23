# Blink — Arquitetura

Documento técnico para quem vai manter ou evoluir o Blink. Descreve o que o
sistema faz, por que foi desenhado assim, onde estão os limites e o que muda
quando ele crescer. Os números e nomes citados batem com o código de
`master` (commit do PR #3).

---

## 1. Resumo em um parágrafo

O Blink é um app de transmissão de tela/câmera para grupos pequenos. A mídia
trafega **ponto a ponto via WebRTC (topologia mesh)**; o servidor é só o
**plano de controle**: autenticação, sinalização, presença, amizades e
notificações. A exceção é quem assiste **dentro do Discord**: as Activities
proíbem WebRTC, então para esse público o host codifica com **WebCodecs** e o
servidor faz **relay por WebSocket**. Tudo roda num **único processo Node.js**
(HTTP + WebSocket + bot do Discord), com **Postgres** para estado durável e
**memória** para estado efêmero (salas).

---

## 2. Princípios de design

| Princípio | Consequência no código |
|---|---|
| **Servidor fora do caminho da mídia** | Custo de banda ~zero no caso comum; cabe em plano grátis. O preço é o limite do mesh (seção 6). |
| **Um processo, uma porta** | `server/index.js` sobe Express, a sinalização (`ws`), o relay e o bot. Deploy trivial; escala vertical apenas. |
| **Estado efêmero em memória, durável no banco** | Salas (`rooms`), relay e presença vivem em `Map`s. Contas, amizades, histórico de lives e inscrições de push vivem no Postgres. |
| **Sem build no front** | `public/` é servido como está: HTML/CSS/JS ES modules. A única dependência empacotada é o SDK do Discord (`public/discord/sdk.js`, gerado por esbuild). |
| **Degradar em vez de quebrar** | Sem TURN cai para STUN; sem VAPID o push desliga; sem token do Discord o bot não sobe; sem WebCodecs a Activity manda abrir no navegador. |

---

## 3. Topologia

```mermaid
flowchart LR
  subgraph Navegadores
    H[Host<br/>app.js + relay-host.js]
    V[Amigo no navegador<br/>app.js]
    D[Amigo no Discord<br/>Activity: discord/viewer.js]
  end

  subgraph Render["Processo único (Render)"]
    E[Express<br/>API + estáticos]
    A[Better Auth]
    S[Sinalização WS<br/>signaling.js]
    R[Relay WS<br/>relay.js]
    B[Bot Mini Blink<br/>discord.js]
  end

  N[(Neon Postgres)]
  CF[Cloudflare TURN]
  DC[Discord API / Gateway]

  H -- "WebRTC (mídia P2P)" --> V
  H -- "offer/answer/ICE, chat" --> S
  V -- "offer/answer/ICE, chat" --> S
  H -- "H.264/VP8 + Opus (WS)" --> R
  R -- "WS via proxy do Discord" --> D
  E --- A
  A --- N
  E --- N
  E -- "credencial TURN temporária" --> CF
  B --- DC
  H & V -. "relay quando P2P falha" .- CF
```

---

## 4. Componentes

### 4.1 HTTP (`server/src/app.js`)

Express 5. Ordem dos middlewares importa:

1. **`/api/auth/*`**: antes vem o middleware que grava `x-blink-client-ip`
   (seção 7.3); depois o handler do Better Auth, **antes** do
   `express.json()`, porque ele lê o corpo sozinho.
2. **`/api/*`**: JSON com limite de 32 KB, `Cache-Control: no-store`.
3. **Links diretos**: `/s/:code` → `/?sala=CODE`; `/@usuario` → `/?perfil=…`.
4. **Activity do Discord**: `GET /` com `?frame_id` entrega
   `public/discord/index.html` (o Discord abre a raiz do mapeamento).
5. **Estáticos** com cache longo só para imagens e fontes; HTML/CSS/JS
   revalidam sempre.

Rotas relevantes: `/api/health` (toca o banco), `/version` (não toca, usado
para manter o serviço acordado), `/api/site`, `/api/me`, `/api/ice`,
`/api/rooms/:code`, `/api/friends*`, `/api/push/*` e `/api/discord/*`.

### 4.2 Autenticação (`server/src/auth.js`)

Better Auth com adapter Drizzle.

- **Credenciais**: e-mail + senha (8–128) e login por **username** (plugin
  `username`, 3–20 `[a-z0-9_]`, que vira o link `/@usuario`).
- **Sessão**: cookie httpOnly `blink.*`, `SameSite=Lax`, 30 dias com
  renovação diária; `cookieCache` de 5 min evita ida ao banco a cada request.
- **Discord (OAuth2)**, ligado quando há `DISCORD_CLIENT_ID` + `_SECRET`:
  - **Entrar/criar conta**: conta nova ganha username gerado
    (`databaseHooks.user.create.before` → `uniqueUsername`).
  - **Vincular** a uma conta existente: só **logado** (`link-social`).
  - `disableImplicitLinking: true`: entrar pelo Discord **nunca** junta
    sozinho com uma conta de mesmo e-mail. Sem isso, um Discord com e-mail
    não verificado igual ao de outra pessoa tomaria a conta dela.
- **Rate limit**: 100 req/min geral; 10/min para sign-in; 5/min para
  sign-up, por IP (seção 7.3).

### 4.3 Dados (`server/src/db/`)

Drizzle ORM sobre `pg`. Migrations versionadas em `server/drizzle/`,
aplicadas **no boot** (`runMigrations()`), então cada deploy sobe com o
schema certo sem passo manual.

| Tabela | Papel |
|---|---|
| `user`, `session`, `account`, `verification` | Better Auth. `account` guarda credencial e vínculo com o Discord (`provider_id = 'discord'`, `account_id` = ID do usuário no Discord). |
| `friendships` | Pedido/aceite; a amizade é simétrica na leitura. |
| `live_streams` | Histórico de lives; no boot, `closeDanglingStreams()` fecha as que ficaram abertas por queda do processo. |
| `push_subscriptions` | Endpoints Web Push por usuário. |

TLS do Postgres é ligado automaticamente quando a URL tem
`sslmode=require` (Neon) ou com `PGSSL=1`.

### 4.4 Sinalização (`server/src/signaling.js`)

WebSocket na mesma porta. A sessão do Better Auth é lida **no upgrade**, a
partir do cookie: o servidor sabe quem é cada conexão e não confia em nome
ou id que o cliente diga ser.

**Mensagens do cliente**: `identify`, `host-create-room`, `host-resume`,
`viewer-join`, `viewer-resume`, `offer`, `answer`, `ice-candidate`,
`restart-ice`, `join-request`, `join-response`, `chat`, `leave` e `ping`.

**Ciclo de vida da sala**:

```mermaid
stateDiagram-v2
  [*] --> Aberta: host-create-room (logado)
  Aberta --> SemHost: host caiu (WS fechou)
  SemHost --> Aberta: host-resume em até 45 s
  SemHost --> [*]: GRACE_MS (45 s) expira
  Aberta --> [*]: leave do host
```

- **Código**: 3 bytes aleatórios em hex (6 caracteres, ~16,7 mi combinações).
- **Queda não derruba a sala**: como a mídia é P2P, o vídeo continua mesmo
  com o WebSocket caído. Host e viewers têm `GRACE_MS = 45 s` para voltar
  (`*-resume`). Se o **processo** reiniciou, `host-resume` recria a sala com
  o **mesmo código**, e quem estava assistindo reconecta sozinho.
- **Heartbeat**: ping a cada 30 s; conexão sem pong é derrubada.
- **Limites**: 50 viewers por sala, nome com 24 caracteres, chat com 300,
  payload de 256 KB.
- **Privacidade**: `/s/CODE` entra direto (quem tem o código assiste). O
  `/@usuario` **nunca revela o código**: só amigo aceito pode pedir para
  entrar (`join-request`), e o host aceita ou recusa na hora.

### 4.5 Presença (`server/src/hub.js`)

Índice em memória de conexões "sociais" por usuário (uma por aba) e de quem
está ao vivo. Emite `presence`, `friend-went-live` e `friends-changed` para
os amigos, e dispara Web Push quando alguém entra ao vivo.

### 4.6 Caminho da mídia: WebRTC mesh (`public/app.js`)

- **Uma `RTCPeerConnection` por espectador**, com `bundlePolicy:
  'max-bundle'`. O host faz o offer (`offerTo`) quando o viewer entra.
- **ICE**: `/api/ice` entrega STUN sempre e TURN (Cloudflare Realtime)
  quando configurado, com credencial temporária de 6 h, cacheada até a metade
  da validade, e porta 53 removida. TURN só para quem está logado ou tem o
  código de uma sala aberta, para não virar relay grátis.
- **Perfis de qualidade** (`QUALITY`):

  | Perfil | `contentHint` | FPS | `degradationPreference` | Teto/viewer |
  |---|---|---|---|---|
  | Jogo ou vídeo | `motion` | 60 | `maintain-framerate` | 6 Mbps |
  | Texto ou código | `detail` | 30 | `maintain-resolution` | 4 Mbps |
  | Câmera | `motion` | 30 | `balanced` | 2,5 Mbps |

- **Orçamento de upload**: `UPLOAD_BUDGET_KBPS = 12000` dividido pelo número
  de peers, com piso de 500 kbps (`tuneSender`). Cada viewer novo reduz o
  bitrate dos outros. Esse é o limite físico do mesh.
- **Troca de fonte** (tela ↔ câmera) usa `replaceTrack`: sem renegociação e
  sem corte para quem assiste.
- **Captura**: `getDisplayMedia` com no máximo 1080p, áudio sem
  cancelamento de eco nem supressão de ruído (estragam música/jogo),
  `systemAudio: 'include'` e `selfBrowserSurface: 'exclude'`.

### 4.7 Relay para o Discord (`server/src/relay.js` + `public/relay-host.js`)

Motivo: a documentação de networking das Activities diz *"WebRTC is not
supported"*; o proxy delas (Cloudflare Workers) aceita **HTTPS e WebSocket**.

```mermaid
sequenceDiagram
  participant H as Host (relay-host.js)
  participant R as Servidor (relay.js)
  participant D as Activity (viewer.js)
  H->>R: WS /relay/host?sala&key (HMAC da sala)
  D->>R: WS /relay/view?sala
  R->>H: {type:'demand', viewers:1}
  Note over H: só agora liga o encoder
  H->>R: {type:'config', video, audio}
  R->>D: config
  R->>H: {type:'keyframe'}
  loop cada frame
    H->>R: pacote binário (vídeo/áudio)
    R->>D: repassa (com backpressure)
  end
```

- **Codificação sob demanda**: o host só codifica enquanto `demand > 0`.
  Com zero viewers no Discord, custo zero.
- **Captura em segundo plano**: `MediaStreamTrackProcessor` continua
  entregando frames com a aba escondida (o host está no jogo), ao contrário
  de `requestAnimationFrame`/timers.
- **Codec**: H.264 baseline (`avc1.42E01F`, Annex B) primeiro, porque
  decodifica em tudo, iPhone incluso; depois VP8 e VP9. Áudio em Opus 96 kbps.
- **Saída**: até 1280×720, 30 fps, 2 Mbps; keyframe a cada 2 s ou sob pedido.
- **Formato do pacote**: `[tipo:1][flags:1][timestamp µs float64 BE:8][dados]`.
- **Backpressure por viewer**: acima de 1,5 MB em buffer, descarta vídeo até
  o próximo keyframe e pede um; acima de 8 MB, derruba a conexão. O áudio
  continua passando.
- **Autorização**: publicar exige `key = HMAC(authSecret, "relay:"+código)`,
  entregue só ao host pela sinalização. É sem estado e sobrevive a reinício.
- **Limites**: 20 viewers por sala; pacote do host até 1 MB.

### 4.8 Mini Blink: bot do Discord (`mini-blink/`, `server/src/minibot.js`)

- Roda **dentro do processo do Blink** quando `DISCORD_TOKEN` existe
  (`startBot()`), ou sozinho com `npm start`. Só a intent `Guilds`, sem
  intents privilegiadas.
- **`/live`** e o botão **"Mandar no Discord"** compartilham `publish()`:
  postam o anúncio, ligam canal → sala no Blink e passam a acompanhar a sala.
  A cada 20 s o bot consulta `/api/rooms/:code`; são necessárias 2 respostas
  "fechada" seguidas para encerrar (evita encerrar por um soluço). Anúncios
  com mais de 12 h encerram sozinhos.
- **Abrir a Activity**: o botão responde com `LAUNCH_ACTIVITY` (tipo 12) e
  recebe o `activity_instance.id`; o bot registra instância → sala em
  `/api/discord/link` (com `MINI_BLINK_SECRET`).
- **Qual sala a Activity abre**, em ordem: `?sala`, `custom_id`, instância,
  canal e, por último, digitar o código.
- **Persistência**: `mini-blink/data/lives.json` (escrita atômica via
  rename). No Render o disco é efêmero e o arquivo se perde no redeploy.
- **Manter acordado**: no Render, o processo acessa o próprio `/version` a
  cada 10 min. Como `/version` não toca o banco, o Neon pode dormir.

### 4.9 PWA e push (`public/sw.js`, `server/src/push.js`)

Service worker com cache de estáticos, `push` e `notificationclick`. Web
Push via VAPID, desligado sem as chaves. No iPhone só funciona com o app
instalado na tela inicial.

---

## 5. Deploy

| Peça | Onde | Observação |
|---|---|---|
| App | Render (Docker, plano grátis) | `Dockerfile` instala `server/` e `mini-blink/` (só produção). |
| Banco | Neon (Postgres) | Grátis e sem expirar; o Postgres grátis do Render expira. |
| TURN | Cloudflare Realtime | Opcional. Sem ele, NAT simétrico fica em "Sintonizando…". |
| Discord | App com Bot + Activities + OAuth2 | URL mapping `/` → host do Blink; redirect `…/api/auth/callback/discord`. |
| Local | `docker compose` | `db` + `app` + túnel Cloudflare opcional (profiles `quick`/`named`). |

Variáveis: ver `.env.example` (raiz) e `mini-blink/.env.example`.

---

## 6. Limites de escala (e o que fazer quando bater neles)

| Limite | Por quê | Saída |
|---|---|---|
| **~5 viewers no navegador** | Mesh: o upload do host é dividido por N. Com 12 Mbps e 5 viewers, ~2,4 Mbps cada. | **SFU** (LiveKit, mediasoup): o host sobe uma vez e o servidor distribui. Muda o custo de banda. |
| **20 viewers no Discord** | Relay em processo, ~2 Mbps por viewer saindo do servidor. | Mover o relay para um serviço próprio, ou servir o Discord a partir do SFU. |
| **Uma instância só** | Salas, presença e relay são `Map`s em memória. Duas réplicas não se enxergam. | Redis (pub/sub + estado de sala) ou sticky sessions por código de sala. |
| **Estado do bot em arquivo** | `lives.json` some no redeploy. | Tabela `discord_lives` no Postgres. |
| **Plano grátis do Render** | ~750 h/mês; o serviço sempre acordado consome quase tudo. A banda do relay também conta. | Plano pago ou VPS quando houver uso real. |

---

## 7. Modelo de segurança

### 7.1 Segredos

| Segredo | Onde vive | Uso |
|---|---|---|
| `BETTER_AUTH_SECRET` | Render | Assina sessões e deriva a chave do relay. Obrigatório em produção. |
| `MINI_BLINK_SECRET` | Render (+ bot, se separado) | Bot → `/api/discord/link`. Comparado em tempo constante. |
| `DISCORD_TOKEN`, `DISCORD_CLIENT_SECRET` | Render | Bot e OAuth. |
| TURN / VAPID | Render | Nunca chegam ao front: o front recebe só o resultado de `/api/ice` e a chave **pública** VAPID. |

### 7.2 Superfícies e defesas

- **Origem do WebSocket**: o upgrade recusa origens fora de `PUBLIC_URL` /
  `TRUSTED_ORIGINS`. Exceção consciente: `/relay/view`, que é só leitura e
  pede o código da sala, aceita a origem do proxy do Discord.
- **Publicar no relay**: exige o HMAC da sala.
- **Contas**: sem vínculo implícito pelo Discord (seção 4.2).
- **TURN**: só para logado ou para quem tem o código de uma sala aberta.

### 7.3 IP do cliente e rate limit

Atrás do Render, o `X-Forwarded-For` **não é limpo**, só acrescido; o começo
da lista é do visitante. O app grava `x-blink-client-ip` a partir de:

1. `CLIENT_IP_HEADER`: no Render, por padrão `cf-connecting-ip`, porque a
   Cloudflare na frente do Render sobrescreve esse cabeçalho;
2. senão, `req.ip` do Express com `trust proxy = 1`, o último salto.

O Better Auth lê só esse cabeçalho (`advanced.ipAddress.ipAddressHeaders`).

### 7.4 Riscos conhecidos (aceitos ou pendentes)

- **Sem CSP nem cabeçalhos de endurecimento** (`helmet` ou equivalente).
- **`/api/rooms/:code` e `/api/discord/room?channel=` não têm rate limit**:
  permitem descobrir códigos abertos por força bruta e obter o código de uma
  sala a partir do ID de um canal.
- **O código da sala é a única credencial do link `/s/`**: é um link de
  convite por desenho, não uma sala privada.

---

## 8. Observabilidade e testes

- **Logs**: `console.*` no stdout do Render. Não há métricas nem tracing.
- **Saúde**: `/api/health` (testa o banco e informa se TURN e push estão
  configurados) e `/version` (commit + horário do boot, sem banco).
- **Testes automatizados**: só o bot (`mini-blink`, `node --test`). O
  servidor e o front não têm suíte. A validação foi feita com roteiros
  Playwright ad-hoc (WebRTC, relay, áudio, rate limit) que **não estão no
  repositório**.

---

## 9. Decisões registradas

| Decisão | Alternativa descartada | Motivo |
|---|---|---|
| Mesh P2P | SFU desde o início | Custo zero e simplicidade para grupos de amigos. |
| Processo único | Microserviços | Hospedagem grátis e deploy trivial. |
| Relay WebCodecs + WS só para o Discord | HLS de baixa latência | ~0,3 s contra vários segundos de atraso, e reaproveita o WS. |
| WebCodecs no viewer | MSE | iOS não tem MSE dentro de webview; WebCodecs existe. |
| Neon para o banco | Postgres do Render | O Postgres grátis do Render expira. |
| Bot dentro do Blink | Serviço separado | As ~750 h grátis cobrem um serviço sempre acordado, não dois. |
