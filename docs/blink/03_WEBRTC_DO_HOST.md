# 03 · Captura, áudio e orçamento de upload do host

Este caderno cobre o navegador que transmite e quem assiste via `RTCPeerConnection`. A demanda do Discord entra no cálculo porque consome o **mesmo uplink do host**. O controle de decodificação e de fila do relay está em [04_RELAY_E_ACTIVITY.md](04_RELAY_E_ACTIVITY.md).

**Ponto de partida.** O anexo localiza `QUALITY`, `tuneSender`, `offerTo` e a troca de fonte em `public/app.js`. Registra teto nominal de 12.000 kbps, piso de 500 kbps e perfis de 6.000/4.000/2.500 kbps. Localizar esses símbolos e os senders de áudio no checkout. O alvo deste caderno é manter texto legível e movimento assistível quando entram outras pessoas, sem um pico permanente acima do orçamento.

## Capturar antes de anunciar

| Estado | Ação ou evento | Transição e efeito |
|---|---|---|
| Sem sessão | Pessoa abre Transmitir | Exibir “Entre para transmitir”. Preparar retorno à aba após login. |
| Pronto | Clique em “Escolher tela” | Chamar `getDisplayMedia()` no gesto; disponibilizar o módulo antes do clique. Aguardar seletor. |
| Selecionando | Cancelamento/`NotAllowedError` | Voltar a Pronto. Nenhuma sala, notificação, track pendente ou erro técnico genérico. |
| Selecionando | Vídeo válido e áudio solicitado sem track retornada | Mostrar prévia, “Essa fonte veio sem som”, “Escolher outra fonte” e “Continuar sem som”. |
| Prévia | Confirmação do host | Criar a sala e guardar identificador da tentativa. Anunciar aos amigos após commit do servidor. |
| Ao vivo | Track atual de vídeo emite `ended` | Atualizar estado uma vez, desligar encoder da fonte encerrada e oferecer nova escolha ou encerrar a live. |
| Ao vivo | WS de sinalização cai, peer segue conectado | Mostrar “Reconectando à sala”; manter a captura e as conexões de mídia saudáveis durante a graça. |
| Encerrando | `leave`, expiração ou saída confirmada | Parar somente os tracks pertencentes a este controlador, fechar PCs, timers e listeners; liberar URL/áudio local. |

Antes da escolha: “Para compartilhar som, procure a opção de áudio no seletor. As opções dependem do navegador e da fonte.” Depois, verificar `stream.getAudioTracks().some(t => t.readyState === "live")`. `audio:true`, `systemAudio:"include"` e a presença do microfone não provam que o sistema entregou o som da aba. O microfone tem controle próprio e exige consentimento. Para música/jogo, manter a configuração de captura sem supressão/cancelamento quando suportada. Diferenciar permissão negada, ausência de captura, fonte encerrada e falha do dispositivo. [Captura de tela e gesto de usuário](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia)

## Dividir o orçamento

**Unidades.** `1 kbps = 1.000 bits/s`. Reservar inicialmente 15% para overhead e variação. Usar 96 kbps por track de áudio enviada a cada peer como hipótese de planejamento e configurar ou medir o emissor de áudio. O relay, quando tem demanda, entra **uma vez** com o teto do seu vídeo e do seu áudio ativo. Os limites `setParameters` são alvos superiores por encoding; a rede de fato pode entregar menos. Rever a reserva com as medições de bytes no host.

Algoritmo de referência ES module. `audioPeers` conta os peers que receberão áudio; a quantidade de viewers no Discord só altera se o encoder está ligado. Domínio do Blink neste ciclo: um encoding de vídeo por peer, sem simulcast.

