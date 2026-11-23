# 07 · Testes, telemetria e entrega das mudanças

A arquitetura enviada registra testes automatizados no `mini-blink` e roteiros Playwright fora do repositório. O primeiro PR deve produzir um teste que falhe quando o vídeo congela após a chegada da configuração de áudio. A seguir, fechar a cobertura dos fluxos que dão acesso à live e das operações que atravessam um restart. Os caminhos e scripts são propostas para adaptar ao layout de pacotes encontrado.

## Estratégia de testes

| Camada | Tecnologia e dados | Evidência de aprovação |
|---|---|---|
| Regras puras | `node:test`, relógio injetado, mesmos exemplos dos cadernos. | Transições, valores de orçamento e funções de acesso reproduzíveis sem rede nem sleep. |
| HTTP e sinalização | Servidor real em porta efêmera, cliente `ws`, cookie de sessão válido obtido do login local; Postgres de teste. | Ordem do parser preservada. Usuário convidado, host e amigo têm poderes distintos. |
| Persistência | Mesmo major Postgres da imagem de desenvolvimento, schema novo e fixture da versão imediatamente anterior. | Migrations aplicam no vazio e no legado; colisões e leases usam duas conexões reais. |
| Navegador principal | Playwright com um `BrowserContext` por pessoa, fake media determinística, site e WS locais reais. | Host e viewer discordam apenas nos controles esperados; o vídeo **avança** e a saída encerra tracks. |
| Activity | Adapter SDK controlado em CI, fixtures de OAuth/instância e bytes do código real. Discord desktop e um dispositivo móvel em homologação. | CI cobre admissão/decoder/fallback; a passagem pelo proxy, o áudio e a abertura externa têm registro no cliente real. |
| Cobrança | Payloads assinados com segredo exclusivo de teste e adapter de provedor local; homologação posterior em ambiente de teste do processador. | Duplicação de evento, ordem invertida e cancelamento preservam o acesso pago e o saldo correto. |

