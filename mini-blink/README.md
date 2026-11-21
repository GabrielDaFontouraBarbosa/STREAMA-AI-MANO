# Mini Blink

Bot do Discord que leva a live do Blink pro servidor:

- `/live codigo:AB12CD` posta o anúncio no canal com dois botões:
  - **Assistir aqui no Discord**: abre uma tela (Activity) dentro do próprio
    Discord, com a live rodando;
  - **Abrir no navegador**: o Blink normal.
- Quando a sala fecha, o anúncio vira "live encerrada" sozinho.
- `/encerrar` encerra seus anúncios na mão.

## Como a live roda dentro do Discord

Activities do Discord **não suportam WebRTC**. A documentação oficial
(`developers/activities/development-guides/networking.mdx` em
`discord/discord-api-docs`) diz: *"WebRTC is not supported."* Mas o proxy
delas aceita **WebSocket**. Então, só pra quem assiste pelo Discord:

1. o navegador do host codifica a tela com **WebCodecs** (H.264, com VP8/VP9
   de reserva) e o áudio em Opus (`public/relay-host.js`);
2. manda os pedaços por WebSocket pro Blink (`/relay/host`), que repassa pra
   cada viewer (`server/src/relay.js`);
3. a Activity decodifica com WebCodecs num `<canvas>`
   (`public/discord/viewer.js`).

O host só codifica enquanto tiver alguém assistindo pelo Discord. O WebRTC
normal do Blink não muda.

Como a Activity sabe qual sala abrir: o botão do bot abre a Activity
(`LAUNCH_ACTIVITY`) e avisa o Blink "a instância X é da sala Y". Se isso
falhar, ela tenta pelo canal, e por último pede o código.

## O que foi testado (Chromium headless, Blink + Postgres reais)

| Teste | Resultado |
|---|---|
| Primeiro frame no viewer | ~0,3 s |
| Codec / resolução / FPS | H.264, 1280×720, ~30 fps |
| Áudio Opus chegando | sim |
| Viewer que entra no meio | imagem em ~0,1 s |
| Host com chave falsa | recusado (403) |
| Host sem viewer no Discord | não codifica nada |
| Sala inexistente / live acabou | mensagens certas |
| Bot liga instância/canal → sala | ok, e some quando a sala fecha |
| Página do Blink normal | sem erros |

**Não testado** (precisa de um Discord e celular de verdade):

- o proxy do Discord repassando o WebSocket do relay;
- o botão abrindo a Activity num canal de texto;
- decodificação H.264 no app do Discord no iPhone/Android;
- host com a aba em segundo plano por muito tempo (a captura usa
  `MediaStreamTrackProcessor`, que não depende da aba estar visível).

## Limites

- Quem transmite precisa estar no **Chrome ou Edge** (Firefox e Safari não
  têm `MediaStreamTrackProcessor`). Quem assiste pode estar em qualquer lugar
  com WebCodecs.
- O vídeo do Discord passa pelo servidor do Blink (~2 Mbps por pessoa). No
  plano grátis do Render isso conta na franquia de banda.
- Até 20 pessoas por sala pelo Discord.

## Configurar

### 1. Discord Developer Portal

1. Em <https://discord.com/developers/applications>, clique em **New Application**.
2. **Bot**: clique em **Reset Token** e guarde o token.
3. **Installation**: em *Guild Install*, marque os escopos `bot` e
   `applications.commands` e as permissões **View Channels**, **Send
   Messages** e **Embed Links**. Abra o link de instalação e adicione o bot
   ao seu servidor.
4. **Activities → Settings**: ligue as Activities e marque **Web**, **iOS** e
   **Android**.
5. **Activities → URL Mappings**: em `/`, coloque o endereço do Blink **sem**
   `https://` (ex.: `seu-blink.onrender.com`).

### 2. O mesmo segredo nos dois lados

Gere um segredo:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

Coloque o valor em `MINI_BLINK_SECRET` no **Blink** (variáveis do Render, ou
o `.env` da raiz) e no **bot** (`mini-blink/.env`).

### 3. Rodar o bot

Precisa de Node 22. Não precisa de Docker.

```bash
cd mini-blink
cp .env.example .env
npm install
npm start
```

No `.env`, preencha `DISCORD_TOKEN`, `DISCORD_CLIENT_ID` (Application ID),
`DISCORD_GUILD_ID` (ID do seu servidor, pros comandos aparecerem na hora),
`BLINK_URL` e `MINI_BLINK_SECRET`.

O bot precisa ficar ligado pra responder. O mais simples é rodar no seu PC
enquanto você transmite.

## Bot 24h dentro do Blink (Render)

Com `DISCORD_TOKEN` nas variáveis do Blink, o bot liga junto com o site
(`server/src/minibot.js`). No Render, o Blink se acessa a cada 10 min pela
rota `/version` (que não usa o banco) pra não dormir: um serviço ligado o mês
todo cabe nas ~750 h grátis do Render.

Variáveis no Render: `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`
e `DISCORD_LIVE_CHANNEL_ID`. O `MINI_BLINK_SECRET` e o `PUBLIC_URL` já estão lá.

**Não rode o bot no PC ao mesmo tempo.** Os dois responderiam os mesmos
comandos e um deles daria erro.

## Conectar Discord e "Mandar no Discord"

- **Conectar Discord** (topo do Blink): vincula a conta do Discord à conta do
  Blink pelo login oficial do Discord. Não cria conta nova.
- **Mandar no Discord** (ao lado de "Copiar convite", durante a live): o bot
  posta o anúncio no canal `DISCORD_LIVE_CHANNEL_ID` em seu nome, com seu
  apelido do servidor. O fim da live atualiza o anúncio sozinho.

Pra ligar:

1. Portal do Discord → **OAuth2**: copie o **Client Secret** e, em
   **Redirects**, adicione `https://SEU-BLINK/api/auth/callback/discord`.
2. No Blink: `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` e
   `DISCORD_LIVE_CHANNEL_ID`.
3. O botão só aparece pra quem conectou o Discord e com o bot no ar. A conta
   do Discord precisa estar no servidor do canal de lives.

Testado com Blink + Postgres reais: link de vínculo apontando pro Discord com
o retorno certo, e as respostas pra "sem live", "sem Discord conectado" e
"bot fora do ar". **Não testado:** o login do Discord de verdade e o post
pelo botão (precisam do seu app e servidor do Discord).

## Desenvolvimento

```bash
npm test            # testes do bot
npm run build:sdk   # regera public/discord/sdk.js (SDK oficial do Discord)
```

A página da Activity funciona fora do Discord para teste:
`http://localhost:8080/discord/?sala=CODIGO`.
