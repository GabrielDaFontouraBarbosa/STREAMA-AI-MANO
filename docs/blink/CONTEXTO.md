# Blink · Contexto de trabalho (leia antes de qualquer tarefa)

Memória do projeto entre sessões. O `CLAUDE.md` da raiz carrega este
arquivo em toda sessão, na nuvem ou local. **Atualize a seção "Estado" ao
fim de cada entrega** (o que mudou, PR, pendências). Os outros documentos de
`docs/blink/` (01–08, `ARQUITETURA.md`, `MELHORIAS.md`) são o plano
detalhado; este é o resumo operacional.

---

## 1. Estado (atualizado em 23/11/2026)

**O que é:** Blink, live de tela/câmera para um grupo pequeno de amigos.
Mídia por WebRTC (mesh P2P) no navegador; relay WebCodecs por WebSocket para
quem assiste dentro do Discord (Activity). O bot "Mini Blink" roda dentro do
mesmo processo Node.

**Uso real:** 1 servidor do Discord, ~4 pessoas, menos de 3 h por dia.
**Decisão do Gabriel: tudo gratuito.** Não implementar cobrança (o caderno
08 é só plano futuro).

**No ar:**
| Peça | Onde |
|---|---|
| App + bot | Render (web service grátis, Docker), branch `master`, `https://streama-ai-mano.onrender.com` |
| Banco | Neon (Postgres) |
| Discord | App `1557862811047165992`, Activity com URL mapping `/` → host do Render, OAuth redirect `…/api/auth/callback/discord` |
| Variáveis no Render | `DATABASE_URL`, `BETTER_AUTH_SECRET`, `PUBLIC_URL` (sem barra final), `MINI_BLINK_SECRET`, `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_GUILD_ID`, `DISCORD_LIVE_CHANNEL_ID`, opcional `SUPPORT_URL` |

**Entregue (mergeado):**
- **PR #2:**
  - Mini Blink: `/live`, Activity com relay WebCodecs;
  - bot 24 h dentro do Blink, com o processo se acessando pelo `/version`
    para não dormir;
  - entrar/vincular com Discord, sem vínculo implícito;
  - "Mandar no Discord";
  - avisos de áudio no navegador ("Toque pra ouvir", "Live sem som").
- **PR #3:**
  - IP do cliente vindo só do proxy (limite de login);
  - botão do Discord com status atual.
- **PR #5** (outra sessão): "Apoiar o Blink" abre uma janela com QR PIX
  (`public/apoio-qr.png`, conferido: PIX válido, CRC ok, sem valor fixo).
  No merge com o PR #4 ficou a janela + o rodapé novo, com ícone em vez de
  emoji; E2E da janela em `tests/e2e/front.e2e.js`.

**Em revisão — PR #4** (`claude/modest-dijkstra-zeqyy1`), melhorias pontuais
do caderno 01:
- player da Activity: config por trilha, recuperação finita, avisos de
  "não suportado";
- relay com histerese;
- sala resolvida só pela instância;
- `rate-limiter-flexible` (descoberta: 20/min por IP);
- Helmet/CSP;
- testes unitários e E2E;
- CI no GitHub Actions;
- front (MELHORIAS §1–2, caderno 05): textos sem promessa falsa, rodapé com
  versão (`/version`), Open Graph absoluto e título de convite em `/?sala=`
  (`server/src/page-meta.js`), "Entre para transmitir" antes das opções,
  menu de conta no avatar, ícones SVG no lugar de emoji, "Sem sala/offline"
  escondidos, cor `--live` só para "ao vivo", capa em 2 linhas no celular e
  escondida para quem está logado.

O CI do PR #4 achou um bug real: no Chromium 153, o som da Activity sumia
porque o decoder Opus era configurado a 44,1 kHz. Corrigido (`audioDecoderConfig`
em `player-logic.js`); os contadores por etapa do áudio ficaram no código.

**Fila (adiado, com motivo em `MELHORIAS.md` §6):**
- resto do visual do caderno 05: prévia em vídeo na capa, QR, textura no
  fundo, estados vazios, "Navegador · N / Discord · N" na lista do host,
  reações, aviso de "sem áudio" antes de publicar;
- tickets/`run_id`;
- fila do bot no Postgres;
- recuperar senha (Resend; o Render grátis bloqueia SMTP);
- editar `@` e excluir conta;
- orçamento de upload;
- build com hash/PWA;
- observabilidade.

