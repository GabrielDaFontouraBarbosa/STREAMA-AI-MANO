# Prompt de trabalho — Mini Blink: a live do Blink DENTRO do Discord

## Missão

Fazer quem está num servidor do Discord assistir à live do Blink **sem sair do
Discord**, com o menor atrito possível (um comando, um clique). O "fallback"
(anúncio com botão que abre o navegador) já existe em `mini-blink/` e continua
valendo: tudo que for construído aqui é uma camada a mais, nunca substitui o
que já funciona.

## Restrição que já está provada (não reabrir)

- As Activities do Discord (Embedded App SDK) **não suportam WebRTC**. Fonte
  oficial: `discord/discord-api-docs`, arquivo
  `developers/activities/development-guides/networking.mdx`: "WebRTC is not
  supported." O vídeo atual do Blink é WebRTC P2P, então ele não roda como
  está dentro de uma Activity.
- O mesmo documento diz que o proxy das Activities suporta **HTTPS e
  WebSocket**. Isso é a brecha.

## O que investigar (dissecar a documentação, não chutar)

Ler a fonte primária no GitHub `discord/discord-api-docs` (o site
docs.discord.com está bloqueado nesta sessão; o raw.githubusercontent.com
funciona). Para cada caminho, responder com citação do doc:

1. **Activities: rede e CSP** (`networking.mdx`, `local-development.mdx`,
   `url-mapping` / `patchUrlMappings`):
   - formato atual do caminho (`/.proxy/...` ou sem prefixo), WebSocket pelo
     mapeamento, limite de tamanho de mensagem/frame, timeouts, se o
     mapeamento raiz `/` pode apontar para o Blink;
   - o que o CSP permite: `blob:`, `MediaSource`, `WebCodecs`, `wasm`,
     workers, `<video>` com `src` blob.
2. **Activities: como abrir e passar contexto**:
   - resposta de interação `LAUNCH_ACTIVITY` (tipo 12), comando de entry
     point, se dá para lançar a partir de um botão de mensagem;
   - quais dados a Activity recebe (`channelId`, `guildId`, `instanceId`,
     `customId`/parâmetros de query) para saber **qual sala** abrir sem o
     usuário digitar o código.
   - suporte em celular (iOS/Android) e no navegador; Activities em canal de
     texto vs. de voz.
3. **Transporte de vídeo sem WebRTC** (o caminho fora da curva):
   - host (navegador) captura a tela → `MediaRecorder` (WebM/fMP4) ou
     `WebCodecs VideoEncoder` (H.264/VP8) → chunks por **WebSocket** para o
     servidor do Blink → servidor retransmite por WebSocket para cada viewer
     dentro da Activity → viewer toca com **MSE** (`MediaSource` /
     `ManagedMediaSource` no iOS) ou **WebCodecs VideoDecoder** desenhando em
     `<canvas>`;
   - keyframes para quem entra no meio (pedir keyframe / reenviar o último
     init segment + GOP), backpressure, descarte de frames atrasados,
     áudio (Opus via WebCodecs `AudioEncoder` ou dentro do WebM);
   - custo: agora o vídeo passa pelo servidor (não é mais P2P) — medir a
     banda por viewer e o limite do plano grátis do host (Render/afins).
4. **Alternativas para comparar** (com prós/contras, sem implementar todas):
   - snapshot: o host manda um frame a cada N segundos e o bot edita a
     mensagem com a imagem (respeitar rate limit de edição);
   - HLS de baixa latência por HTTPS (mais simples de tocar, mais atraso);
   - embeds de vídeo no chat (só provedores na lista do Discord, ex.
     YouTube/Twitch — avaliar restream);
   - o "Go Live" nativo do Discord (só usuário, não bot).
5. **Proibido**: self-bot, automatizar conta de usuário, streaming de vídeo
   por bot em canal de voz por caminhos não oficiais. Viola os Termos do
   Discord e pode banir a conta.

## Como decidir

Escolher o caminho que, nesta ordem: (a) funciona dentro das regras
documentadas; (b) roda em desktop E celular; (c) cabe no plano grátis;
(d) mexe o mínimo no Blink que já funciona. Escrever a decisão com as
citações em `mini-blink/README.md`.

## Como construir

- Fazer um **protótipo mínimo primeiro** que prove o ponto mais arriscado
  (vídeo chegando por WebSocket e tocando num `<video>`/`<canvas>` em
  Chromium, num iframe com CSP parecido com o das Activities), antes de
  plugar no Discord.
- Testar de verdade aqui: Playwright/Chromium headless com um host fake
  (canvas animado como fonte de vídeo) → servidor → viewer, medindo atraso e
  banda. Sem conta do Discord, o que depender dela fica marcado como "não
  testado" com o motivo.
- Mudanças no Blink só por trás de uma flag/rota nova; nada do fluxo WebRTC
  atual muda.
- Ao final: o que funciona (com prova), o que não foi testado e por quê, e o
  passo a passo no Discord Developer Portal (criar app, ativar Activities,
  URL mappings, entry point, convidar o bot).
