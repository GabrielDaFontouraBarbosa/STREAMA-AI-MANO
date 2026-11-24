# 02 · Salas, sinalização e autorização da Activity

O link direto continua sendo um convite para assistir sem conta. O perfil público continua permitindo ao amigo pedir entrada, sob decisão do host. A Activity ganha uma terceira forma de acesso: a pessoa está presente em uma instância do Discord que o bot vinculou àquela transmissão. Essas três decisões devem poder ser testadas separadamente.

**Superfícies de entrada.** Conferir `server/src/app.js`, `signaling.js`, `relay.js`, `auth.js`, `hub.js`, schema/migrations, `mini-blink/`, `public/app.js` e `public/discord/viewer.js`. Contratos com `v2`, novos campos e rotas abaixo são propostos. Preservar o envelope e o caminho v1 encontrados no checkout durante a transição.

## Quem pode fazer o quê

| Operação | Identidade ou prova | Decisão do servidor |
|---|---|---|
| `host-create-room` | Sessão Blink válida no upgrade e revalidada para esta ação sensível | Gerar `runId` no servidor e reservar código. Atribuir `hostId` ao usuário da sessão. |
| `host-resume` | Sessão do proprietário + execução identificada por `runId` e código + prazo em aberto | Reanexar com nova geração. `runId` identifica a transmissão; a autorização vem do usuário e da linha ativa. |
| `viewer-join` via `/s/CODE` | Código recebido em convite explícito | Admitir enquanto a sala aceita ingresso e há vaga. Preservar o uso anônimo e o nome de exibição. |
| `join-request` pelo `/@usuario` | Sessão e amizade aceita, confirmadas no banco | Encaminhar ao host. Pedido expira em 45 s; aceite consome o pedido uma vez. Perfil e rejeição omitem código. |
| `offer`, `answer`, `ice-candidate`, `restart-ice` | Socket admitido, par e execução atuais | Roteamento pelo papel, emissor e destino registrados. Verificar se pertence ao mesmo `runId`; ler a identidade do socket. |
| Publicar no relay | Host confirmado pela sinalização | Emitir ticket `publish` por conexão, com prazo de 30 s. Uma publicação ativa por geração de host. |
| Assistir pelo Discord | Convite digitado **ou** identidade Discord verificada e presente na instância vinculada | Emitir ticket `view` para o run autorizado. `frame_id`, `custom_id` e `channel_id` isolados servem apenas ao contexto de navegação. |
| `GET /api/ice` | Sessão ou código de sala aberta, conforme contrato original | Validar acesso antes de servir até uma resposta já em cache. Segredo do provedor permanece no servidor. |

Definir a contagem como **conexões de visualização admitidas**. A reserva do browser ocorre em um trecho síncrono após autorização e antes de qualquer `await`. Reconnect substitui a conexão anterior da mesma reserva. Limites de origem do anexo são 50 espectadores de navegador e 20 no relay, conferidos por transporte. Emitir contadores separados; somá-los conta conexões e pode incluir a mesma pessoa duas vezes.

## Contratos HTTP e WS propostos

| Entrada | Sucesso | Falhas e cache |
|---|---|---|
| `POST /api/discord/resolve` com `Authorization: Bearer …` e JSON `{instanceId}` | `200 {ticket, expiresIn:30}`. O ticket carrega o vínculo no servidor. | `401` para credencial inválida/expirada, `404` uniforme para associação indisponível, `429` com `Retry-After`, `503` para indisponibilidade transitória do provedor. `no-store`. |
| `POST /api/discord/invite-link` com o mesmo Bearer e `{instanceId}` | `200 {url}` para o convite absoluto do run, após repetir a checagem de `resolve`. Chamado por ação de abrir fora. | Mesmos erros e `no-store` de `resolve`; URL definida pela origem canônica do Blink. |
| `POST /api/relay/tickets` com `{code}` | `200 {ticket, expiresIn:30}` apenas para `view` de uma execução aberta. | Resposta uniforme para convite indisponível, quota separada para reconexão, `no-store`. |
| WS `/relay/view` e `/relay/host` v2 | Primeiro frame de controle `{type:"auth",ticket}`. Após validação, responder `ready` e admitir. | Socket pendente expira em 3 s, tem limite baixo de bytes/pendentes e não recebe mídia, configuração nem demanda. O segredo fica fora da URL. |
| `GET /api/discord/room?channel=…` legado | Novo front usa `resolve`; o bot usa o vínculo interno. | Cortar a resolução pública só por canal no servidor. Resposta genérica orienta entrada manual no cliente antigo; publicar essa correção junto com o cliente compatível. |
| `GET /s/:code` e `/@usuario` | Shell de convite ou perfil. O preview público é genérico. | Abertura do HTML não autoriza publicação nem consome a única vaga do visitante. |