**Pendências fora do código:**
- GitGuardian: `liz-massoterapia` tem um `.env` commitado num repositório
  público (senha do Neon já inválida; conferir as outras 6 chaves);
- `projeto-hidra-treino` é de treino: ignorar como credencial de teste.

---

## 2. Quem é o usuário e como trabalhar com ele

- Gabriel fala português informal. Responda em português, simples e direto.
- Usa **Windows**. O WSL/Docker dele quebrou (DISM 0x800706BE), então não
  conte com Docker local; o caminho é Render + Neon.
- Mexe no Render, no Neon e no portal do Discord pela interface e manda
  prints. Dê passo a passo com o nome exato dos botões.
- Quer saber **o que mudou e por quê**, não só "feito". Avise o que não foi
  testado.
- Só pergunte decisões que são dele (produto, dinheiro, o que fica de fora).
  O resto, decida e diga o que decidiu.

---

## 3. Fluxo de análise que funcionou

1. **Ler o código antes de propor.** Usar `grep` e `sed -n` nos pontos
   exatos. Os números citados (bitrates, limites, tempos) vêm do código, não
   da memória.
2. **Verificar a fonte primária.** A documentação oficial é a autoridade:
   - `docs.discord.com` e `onrender.com` são bloqueados nesta sessão;
   - os docs do Discord estão em
     `raw.githubusercontent.com/discord/discord-api-docs/main/developers/…`;
   - foi assim que se descobriu "WebRTC is not supported" nas Activities, o
     que mudou todo o desenho.
   - Busca na web serve para pistas; confirme no oficial antes de afirmar.
3. **Reproduzir o bug com um teste que falha antes da correção.** Exemplo:
   "decoders de vídeo criados: 2 (esperado 1)". Só então corrigir e mostrar
   o mesmo teste passando.
4. **Regras puras em módulos sem DOM/banco** (`player-logic.js`,
   `relay-policy.js`, `client-ip.js`, `activity-links.js`) com testes
   `node:test`. A integração vai para `tests/e2e/`.
5. **Testar como o usuário usa:** servidor real, Postgres real, Chromium com
   fonte sintética (canvas + oscilador). Para regras de navegador que o
   headless não aplica (autoplay do iPhone), simule a regra e diga que é
   simulação.
6. **Revisar a segurança de cada mudança.** Pergunte: "o que um visitante
   consegue forjar aqui?" (veja a seção 5).
7. **Commit pequeno com mensagem que explica o porquê; push; PR; acompanhar
   o CI.** Falha de CI é causa a achar, não "flaky". Sem `--force` e sem
   pular teste.
8. **Fechar com relatório honesto:** o que foi feito, como foi verificado, o
   que não foi testado e o que ficou para depois.

---

## 4. Metodologia anti-slop

"Slop" é saída que parece trabalho mas não aguenta uma pergunta. Regras:

- **Cada afirmação tem prova:** linha de código, teste, doc oficial com
  link, ou "não verificado" escrito. Sem "deve funcionar".
- **Nada de texto de marketing no produto** que o código não cumpre (ex.:
  "sem servidor no meio" virou mentira com TURN e relay). Descreva o que
  acontece.
- **Interface coerente:** ícones do sprite SVG, não emoji. Linguagem de
  gente, não de painel técnico ("Offline", "Sem sala").
- **Sem dependência por moda.** Cada pacote novo precisa de: problema que
  resolve, alternativa considerada e teste que prova (caderno 01).
- **Sem código morto ou comentário órfão.** Removeu um uso? Remova o resto.
- **Teste com controle positivo:** um detector que "não acha nada" precisa
  provar que acharia (ex.: CSP com imagem externa de propósito).
- **Números honestos:** "o teste passou aqui" ≠ "funciona no Discord real".
  Diga onde rodou.
- **Prosa curta:** resultado primeiro, depois detalhes. Tabelas só quando há
  comparação de verdade.

---

## 5. Erros já cometidos (não repetir)