Evitar testes baseados só em texto “Ao vivo”. Um contador de quadros pode crescer com uma cena congelada por erro de desenho. Usar uma fonte sintética que alterne padrões e verificar **tempo de mídia e mudança de pixels** em Chromium. Para o relay que desenha em canvas, validar duas amostras diferentes em uma sequência conhecida e a identidade do decoder. Para áudio, usar tom sintético e energia RMS na faixa esperada; ausência de track e autoplay bloqueado são casos separados. [Isolamento de contexto](https://playwright.dev/docs/browser-contexts) · [Playwright webServer](https://playwright.dev/docs/test-webserver)

## Quatro fixtures que valem manter

1. **Host e viewer reais.** Dois contextos independentes, sala efêmera e browser em localhost. Via `addInitScript` somente no contexto de teste, substituir a captura de tela por stream produzido com `canvas.captureStream(10)`; alternar duas cores e incrementar um contador desenhado. Para a variante com áudio, criar oscilador de 440 Hz e `createMediaStreamDestination()`, começar/resumir o contexto no gesto de iniciar. Fechar timer, tracks e `AudioContext` no final. A sinalização, os peers e o renderer seguem pelo código do produto.
2. **Decoder v1/v2.** Usar fixtures pequenas derivadas de uma fonte sintética e da serialização real do Blink: configuração inicial, key, vários deltas, patch só de áudio e novo key. Spy no factory de decoder: exatamente uma configuração de vídeo até uma alteração semântica. Em navegador sem codec suportado, executar o teste de fallback; o teste de imagem real deve rodar em pelo menos um projeto de CI com capacidade confirmada e informar qual codec usou.
3. **Relógio da sala.** Injetar `clock.now()` e agendador na lógica de domínio. Verificar host voltando em 44.999 ms e expiração em 45.000 ms; usar a convenção única `now < deadline`. Para integração com `now()` do banco, semear linha com prazo passado/futuro relativo ao relógio do Postgres. Provocar queda ordenada e abrupta do processo do **ambiente de teste** e abrir outro sobre o mesmo banco, com o anterior encerrado.
4. **Bot e checkout.** Implementar adapters de teste que registram status e identificadores sintéticos. Simular resposta recebida antes/depois do commit local, entrega duplicada e resultado externo ambíguo. Asserções verificam linhas e efeitos observados, inclusive a ausência de criação de uma segunda mensagem.

Exemplo de verificação de vídeo para o caminho do `<video>` no browser. Os valores de `data-testid` são contrato proposto para o PR. A fixture usa stream local sem restrições de leitura do canvas. No fallback de autoplay, acionar o controle do produto antes da asserção.

```js
async function samplePlayer(page) {
  return page.getByTestId("viewer-video").evaluate(video => {
    if (video.readyState < 2 || !video.videoWidth) return null;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, 1, 1);
    const [red, , blue] = ctx.getImageData(0, 0, 1, 1).data;
    return { time: video.currentTime, tone: red >= blue ? "red" : "blue" };
  });
}

// No teste Playwright, com host transmitindo blocos vermelhos e azuis.
async function expectMovingPicture(page, expect) {
  await expect.poll(async () => Boolean(await samplePlayer(page))).toBe(true);
  const start = await samplePlayer(page);
  await expect.poll(async () => {
    const now = await samplePlayer(page);
    return Boolean(now && start && now.time > start.time && now.tone !== start.tone);
  }, { timeout: 8000, intervals: [100, 170, 260] }).toBe(true);
}
```

## Casos de regressão prioritários

| ID | Ação na fixture | Oráculo observável |
|---|---|---|
| T01 | Abrir `/s/CODE` sem conta e `/@usuario` como não amigo | Convite direto funciona, perfil respeita o fluxo de aprovação. |
| T02 | OAuth termina com sala/perfil presentes na intenção | Volta ao destino correto, sem query vazia nem token nos logs. |
| T03 | Patch só de áudio e três falhas seguidas de vídeo | Identidade do decoder preservada no primeiro caso; fallback definitivo no segundo. |
| T04 | Viewer lento seguido de outro saudável | Somente o lento perde deltas e volta com key; hard limit fecha apenas seu socket. |
| T05 | Renovar, executar timer antigo e reiniciar o servidor | Um único run/host atual, único push, prazo respeitado. |
| T06 | Duas solicitações legítimas para a última vaga e ticket consumido outra vez | Uma entrada contabilizada. `demand` reflete conexões autorizadas. |
| T07 | Dois cadastros de mesmo nome, edição concorrente, reset e exclusão | Usuários distintos, uma edição vencedora, sessões e links invalidados na forma definida. |
| T08 | Reinício do bot em `sending`, duas leituras “fechada” e erro transitório entre elas | Recuperação não duplica publicação e exige duas confirmações consecutivas. |
| T09 | Deploy N→N+1 com uma aba transmitindo e outra parada | Mídia e lazy chunk da aba antiga continuam; nova versão converge ao fim. |
| T10 | 320/390 px, teclado, reduced motion e zoom | CTA acessível, foco retorna, mensagens têm nome acessível e o player continua montado. |
| T11 | `viewerHours=1000`, `discordHours=250`, premissas beta do 08 | Reserva `712,604375` BRL antes do arredondamento; duplicata de webhook não amplia benefício. |
| T12 | Cliente de controle v1 + server dual + viewer Activity novo | Fluxos de convite antigos funcionam na janela de transição; acesso automático por canal já desativado. |

## Pipeline por PR

1. Descobrir versão do Node na imagem/`engines` e instalar do lockfile correspondente em cada workspace. Provar checkout limpo com o mesmo comando que a produção usa. Preservar `npm test` do bot, se confirmado, e o job existente do repositório.
2. Job rápido: testes unitários + build dos estáticos + verificação de manifesto, URLs de workers e referências dos dois HTMLs. Scripts a propor: `test:unit`, `build:web`. Se já existirem equivalentes, reutilizá-los.
3. Integração: Postgres como service container no runner Linux, banco/usuário/senha exclusivos do job, health check `pg_isready`, migrations pelo caminho de boot real, seeds sem dados pessoais. Executar `test:integration`; reiniciar o app sobre o mesmo banco no cenário persistente. Em Docker Compose exigir senha com interpolação `${POSTGRES_PASSWORD:?defina POSTGRES_PASSWORD no .env}`. [Postgres em Actions](https://docs.github.com/en/actions/tutorials/use-containerized-services/create-postgresql-service-containers) · [interpolação Compose](https://docs.docker.com/reference/compose-file/interpolation/)
4. E2E: browsers instalados da versão travada do Playwright. Rodar smoke em Chromium para vídeo real e em WebKit/Firefox para entrada, conta, teclado e fallback. `webServer` espera endpoint local de prontidão. Isolar fixtures por teste e limitar workers conforme banco/CPU. Job bloqueia se a cobertura real de vídeo obrigatória foi pulada.
5. Em falha, guardar resumo, logs sintéticos redigidos e trace Playwright de retry apenas em ambiente de teste. Fixar retenção curta, por exemplo 7 dias. Evitar gravar telas ou mídia de usuários. Declarar `retries` explicitamente; um teste que só passa na repetição gera uma ocorrência de flakiness a corrigir. [Playwright tracing](https://playwright.dev/docs/test-use-options) · [acessibilidade](https://playwright.dev/docs/accessibility-testing)
6. Homologação manual em Discord desktop + cliente móvel escolhido, Safari/iOS real quando disponível, permissões do seletor e som do sistema. Guardar versão, plataforma, cenário, data e resultado. Marcar “não testado” para aparelho indisponível.

## Métricas, saúde e logs

| Sinal proposto | Tipo e labels permitidas | Pergunta respondida |
|---|---|---|
| `blink_join_total{surface,outcome}` e `blink_first_frame_seconds{surface}` | Contador e histograma. `surface=web,activity`; resultados enum. | Onde se perde a audiência? Medir o tempo depois do clique aceito, separar amostras de sucesso e taxa de timeout. |
| `blink_relay_viewers`, `blink_relay_egress_bytes_total`, `blink_relay_drops_total{cause}` | Gauge e contadores do processo; causas fechadas como `backpressure`, `await_key`. | Há congestionamento isolado, saturação global ou crescimento de custo? |
| `blink_resume_total{role,outcome}` e `blink_bot_reconcile_total{cause}` | Contadores com poucos valores. | Um deploy derrubou a recuperação? Há publicação de resultado incerto? |
| `blink_db_operation_seconds{operation}` | Histograma por consulta lógica enumerada, sem SQL bruto. | O tempo alto vem de sessão, `/api/me` ou fila do bot? |
| `blink_billing_events_total{result}` e agregados por período no banco | Contadores do worker + ledger durável do caderno 08. | A entrega de benefícios acompanha o pagamento? Métricas em memória reiniciam com o processo. |

Relatórios do browser sobre primeiro frame e tipo ICE são opt-in de instrumentação do produto, limitados, agregados e sem código de sala, IP, SDP, nomes, endpoints de push ou IDs de conta. Usar tempos relativos no mesmo relógio. Fixar enumerações no servidor antes de aceitar labels. Registrar log estruturado por whitelist: `requestId` gerado, nome estático da rota, evento, duração, resultado e versão do protocolo. Aplicar `redact` como segunda camada; uma URL crua já contém segredos mesmo se o campo `token` foi ocultado. Publicar métricas apenas a coletor autorizado. [Pino](https://github.com/pinojs/pino/blob/main/docs/redaction.md) · [prom-client](https://github.com/prometheus/client_js)

`/version` testa processo e build sem tocar o banco. `/api/health` já consulta o banco segundo o anexo; usar timeout e estado de prontidão para fluxos que dependem dele. Evitar barra pública de status que consulta o banco por aba. Em `SIGTERM`, marcar draining, recusar novas admissões com retry orientado, parar de alugar jobs, sinalizar reconnect, persistir prazos e fechar sockets/pool após uma janela limitada. O processo novo preserva as leases válidas. [WebSocket no Render](https://render.com/docs/websocket) · [Neon scale-to-zero](https://neon.com/docs/introduction/scale-to-zero)

## Critérios de promoção e rollback

- **Critérios propostos.** Em rede de teste declarada e com serviço aquecido, pelo menos 30 joins por superfície, sucesso ≥ 95% e p95 até primeiro quadro ≤ 3 s no browser e ≤ 5 s na Activity. Analisar cold start em série separada. Esses limites servem para homologação; definir SLO de produção só depois de conhecer o tráfego.
- **Contenção.** Medir RSS, atraso do event loop, número de salas, buffers dos viewers e taxa de descarte ao longo de 15 minutos com o pico presumido do cenário comercial. Uma sala com 20 viewers a 2 Mbps pede perto de 40 Mbps de saída só de vídeo. Usar fonte sintética controlada e realizar o ensaio em ambiente do projeto.
- **Ordem.** Adicionar schema, publicar servidor compatível, ativar clientes por superfície, observar regressões e só então retirar o legado drenado. O rollback de UI mantém autorização no servidor e preserva o banco aditivo. Voltar para um binário que fecha todas as lives no boot exige drenar as novas transmissões antes.
- **Recibo de cada PR.** Registrar caminhos reais, dependências e lockfile tocados, comandos executados, resultados, falhas pendentes, flags de ativação e procedimento de reversão. Comparar com a fila em [MELHORIAS.md](MELHORIAS.md).


## Autoteste reproduzível dos exemplos

Os 30 testes abaixo importam os blocos JavaScript escritos nos cadernos 02, 03, 04, 05, 06 e 08. Foram executados em Node 24.22.3 durante a revisão. Eles verificam as funções de referência e as contas do orçamento; a suíte de integração do Blink exige o checkout. Para repetir, salve o bloco a seguir temporariamente como `contratos.test.mjs` na pasta dos dez Markdown e, a partir dessa pasta, execute `node --test contratos.test.mjs`. Os módulos usam apenas a biblioteca padrão do Node.

<!-- inicio-autoteste -->
```js
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

const dir = process.env.BLINK_DOCS || process.cwd();
async function rules(file) {
  const md = await readFile(resolve(dir, file), "utf8");
  const blocks = [...md.matchAll(/^```js\n([\s\S]*?)^```/gm)]
    .map(match => match[1]).filter(code => code.includes("export function "));
  assert.ok(blocks.length > 0, file);
  const source = Buffer.from(blocks.join("\n")).toString("base64");
  return import("data:text/javascript;base64," + source);
}
const { decideActivity } = await rules("02_SALAS_E_ACESSO.md");
const { allocateUpload, measuredKbps } = await rules("03_WEBRTC_DO_HOST.md");
const { mergeConfig, decidePacket } = await rules("04_RELAY_E_ACTIVITY.md");
const { firstScreen, cleanOAuthReturn } = await rules("05_FRONTEND_E_PWA.md");
const { observeAnnouncement } = await rules("06_DADOS_CONTAS_E_BOT.md");
const { estimateMonth, webTier } = await rules("08_MONETIZACAO_E_ESCALA.md");
const nearly = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7);

const access = {
  appId: "a", instanceId: "i", nowMs: 1000,
  authorization: { application: {id:"a"}, user: {id:"u"}, scopes:["identify"], expires:new Date(2000).toISOString() },
  instance: { application_id:"a", instance_id:"i", users:["u"] },
  binding: { appId:"a", instanceId:"i", runId:"r", accepting:true }
};
test("Activity vinculada e presente recebe decisão de ingresso", () =>
  assert.deepEqual(decideActivity(access), {status:200, runId:"r", userId:"u"}));
test("expiração na fronteira rejeita o token", () =>
  assert.equal(decideActivity({...access, nowMs:2000}).status, 401));
test("participante ausente recebe resposta uniforme", () =>
  assert.deepEqual(decideActivity({...access, instance:{...access.instance, users:[]}}), {status:404}));
test("vínculo fechado e vínculo ausente omitem metadados", () => {
  for (const binding of [null, {...access.binding, accepting:false}]) {
    assert.deepEqual(decideActivity({...access, binding}), {status:404});
  }
});
test("escopo e aplicação devem corresponder à credencial", () => {
  for (const patch of [{scopes:[]}, {application:{id:"b"}}]) {
    assert.equal(decideActivity({...access, authorization:{...access.authorization,...patch}}).status,401);
  }
});

const media = { peers:5, profileKbps:6000 };
test("cinco peers dividem 1.944 kbps por vídeo", () => assert.equal(allocateUpload(media).videoPerPeer,1944));
test("uma codificação de relay reduz a cota para 1.524", () =>
  assert.equal(allocateUpload({...media,relayVideoKbps:2000,relayAudioKbps:96}).videoPerPeer,1524));
test("somente relay continua reservando uma saída do host", () =>
  assert.equal(allocateUpload({...media,peers:0,relayVideoKbps:2000,relayAudioKbps:96}).allocated,2096));
test("admissão inviável é distinguida de bitrate baixo", () => {
  assert.equal(allocateUpload({...media,linkKbps:100}).fits,false);
  assert.equal(allocateUpload({...media,peers:50}).videoPerPeer,108);
});
test("todo orçamento viável cabe no uplink útil", () => {
  for (let peers = 0; peers <= 50; peers++) {
    for (const linkKbps of [0,800,3500,12000,30000]) {
      const plan = allocateUpload({...media,peers,linkKbps});
      if (plan.fits) assert.ok(plan.allocated <= plan.usable);
    }
  }
});
test("estatística usa bytes e milissegundos e descarta reinícios", () => {
  const old = {id:"x",timestamp:100,bytesSent:1000};
  const next = {id:"x",timestamp:1100,bytesSent:126000};
  assert.equal(measuredKbps(old,next),1000);
  for (const patch of [{id:"y"},{timestamp:100},{bytesSent:0}]) {
    assert.equal(measuredKbps(old,{...next,...patch}),null);
  }
});

const v = {codec:"vp8",codedWidth:1280,codedHeight:720};
test("patch de áudio conserva a configuração e a referência de vídeo", () => {
  const decision = mergeConfig({video:v,audio:null},{audio:{codec:"opus"}});
  assert.equal(decision.reconfigureVideo,false);
  assert.equal(decision.next.video,v);
});
test("mesmos campos em outra ordem mantêm decoder", () =>
  assert.equal(mergeConfig({video:v},{video:{codedHeight:720,codec:"vp8",codedWidth:1280}}).reconfigureVideo,false));
test("trocar dimensões ou descrição e desligar vídeo são mudanças", () => {
  for (const next of [{...v,codedWidth:640},{...v,descriptionB64:"AQ=="},null]) {
    assert.equal(mergeConfig({video:v},{video:next}).reconfigureVideo,true);
  }
});
test("soft limit suspende deltas e hard limit fecha até áudio", () => {
  assert.equal(decidePacket(1536*1024-1,1,false,"delta").action,"drop");
  assert.equal(decidePacket(8*1024*1024-1,1,false,"audio").action,"close");
});
test("key grande em fila drenada recupera um leitor", () =>
  assert.deepEqual(decidePacket(0,700*1024,true,"key"),{action:"send",waitingForKey:false}));
test("delta posterior ao descarte aguarda key, e áudio continua", () => {
  assert.equal(decidePacket(0,100,true,"delta").action,"drop");
  assert.equal(decidePacket(700*1024,100,true,"key").action,"drop");
  assert.deepEqual(decidePacket(700*1024,100,true,"audio"),{action:"send",waitingForKey:true});
});

test("convite tem precedência sobre sessão carregando", () =>
  assert.deepEqual(firstScreen("/s/ab12cd","loading"),{screen:"invite",code:"AB12CD"}));
test("raiz da Activity tem precedência sobre convite", () =>
  assert.equal(firstScreen("/?frame_id=x&sala=AB12CD","anonymous").screen,"activity"));
test("perfil e dashboard têm estados distintos", () => {
  assert.deepEqual(firstScreen("/@Ino","authenticated"),{screen:"profile",username:"ino"});
  assert.equal(firstScreen("/","authenticated").screen,"dashboard");
  assert.equal(firstScreen("/","loading").screen,"pending");
});
test("OAuth preserva convite, hash e remove interrogação vazia", () => {
  const origin="https://blink.example";
  assert.equal(cleanOAuthReturn("/?sala=AB12CD&code=q#host",["code","sala"],origin),"/?sala=AB12CD#host");
  assert.equal(cleanOAuthReturn("/?code=q",["code"],origin),"/");
  assert.equal(cleanOAuthReturn("https://other.example/",[],origin),"/");
});

test("o bot requer duas observações fechadas consecutivas", () => {
  const one=observeAnnouncement(0,"closed",false);
  const unknown=observeAnnouncement(one.streak,"unknown",false);
  assert.equal(unknown.streak,0);
  assert.equal(observeAnnouncement(unknown.streak,"closed",false).action,"poll");
  assert.equal(observeAnnouncement(one.streak,"closed",false).action,"end");
});
test("expiração absoluta encerra o anúncio mesmo sem amostra", () =>
  assert.equal(observeAnnouncement(0,"unknown",true).action,"end"));

const pilot={viewerHours:100,discordHours:10,turnFraction:.2,workspaceUSD:0,computeUSD:7,neonUSD:0,emailUSD:0,renderExtraGB:3,renderAllowanceGB:5};
const beta={viewerHours:1000,discordHours:250,turnFraction:.2,workspaceUSD:25,computeUSD:25,neonUSD:15.54,emailUSD:0,renderExtraGB:10,renderAllowanceGB:25};
const growth={viewerHours:5000,discordHours:1500,turnFraction:.35,workspaceUSD:25,computeUSD:85,neonUSD:36.2,emailUSD:20,renderExtraGB:30,renderAllowanceGB:25};
test("piloto aplica franquia e conversão na ordem certa", () => nearly(estimateMonth(pilot).budget,66.761925));
test("beta reproduz a tabela financeira e sensibilidade", () => {
  const x=estimateMonth(beta);
  nearly(x.renderGB,269.38); nearly(x.turnGB,155.628); nearly(x.budget,712.604375);
  nearly(estimateMonth({...beta,fx:5}).budget,648.73125);
});
test("crescimento usa somente o excedente da franquia TURN", () => {
  const x=estimateMonth(growth); nearly(x.turnOverage,13.5481); nearly(x.budget,2855.8381875);
});
test("franquias compartilhadas esgotadas e entradas inválidas", () => {
  assert.ok(estimateMonth({...beta,cfAllowanceGB:0}).turnOverage>0);
  assert.throws(()=>estimateMonth({...pilot,discordHours:101}),RangeError);
  assert.throws(()=>allocateUpload({...media,audioPeers:6}),RangeError);
});

test("assinatura mantém direito até o fim exclusivo do período pago", () => {
  const paid={linked:true,suspended:false,paidThroughMs:1000};
  assert.equal(webTier(paid,999),"plus");
  assert.equal(webTier(paid,1000),"free");
});
test("revisão que suspende benefício prevalece sobre período pago", () =>
  assert.equal(webTier({linked:true,suspended:true,paidThroughMs:1000},999),"free"));
test("fatura sem vínculo ou pagamento confirmado não concede Plus", () => {
  assert.equal(webTier({linked:false,suspended:false,paidThroughMs:1000},900),"free");
  assert.equal(webTier({linked:true,suspended:false,paidThroughMs:null},900),"free");
});
```
<!-- fim-autoteste -->