```js
export function allocateUpload({
  linkKbps = 12000, peers, audioPeers = peers, profileKbps,
  relayVideoKbps = 0, relayAudioKbps = 0, audioKbps = 96
}) {
  const inputs = [linkKbps, peers, audioPeers, profileKbps, relayVideoKbps, relayAudioKbps, audioKbps];
  if (!inputs.every(x => Number.isSafeInteger(x) && x >= 0) || audioPeers > peers) {
    throw new RangeError("Parâmetros de banda inválidos");
  }
  const usable = Math.floor(linkKbps * 85 / 100);
  const reserved = relayVideoKbps + relayAudioKbps + audioPeers * audioKbps;
  const remaining = Math.max(0, usable - reserved);
  const videoPerPeer = peers ? Math.min(profileKbps, Math.floor(remaining / peers)) : 0;
  return {
    usable, reserved, videoPerPeer,
    allocated: reserved + peers * videoPerPeer,
    fits: reserved <= usable,
    belowTarget: peers > 0 && videoPerPeer < 500
  };
}

export function measuredKbps(previous, current) {
  if (!previous || !current || previous.id !== current.id) return null;
  const elapsedMs = current.timestamp - previous.timestamp;
  const bytes = current.bytesSent - previous.bytesSent;
  if (!Number.isFinite(elapsedMs) || !Number.isFinite(bytes) ||
      elapsedMs <= 0 || bytes < 0) return null;
  return 8 * bytes / elapsedMs;
}
```

| Cenário com 12.000 kbps de link | Reserva em kbps | Vídeo por peer de navegador |
|---|---:|---:|
| Um peer com som, perfil texto | 96 | 4.000 |
| Cinco peers com som, perfil movimento | 480 | 1.944 |
| Os mesmos cinco com relay de 2.000 + 96 | 2.576 | 1.524 |
| Cinquenta peers com som, relay desligado | 4.800 | 108 |
| Zero peers e relay de 2.000 + 96 | 2.096 | 0 |

O último exemplo com cinquenta peers ilustra por que um piso rígido é incorreto. Garantir apenas 500 kbps de vídeo a 50 conexões já exigiria 25 Mbps. O limite administrativo de uma sala e a qualidade vendável são grandezas diferentes.

Se `fits` for falso, o resultado é um **diagnóstico não aplicável**: reduzir o perfil do relay ou a reserva de áudio configurada, recalcular e só então admitir a nova demanda. Preservar o conjunto já servido até existir um plano viável; se o novo destino for o Discord, enviar a indisponibilidade ao viewer e continuar a live do navegador. `belowTarget` acende um aviso ao host, mesmo quando o orçamento é respeitado. Se o vídeo disponível for zero, pausar o encoding suportado ou a nova admissão; evitar usar bitrate zero como promessa de suspensão.

## Aplicação no sender e troca de fonte