| Erro | Lição |
|---|---|
| Discord em `trustedProviders` com vínculo implícito | Um Discord com e-mail não verificado podia tomar a conta de outra pessoa. Use `disableImplicitLinking: true`. |
| IP do primeiro cabeçalho/começo do `X-Forwarded-For` | É forjável. Use o cabeçalho do proxy (`cf-connecting-ip` no Render) ou o **último** salto. |
| Cota de descoberta depois do 404 | Revelava se a sala existe de graça. A cota vem **antes** da checagem. |
| Canal do Discord como chave para achar a sala | O ID do canal é público. Use só a instância da Activity. |
| Senha no `docker-compose.yml`, inclusive `${VAR:?mensagem}` | O GitGuardian acusa. Use `${VAR}` puro; no CI, `POSTGRES_HOST_AUTH_METHOD: trust`. |
| `node --test` dentro de `node --test` | Remova `NODE_TEST_CONTEXT` do ambiente do filho. |
| Ler o código da sala durante a animação "scramble" | Leia `#room-tag`, que recebe o valor final. |
| Playwright `evaluate`/`fill` contam como gesto do usuário | Para simular "sem gesto", dispare a ação pela própria página (`addInitScript`). |
| Testar WebCodecs em `about:blank` | Não é contexto seguro; teste em `http://localhost`. |
| Cookie jar que sobrescreve em vez de somar | Acumule os cookies por nome. |
| `AudioDecoder` Opus pedido a 44,1 kHz | O `isConfigSupported()` diz "sim" e o `configure()` falha no Chromium 153 (som some calado). Opus decodifica sempre numa taxa nativa (48 kHz). Achado no CI, não aqui (Chromium 157): por isso o CI é obrigatório. |
| Controle positivo que não controla nada (rodapé "abaixo da dobra" que cabia na tela) | O controle tem de usar a mesma medida num caso que sabidamente falha (ex.: a mesma tela com 480 px de altura). |
| Prometer "tarefa agendada" para o início de sessão | Agendamento é por horário. Para "toda sessão", use o `CLAUDE.md`. |

---

## 6. Inovar com ambição (sem perder o pé no chão)

Antes de resolver do jeito óbvio, gaste 5 minutos procurando um caminho
melhor:

1. **Mapear as opções:** a solução padrão, uma biblioteca/framework mais
   moderna, um servidor MCP ou integração que já faz isso, e uma ideia fora
   da caixa.
2. **Ler a fonte primária de cada uma** (doc oficial, repositório, versão
   atual). Desconfie da memória: APIs mudam.
3. **Escolher pelo problema real:** ~4 usuários, grátis, Render + Neon.
   Ambicioso não é pesado: o relay WebCodecs foi uma ideia fora da caixa que
   coube no plano grátis.
4. **Fazer um spike curto** com critério de sucesso e de abandono. Se
   passar, vira PR; se não, registra o que se aprendeu aqui.

Ideias em aberto para o Blink, com o gatilho que justifica cada uma:

| Ideia | Quando vale |
|---|---|
| WebTransport no relay do Discord | Quando o proxy do Discord suportar (a doc diz "em breve") |
| Codificação do relay num Worker (`MediaStreamTrackProcessor` em worker) | Se o host travar ao transmitir para o Discord |
| SFU (LiveKit/Cloudflare Realtime) | Se aparecer sala com 5+ viewers no navegador com frequência |
| Servidores MCP (Neon, GitHub, Playwright) nas sessões de desenvolvimento | Para inspecionar o banco, o CI e o navegador sem sair do Claude Code |
| Prévia real da live na capa (vídeo de demonstração leve) | No PR do visual (caderno 05) |
| Reações rápidas na live pela sinalização | Barato e dá vida à live; depois do visual |

---

## 7. Ambiente da sessão na nuvem (pegadinhas)

- **Docker:** o daemon não sobe sozinho. Rode `dockerd &` e espere o
  `docker info` responder.
- **Postgres de teste:**

  ```bash
  docker run -d --name ci-pg -e POSTGRES_DB=blink_test -e POSTGRES_USER=blink -e POSTGRES_HOST_AUTH_METHOD=trust -p 5433:5432 postgres:16-alpine
  ```

- **Build da imagem Docker falha aqui** (proxy TLS no `npm ci`). Valide com
  `npm ci --omit=dev` numa cópia limpa.
- **Playwright:** 1.63.0 na raiz, navegador em `PLAYWRIGHT_BROWSERS_PATH`
  (`/opt/pw-browsers`). Não rode `playwright install` localmente.
- **Bloqueados:** `onrender.com`, `docs.discord.com` e `robojs.dev`. Peça
  print ao Gabriel ou use o raw do GitHub.
- **Escopo do GitHub:** só `STREAMA-AI-MANO`. Adicionar outro repositório
  exige o OK dele (já foi bloqueado uma vez).

---

## 8. Comandos

```bash
npm install && npm ci --prefix server && npm ci --prefix mini-blink
npm test                                                   # unitários + contratos dos docs + bot
DATABASE_URL=postgres://blink@localhost:5433/blink_test npm run test:e2e
```