**Resolução da Activity.** `discordSdk.ready()` → `authorize` com `identify` → troca do authorization code no back-end conforme o fluxo do SDK → `authenticate` no SDK → `POST /api/discord/resolve` com o access token em memória. Na troca usar o redirect e as proteções de correlação previstos para essa instalação; o client secret fica no servidor. Para autorizar, consultar `/oauth2/@me` com Bearer e `/applications/{appId}/activity-instances/{instanceId}` com credencial de bot da aplicação. Comparar aplicação, validade, escopo, usuário conectado, vínculo no banco e execução ativa. A checagem do lado do servidor também funciona quando o cliente usa o proxy do Discord; ela dispensa depender de um cookie Blink `SameSite=Lax` dentro do iframe. A API oficial documenta ambas as respostas. [OAuth2](https://docs.discord.com/developers/topics/oauth2#get-current-authorization-information) · [instância](https://docs.discord.com/developers/resources/application#get-application-activity-instance) · [autenticação com bot](https://docs.discord.com/developers/activities/development-guides/multiplayer-experience)

**Regra de domínio em JavaScript.** Os adaptadores entregam objetos já decodificados; `binding` vem exclusivamente do banco. Rodar limite e validação de tamanho antes de chamar o Discord. `nowMs` vem do relógio do servidor. O retorno interno `runId` fica no emissor do ticket.

```js
export function decideActivity({ appId, instanceId, authorization, instance, binding, nowMs }) {
  const expires = Date.parse(authorization?.expires ?? "");
  const userId = authorization?.user?.id;
  if (typeof userId !== "string" || !userId || authorization?.application?.id !== appId ||
      !Array.isArray(authorization.scopes) || !authorization.scopes.includes("identify") ||
      !Number.isFinite(expires) || expires <= nowMs) {
    return { status: 401 };
  }
  if (instance?.application_id !== appId || instance?.instance_id !== instanceId ||
      !Array.isArray(instance.users) || !instance.users.includes(userId) ||
      binding?.instanceId !== instanceId || binding?.appId !== appId ||
      !binding?.runId || binding.accepting !== true) {
    return { status: 404 };
  }
  return { status: 200, runId: binding.runId, userId };
}
```

ID de instância é uma **string opaca**, IDs de usuários e da aplicação são snowflakes tratados como strings. Timeout, 5xx ou rate limit do Discord são tratados pelo adaptador como indisponibilidade, sem transformar falha de serviço em autorização. Se a pessoa acabou de entrar e ainda não consta na lista, permitir uma nova tentativa com atraso curto e respeitar `Retry-After`. Com bot desabilitado ou sem vínculo, disponibilizar “Digitar código”. Se o bot roda isolado e só ele tem credencial, delegar a consulta por canal interno autenticado ou manter apenas essa entrada manual.

## Tickets e limites de confiança

Gerar 32 bytes com `crypto.randomBytes`, codificar base64url, entregar uma vez e manter em `Map` apenas SHA-256 → `{scope, runId, epoch, subject, expiresAt}`. Na entrada, validar formato e tamanho, calcular digest e buscar o registro. Verificar finalidade, validade, estado da live e geração do publicador. Efetuar a verificação final de vaga, remoção do ticket e admissão em um trecho síncrono da mesma instância. Só então iniciar `demand`. Um ticket já usado requer nova emissão. Fazer varredura por validade, limitar emissões e a quantidade pendente; se cheio, devolver `503` com backoff. Um novo deploy elimina os tickets pendentes e os clientes os pedem de novo.

Ao mudar de host na **mesma** transmissão, invalidar `publish` antigo e manter os viewers da mesma execução. Ao encerrar a transmissão, invalidar todos os tickets e conexões desse `runId`. Um novo uso do mesmo código recebe outro `runId`.

| Proteção | Aplicação | Comportamento inicial proposto |
|---|---|---|
| Origem e proxy | Separar site, iframe e chamadas internas do bot. Usar allowlist exata por ambiente e validar `Origin` de sockets de browser antes de aceitar. | Validar a cadeia real de proxy e sobrescrever o header privado vindo do cliente. Se o ingresso confiável não estiver demonstrado, usar endereço do peer conhecido como chave conservadora e medir concentração. [Express](https://expressjs.com/en/guide/behind-proxies.html) |
| Descoberta | `/api/rooms/:code`, pedido de ticket por código e tentativas de `viewer-join` partilham o mesmo limite lógico | Começar com 20 tentativas/min por origem normalizada para descoberta; ajustar com dados de NAT compartilhado. Um bootstrap legítimo pode consumir mais de uma tentativa. Mensagens de mídia e pings ficam fora dessa cota. |
| Reconexão, chat e controle | Reservar uma faixa para peers já admitidos e limitar mensagens de cada socket | Ponto de partida de 6 resumes/min por reserva e 10 mensagens de chat em 5 s por conexão; limitar também conexões pendentes por processo. Aplicar `429` no HTTP e erro de domínio com `retryAfterMs` no WS. |
| Payload | Rotas JSON do app com 32 KiB; WS de sinalização com o limite do anexo; relay com limite binário próprio | Aplicar `maxPayload` por servidor `ws`. Frames de mídia comprimida usam `perMessageDeflate:false`; compilar validadores JSON uma vez. [ws](https://github.com/websockets/ws) |
| Cabeçalhos | Site com `frame-ancestors 'none'`. Na Activity usar ancestrais reais permitidos em cada cliente suportado e retirar XFO conflitante | Montar política pelo documento entregue, inclusive na raiz com `frame_id`. Conferir `connect-src` para WSS, `media-src`/`worker-src` restritos ao necessário, política de microfone/câmera/tela apenas nas superfícies que os usam. Testar primeiro em Report-Only e depois em enforcement. [Helmet](https://helmetjs.github.io/) · [Discord Networking](https://docs.discord.com/developers/activities/development-guides/networking) |

A rota de auth permanece antes de `express.json()`. Limites nativos do Better Auth e verificação de sessão continuam valendo. Ações sensíveis consultam uma sessão atual, fora do cache de cookie quando a versão instalada oferecer `disableCookieCache`; encerrar sockets vinculados após revogação. [Integração Express](https://better-auth.com/docs/integrations/express) · [sessões](https://better-auth.com/docs/concepts/session-management)

## Vida da sala e recuperação

Usar uma linha de `live_streams` por transmissão. Em [06_DADOS_CONTAS_E_BOT.md](06_DADOS_CONTAS_E_BOT.md) estão a migração e a unicidade do código ativo. `host_epoch` é a geração crescente da conexão de host; o relógio do banco governa o prazo persistido. A sala em memória guarda `(runId, hostEpoch, hostSocket, peers)`. A chave de uma assinatura social é o usuário mais a conexão; fechar uma aba preserva as demais.

| Evento | Operação atômica | Efeito depois do commit |
|---|---|---|
| Criar | Inserir execução com proprietário, código aleatório, `host_epoch=1`, prazo `db_now+45s`. Repetir apenas a colisão do índice de código ativo, com orçamento pequeno de tentativas. | Instalar em memória, devolver código/run e anunciar ao hub uma vez. |
| Host conectado | No máximo uma renovação a cada 15 s por live, `UPDATE … WHERE run_id=? AND host_epoch=? AND ended_at IS NULL`. | Renovar a concessão até `db_now+45s`. Sem lives, não há escrita periódica. |
| Queda do WS | Se o socket ainda for o dono, marcar em graça; persistir até `db_now+45s` com o mesmo predicado. | Manter os peers e a mídia P2P existente. Novos ingressos aguardam o host disponível para negociar. |
| Resume | Confirmar dono, prazo, run e epoch sob lock/CAS. No mesmo processo, pedir nova tentativa se outro socket de host ainda estiver ativo. A repetição no mesmo socket devolve o mesmo ACK. | Incrementar epoch, cancelar timer antigo, revalidar o publicador e religar o hub sem um segundo push de “entrou ao vivo”. |
| `leave` ou vencimento | `UPDATE` com run + epoch + `ended_at IS NULL`; no timer exigir prazo vencido. | Só quem alterou a linha encerra recursos e agenda o término do anúncio. Callback atrasado não derruba o novo host. |
| Reinício abrupto | No boot, fechar legados sem prova recuperável e execuções v2 já vencidas; preservar as v2 com concessão válida. | Host autenticado retoma a mesma execução dentro do tempo residual. O viewer refaz a sinalização; após perder o mapa, entra de novo pelo mecanismo de acesso que possuía. |

Exemplo do compare-and-swap no Postgres para o caminho de resume. O serviço resolve o usuário pela sessão, busca a geração atual de forma autoritativa e valida o estado local de host antes da escrita. `room_code` é normalizado como na criação. Zero linhas significa estado alterado, dono diferente ou prazo encerrado; reler antes de escolher a resposta. Renovação por heartbeat exige geração, `ended_at IS NULL` e concessão ainda válida, impedindo ressuscitar uma execução vencida.

```sql
UPDATE live_streams
   SET host_epoch = host_epoch + 1,
       resume_until = now() + interval '45 seconds'
 WHERE run_id = $1 AND host_user_id = $2
   AND upper(room_code) = upper($3)
   AND host_epoch = $4 AND ended_at IS NULL AND resume_until > now()
RETURNING run_id, host_epoch, resume_until;
```

Com morte abrupta, restam os segundos desde a última renovação; um deploy longo pode consumir a janela inteira. Combinar shutdown ordenado com o corte de tráfego e uma única instância ativa para os mapas. O contador de geração protege as escritas atrasadas no banco. Escalar para vários processos exige uma decisão separada sobre propriedade e roteamento de salas. Se o banco ficar indisponível, mídias P2P já estabelecidas podem continuar; congelar novas emissões e recuperações que exigem confirmação durável. Reconciliar a execução após a volta da conexão.

## Como entregar e comprovar

1. Introduzir schema aditivo, suporte duplo de mensagens e testes de sala. Para clientes v1 sem `runId`, só reconhecer resume no mapa original ou com correlação durável inequívoca com o **mesmo** dono; se tiver dúvida após boot, criar outra transmissão com novo convite.
2. Publicar emissão e consumo de ticket no servidor antes de ativar o cliente v2. No leitor v1 com código de convite explícito, manter a mesma política de convite. Restringir o publicador legado a lives legadas já identificadas e ao HMAC associado. Retirar esse caminho ao drenar essas lives. A resolução pública por canal é encerrada no corte coordenado.
3. Verificar na fixture local: convidado anônimo assiste; amigo recusado vê recusa; outro usuário não retoma o host; reconectar duas vezes deixa um publicador; expirar o timer da geração anterior não encerra a nova; ticket usado duas vezes admite só um socket.
4. Simular filas concorrentes no último lugar disponível, restart dentro/depois da concessão e dois vínculos em canais diferentes. O resultado `404` não traz `code`, `runId`, nome de host ou token no corpo/log.
5. Em rollback, manter tabelas/colunas aditivas e a correção de autorização no servidor. Desativar a resolução automática da Activity e oferecer o código explícito até a correção do cliente. Testar a jornada `/@usuario` até o aceite.

O primeiro PR deste caderno está aceito quando os testes acima deixam observável **quem** foi admitido por qual modalidade, usando somente contadores por modalidade e resultado.
