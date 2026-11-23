# 04 · Relay WebSocket e player dentro do Discord

**Questão de implementação.** Um host envia uma codificação ao relay. O relay distribui os mesmos bytes aos espectadores da Activity. Quando chega a configuração de áudio, o vídeo que está decodificando precisa continuar. Quando um viewer fica lento, os demais precisam continuar. As correções abaixo podem ser entregues nessa ordem, antes de mudar a aparência do app.

O guia oficial de rede das Activities documenta WebSocket e a ausência de suporte a WebRTC. O proxy e o SDK tornam a Activity uma superfície distinta do navegador normal. Rodar a entrada distribuída pelo mapeamento configurado, testar `{clientId}.discordsays.com` e usar o SDK para abrir links externos por ação do usuário. [Networking](https://docs.discord.com/developers/activities/development-guides/networking) · [primeira Activity](https://docs.discord.com/developers/activities/building-an-activity)

## Fronteiras do protocolo

| Quem | Mensagem | Efeito obrigatório |
|---|---|---|
| Relay → host | `demand` com quantidade de leitores autorizados | `0→1` inicia o encoder. `1→2` compartilha a mesma produção. `1→0` cancela o pipeline e libera os objetos pertencentes ao relay. |
| Host → relay → viewer | `config` | Guardar snapshot por trilha. Um leitor novo recebe a configuração mais recente e espera um keyframe de vídeo. |
| Relay/viewer → host via relay | `keyframe` | Consolidar a demanda por run; fazer o próximo frame elegível sair como key. |
| Host → relay → viewer | `unsupported` v2 com `{track:"video" ou "audio",reason}` | Áudio indisponível mantém o vídeo e informa “Live sem som”. Vídeo indisponível encerra a espera e mostra “Abrir no navegador”. |
| Host → relay → viewer | Binário v1 | Preservar o cabeçalho de 10 bytes do anexo e os códigos reais do checkout. Cada socket de reader tem estado de sincronização próprio. |

**Compatibilidade.** Capturar fixtures do encoder e parser atuais antes de atribuir qualquer número a tipo ou flag. Cabeçalho v1: byte 0 tipo, byte 1 flags, bytes 2–9 timestamp em microssegundos `float64` big-endian, restante payload. Validar `length > 10`, tipo e flags esperados, timestamp finito dentro da faixa aceita e tamanho máximo do host. O parser usa `byteOffset` e `byteLength` reais de Buffers/typed arrays. O timestamp é relativo à mídia; o áudio e o vídeo usam uma origem compatível. Nunca tratá-lo como milissegundos de relógio de parede.

Versionar **controle** por negociação na abertura. Frames de v1 permanecem interoperáveis. Cliente antigo recebe configurações no formato que conhece. Cliente v2 recebe atualizações parciais: campo ausente conserva a trilha; valor `null` desliga a trilha; objeto substitui a configuração. No servidor, normalizar o formato legado antes de atualizar o snapshot. O viewer v1 também recebe o hotfix local que compara a config de vídeo; o servidor pode sintetizar snapshot completo ao atendê-lo.

## Host e ordem de início

1. Manter uma geração por pipeline. Em `demand>0`, verificar `VideoEncoder` e `isConfigSupported()` para os perfis de vídeo do anexo, em ordem: H.264 baseline Annex B, VP8 e, se disponível, VP9. Testar resolução, framerate e bitrate da configuração real. A Activity avalia `VideoDecoder.isConfigSupported()` independentemente. Se houver um leitor incompatível com o codec servido, oferecer o navegador a ele sem derrubar os demais.
2. Receber os frames no contexto em que `MediaStreamTrackProcessor` realmente existe. A API pode estar exposta em Window ou em Dedicated Worker conforme o navegador. Testar capacidade nos dois lados. Se transferir track ao worker, usar uma cópia pertencente ao relay para preservar o track WebRTC. Verificar também se há caminho para áudio, `AudioEncoder` e Opus. [TrackProcessor](https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrackProcessor) · [WebCodecs](https://www.w3.org/TR/webcodecs/)
3. Enviar config antes do primeiro chunk correspondente. Para AVC, casar o formato efetivamente produzido com a presença/ausência de `description` prevista no registro do codec. Em Annex B, o key chunk deve carregar os parameter sets necessários. Serializar dados binários de configuração em base64 canônico no JSON. [Registro AVC](https://www.w3.org/TR/webcodecs-avc-codec-registration/) · [registro Opus](https://www.w3.org/TR/webcodecs-opus-codec-registration/)
4. Com `encodeQueueSize` acima de um máximo inicial de 3, descartar o frame de entrada **antes** de codificar e fechá-lo em `finally`. Coalescer pedidos de keyframe. Observar também o `bufferedAmount` do WS de upload. Enquanto o upload estiver atrasado, suspender o envio de deltas, retomar em keyframe e nunca ampliar indefinidamente a fila. Pedir key periódico de 2 s como referência do anexo.
5. Na queda da demanda ou troca de geração, cancelar o reader, soltar o lock, fechar frames, encoder e seus tracks clonados. Ignorar saídas e rejeições atrasadas de gerações antigas. `demand` voltando durante teardown inicia um novo pipeline ao terminar o descarte. O stream original continua com o host.

## Viewer e configuração de áudio independente

Separar `videoDecoder`, `audioDecoder`, geração por trilha, configuração confirmada, `waitingForKey` e contadores de erro. Criar uma representação canônica de vídeo **no adaptador** com `codec`, dimensões codificadas, `descriptionB64` e quaisquer campos adicionais realmente usados pelo Blink (por exemplo, color space, se for configurado). Campos extras obrigam atualizar o comparador e seus testes. O exemplo cobre o perfil atual com quatro campos. O `previous` sempre é um snapshot completo normalizado.

```js
function videoSignature(video) {
  if (!video) return null;
  return JSON.stringify([
    video.codec, video.codedWidth, video.codedHeight, video.descriptionB64 ?? ""
  ]);
}

export function mergeConfig(previous, patch) {
  const video = Object.hasOwn(patch, "video") ? patch.video : previous.video;
  const audio = Object.hasOwn(patch, "audio") ? patch.audio : previous.audio;
  return {
    next: { video, audio },
    reconfigureVideo: videoSignature(previous.video) !== videoSignature(video)
  };
}
```

Para cada leitor, usar uma histerese com três limites iniciais: 512 KiB para retomar, 1,5 MiB para descartar vídeo e 8 MiB para fechar. Usar o buffer **projetado** para descarte e fechamento, e a fila **já existente** para decidir se o leitor drenou. Assim um keyframe de 700 KiB consegue ressincronizar um leitor cuja fila voltou a zero. Em espera, consolidar pedidos de keyframe em até um por segundo por run.

```js
export function decidePacket(queued, size, waitingForKey, kind) {
  const low = 512 * 1024;
  const soft = 1536 * 1024;
  const hard = 8 * 1024 * 1024;
  if (![queued, size].every(n => Number.isSafeInteger(n) && n >= 0) ||
      !["audio", "key", "delta"].includes(kind)) throw new RangeError("Pacote inválido");
  const projected = queued + size;
  if (projected >= hard) return { action: "close", waitingForKey: true };
  if (kind === "audio") return { action: "send", waitingForKey };
  if (projected >= soft || (waitingForKey && (kind !== "key" || queued > low))) {
    return { action: "drop", waitingForKey: true };
  }
  return { action: "send", waitingForKey: false };
}
```

Iterar somente nos leitores prontos, sem aguardar um leitor para enviar ao próximo. Erro de `send` ou socket fechado libera aquela vaga. A trilha de áudio atravessa congestionamento moderado; a regra hard cobre inclusive áudio. Ao trocar o host, limpar snapshot e estado do codec antes de reaproveitar espectadores. Limites de memória da instância devem incluir `salas × viewers × buffer`, queues do Node e margem do processo; o teto por socket não substitui o limite global de admissão.

## Recuperação do player

| Sinal | Ação | O que a pessoa vê |
|---|---|---|
| Config de vídeo equivalente, config de áudio nova | Reconfigurar só o áudio comparando codec, canais, sample rate e bytes de descrição. Manter decoder, canvas e relógio do vídeo. | Imagem continua; som começa quando permitido pelo dispositivo. |
| Codec/tamanho de vídeo mudou | Incrementar geração de vídeo, descartar callbacks antigos, configurar e entrar em `waitingForKey`. | Último quadro válido até chegar novo keyframe. |
| Chega delta antes de key ou durante configuração assíncrona | Descartar delta. Guardar no máximo um keyframe compatível da geração atual. Revalidar geração ao resolver `isConfigSupported()`. | Estado “Conectando ao vídeo”. |
| Callback de erro do vídeo | Contar uma falha por geração, descartar decoder fechado, pedir key e tentar de novo. Ao atingir **3 falhas** desde a última janela saudável, parar os resets. | “O vídeo não abriu no Discord” e botão de abrir fora. |
| Primeiro quadro isolado entre erros | Manter contador. Zerar só após 10 s de saída saudável contínua ou escolha explícita de “Tentar de novo”. | Evita um ciclo infinito de reset, quadro, reset. |
| Falha de áudio/autoplay bloqueado | Distinguir erro do decoder de permissão de reprodução. Em autoplay bloqueado, desbloquear `AudioContext` por “Ativar som”. | Vídeo segue, controle de som tem estado textual. |
| Sem config ou primeiro quadro após 8 s de conexão pronta | Mostrar alternativa de abrir fora e tentativa manual; temporizador exclui espera pelo cold start da página. | A pessoa consegue sair do estado de espera. |

Ao renderizar, liberar `VideoFrame.close()` após desenhar, e `AudioData.close()` após copiar/agendar. Limitar fila de reprodução por duração; partir de 200 ms de alvo e descartar áudio atrasado/ressincronizar o relógio quando passar 500 ms, medindo o resultado no aparelho. Para o clique externo, usar convite autorizado obtido ao resolver/renovar a própria sessão, ou solicitar código; a rota de fallback nunca resolve sala apenas pelo canal. Com o contrato HTTP de [02_SALAS_E_ACESSO.md](02_SALAS_E_ACESSO.md), o viewer admitido pode chamar `POST /api/discord/invite-link` por gesto explícito e revalidar a mesma prova. A entrada por código já dispõe de seu convite.

## Gate de homologação

| Fixture | Resultado verificável |
|---|---|
| Config vídeo A, 40 quadros, patch só de áudio, mais 40 quadros A | Uma criação de decoder de vídeo, contagem de quadros cresce nos dois intervalos. |
| Key com 700 KiB chega a fila vazia após um descarte | `decidePacket(0, 716800, true, "key")` envia e sai da espera. |
| Viewer A lento e B saudável; A cruza 8 MiB com áudio | Apenas A fecha; B continua recebendo. A demanda reflete uma saída. |
| Decoder falha três vezes em gerações consecutivas | Fallback fica visível, contador de reinícios para. Após 10 s estáveis a próxima falha inaugura nova sequência. |
| Host sem vídeo WebCodecs; host com vídeo e sem Opus | Primeiro caso oferece navegador; segundo exibe imagem e informa ausência de som. |
| Snapshot A seguido de B e resolução assíncrona de A por último | B continua ativo. Nenhum delta de A é aceito no decoder de B. |
| Host alterna aba, muda fonte, último leitor sai | Validar em Discord desktop real e ao menos um aparelho móvel. Nenhum novo frame codificado após teardown. |

O simulador local prova os estados. Suporte do webview, suspensão em segundo plano e áudio precisam de evidência no cliente Discord testado. Registrar versão e aparelho junto com o resultado.