1. Recalcular quando mudar peer admitido, demanda do relay, número de tracks de áudio ou perfil. Agrupar mudanças na mesma volta do event loop e serializar a atualização de cada sender. Uma revisão mais recente substitui a pendente, sem perder o último valor.
2. Obter `sender.getParameters()` imediatamente antes de `setParameters()`. Aplicar `encodings[0].maxBitrate = videoPerPeer * 1000` quando houver um encoding negociado. Se a lista estiver vazia, aguardar envio/negociação e reavaliar. Preservar a ordem, quantidade e demais campos de `encodings`; em caso de suporte parcial, manter a conexão e registrar o motivo agregado. [RTCRtpSender.setParameters](https://developer.mozilla.org/en-US/docs/Web/API/RTCRtpSender/setParameters)
3. Jogo usa `contentHint="motion"` e prioriza fluidez. Texto usa `detail` e prioriza resolução. Câmera usa o perfil próprio. Esses hints não garantem FPS/resolução entregue. Configurar no track e, quando suportado, `degradationPreference` nos parâmetros de envio.
4. Na troca, capturar a nova fonte por gesto e manter a antiga viva. Registrar geração da operação. Executar `replaceTrack` em cada sender de mesmo tipo. Nos peers que exigem renegociação, manter a fonte anterior até o offer/answer daquele peer. Se a nova mídia não for aceitável, reverter peers que trocaram com sucesso ou reanexá-los individualmente à fonte confirmada.
5. Confirmar a troca quando os peers ativos e o encoder do relay apontarem para a nova fonte ou forem marcados como falha recuperável independente. Desregistrar `ended` da antiga antes de pará-la e só liberar um track após o último consumidor. Em troca concorrente, conservar apenas a operação válida e parar o stream descartado. A ausência de sender de áudio pode exigir criar transceiver e renegociar. [RTCRtpSender.replaceTrack](https://developer.mozilla.org/en-US/docs/Web/API/RTCRtpSender/replaceTrack)

## Sinalização e retomada

O host segue como ofertante. Serializar oferta e `restartIce` por peer; uma renegociação em andamento mantém no máximo uma revisão pendente. Enfileirar candidatos ICE recebidos antes da descrição remota da **mesma** negociação, com tamanho e validade limitados. Limpar a fila ao mudar peer ou geração. Atribuir `peerId` da sinalização e nunca depender do nome visível.

`connectionState="disconnected"` pode ser transitório. Esperar uma janela inicial proposta de 3 s; se não recuperar e o signaling estiver pronto, tentar ICE restart com no máximo duas tentativas espaçadas por peer. Em `failed` iniciar a recuperação imediatamente. `closed` encerra os recursos. Ao recuperar o WS, preservar o PC válido e reconstruir só os peers com falha ou perdidos no novo processo. Se o provedor TURN estiver indisponível, oferecer a tentativa STUN e um estado acionável. `/api/ice` entrega credencial temporária somente após validar o acesso; expiração, cache e filtro de URLs continuam no servidor. [Cloudflare TURN](https://developers.cloudflare.com/realtime/turn/generate-credentials/)

## Medição e aceite

A cada 2 s de uma live ativa, colher `getStats()` por conexão. A medida para um relatório `outbound-rtp` usa `ΔbytesSent × 8 / ΔtimestampMs`; em kbps decimais, o resultado já está na unidade correta. Contabilizar áudio e vídeo separadamente. Tratar SSRC/ID trocado, métricas ausentes e relógio repetido como amostras sem valor. No par ICE selecionado, `availableOutgoingBitrate` é opcional. Evitar somar estimativas de capacidade das conexões como se cada peer tivesse um uplink físico diferente. Para classificar TURN, verificar os tipos de candidato do par selecionado, considerando ambos os lados. O provedor é a referência final de faturamento. [Estatísticas W3C](https://www.w3.org/TR/webrtc-stats/)

| Fixture | Invariante de aceite |
|---|---|
| Cinco entradas/saídas seguidas e `demand` alternando 0→1→20→0 | Recalcular uma vez por mudança consolidada. A reserva do relay permanece uma cópia enquanto a demanda for positiva. |
| 50 peers, mudança de `QUALITY`, link artificialmente pequeno | Para `fits=true`, `allocated <= usable`; o sistema sinaliza o alvo baixo. Para `fits=false`, preserva a última configuração viável. |
| Fonte sem áudio; microfone disponível | A interface informa o que veio da fonte e oferece continuar. Nenhuma permissão de microfone é solicitada automaticamente. |
| Fonte antiga encerra após troca, ou uma troca falha em um peer | A live nova segue. Cada track é liberado uma vez. O erro identifica a conexão afetada por um contador agregado. |
| WS fora do ar com PC ainda transmitindo; TURN indisponível | O viewer vê reconexão de controle sem recarregar a página; o estado do transporte distingue tentativa e falha. |
| Medição `1000→126000` bytes em `1000 ms` no mesmo relatório | `1000 kbps`. Reinício do contador ou do ID produz `null`. |

Para rollout, comparar o mesmo perfil com um e cinco viewers, uma vez sem relay e uma vez com relay. Guardar medianas de bitrate entregue e tempo até primeiro quadro. Aumentar o teto deve depender do upload efetivo do host e dos custos em [08_MONETIZACAO_E_ESCALA.md](08_MONETIZACAO_E_ESCALA.md).
