# 06 · Contas, histórico de lives e anúncios duráveis

O Blink já guarda usuários, sessões, vínculos Discord, amizades, lives e inscrições push no Postgres. O bot guarda anúncios em `mini-blink/data/lives.json`. O objetivo é fazer a identidade do usuário, a identidade de uma transmissão e a identidade de um anúncio sobreviverem às operações que pertencem a cada uma delas.

**Onde começar.** Examinar `server/src/db/`, `server/drizzle/`, `server/src/auth.js`, `closeDanglingStreams()`, `server/src/minibot.js`, `mini-blink/` e os dois caminhos que chamam `publish()`. Os tipos e nomes físicos das colunas de `user` e `live_streams` vêm das migrations existentes. Os trechos SQL são o contrato proposto para Postgres, a adaptar aos nomes constatados.

## Migração da transmissão

Usar a própria linha de histórico como raiz. `run_id` identifica uma transmissão de maneira estável, `room_code` é reutilizável depois de encerrada, `host_user_id` referencia a pessoa dona da sala, `ended_at` registra término e `host_epoch` separa conexões sucessivas. Reaproveitar as colunas equivalentes existentes. Linhas legadas podem ter `run_id` nulo até serem conciliadas; as escritas v2 sempre atribuem um UUID gerado no servidor.

```sql
-- Delta lógico. Aplicar apenas colunas que o schema real não possui.
ALTER TABLE live_streams ADD COLUMN run_id uuid;
ALTER TABLE live_streams ADD COLUMN host_epoch bigint NOT NULL DEFAULT 1;
ALTER TABLE live_streams ADD COLUMN resume_until timestamptz;
ALTER TABLE live_streams ADD CONSTRAINT live_streams_run_unique UNIQUE (run_id);

-- Pré-requisito desta expressão: o nome físico room_code existe,
-- ended_at representa fechamento e a escrita usa a mesma normalização.
CREATE UNIQUE INDEX live_streams_active_code
  ON live_streams (upper(room_code))
  WHERE ended_at IS NULL AND run_id IS NOT NULL;
```

1. Antes de ativar v2, inventariar colisões de código, normalizar o formato e fechar ou drenar lives legadas conflitantes; impedir também colisão com o mapa de lives legadas ainda abertas. Índice único protege os novos inserts concorrentes. Se a tabela for grande, considerar criação do índice `CONCURRENTLY` em operação fora da transação do migrador; registrar essa escolha no PR.
2. Persistir prazos e renovações somente enquanto existe live. Falhas de gravação entram na regra de recuperação do [caderno 02](02_SALAS_E_ACESSO.md). Mudar `closeDanglingStreams()` antes de liberar a criação v2; o boot legado que fecha todas as linhas não é um rollback compatível depois de haver lives v2.
3. Escritas de encerramento usam `WHERE run_id=$1 AND host_epoch=$2 AND ended_at IS NULL`; timers exigem também `resume_until <= now()`. Uma linha afetada vence. Atualizar o histórico e agendar término de anúncios na mesma transação.
4. No boot ou ao tentar reservar um código já expirado, fechar a linha vencida com o mesmo predicado antes da nova reserva. O convite reutilizado tem outro `run_id`; instâncias Discord ligadas à anterior nunca apontam para a nova.

## Anúncios e instâncias

Uma live pode ser anunciada em vários canais. Duas entradas de publicação para o mesmo par **live + canal** compartilham uma intenção. Snowflakes de canal e mensagem ficam em `text`; o ID da instância é opaco. Exemplo de schema sem extensão de UUID: a aplicação fornece `id` e `lease_token`.

```sql
CREATE TABLE discord_lives (
  id uuid PRIMARY KEY,
  run_id uuid REFERENCES live_streams(run_id) ON DELETE SET NULL,
  channel_id text NOT NULL,
  message_id text,
  state text NOT NULL CHECK (state IN
    ('queued','sending','live','ending','ended','needs_reconcile')),
  nonce varchar(25) NOT NULL UNIQUE,
  close_streak smallint NOT NULL DEFAULT 0 CHECK (close_streak BETWEEN 0 AND 2),
  first_send_at timestamptz,
  next_check_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  lease_until timestamptz,
  expires_at timestamptz NOT NULL,
  UNIQUE (run_id, channel_id)
);
CREATE INDEX discord_lives_due ON discord_lives (next_check_at, id)
  WHERE state IN ('queued','sending','live','ending');
CREATE TABLE discord_activity_links (
  app_id text NOT NULL,
  instance_id text NOT NULL,
  announcement_id uuid NOT NULL REFERENCES discord_lives(id) ON DELETE CASCADE,
  PRIMARY KEY (app_id, instance_id)
);
```

`run_id` nulo em um anúncio preserva só os dados necessários para fechar mensagem órfã. O resolvedor exige `run_id` existente, associação ativa e live aberta. A gravação de `discord_activity_links` vem da resposta autenticada do bot ao launch; repetição idêntica é idempotente, tentativa de remapear a mesma instância ativa para outra transmissão exige desligamento explícito do vínculo anterior. O bot independente pode usar repositório Postgres configurado ou API interna autenticada; as duas modalidades devem chamar a mesma lógica de persistência. Uma única rotina por anúncio edita a mensagem externa.

## Publicação e recuperação de falha parcial

1. `publish()` recebe `run_id` da execução confirmada. `INSERT … ON CONFLICT(run_id,channel_id) DO NOTHING`, seguido da consulta da intenção já existente. A constraint `nonce` tem tratamento separado de colisão. Gerar `nonce` com 12 bytes aleatórios em hex, manter estável nas retentativas daquela intenção.
2. Worker reivindica uma tarefa com lease curto sob lock, faz commit e só depois acessa a rede. Não manter conexão/lock do Postgres durante uma chamada ao Discord. Cada confirmação compara `id` e `lease_token`; o worker que perdeu a posse descarta o resultado atrasado ou o leva à reconciliação.
3. Antes do primeiro envio, passar de `queued` para `sending`, gravar `first_send_at` e a nonce no banco. Enviar `Create Message` com `nonce` e `enforce_nonce:true` se a versão do cliente expuser ambos; adaptar o formato camelCase do SDK ou usar o cliente REST já existente. Ao receber `message_id`, passar para `live`. A deduplicação remota da nonce cobre apenas os últimos minutos. [Discord Create Message](https://docs.discord.com/developers/resources/message#create-message)
4. Se houver timeout, queda entre envio e commit ou `sending` abandonado, o resultado externo é incerto. Marcar `needs_reconcile`; se houver recibo verificável, vincular o ID e continuar o acompanhamento. Na falta de recibo, disponibilizar ação operacional de associação ou encerramento, sem disparar outro anúncio automaticamente. Retentar sozinho apenas falha inequivocamente anterior ao envio ou resposta explícita de rate limit, respeitando `Retry-After`.
5. `ending` edita pelo `message_id` conhecido para mostrar encerramento e remover controles. Repetição aplica o mesmo conteúdo final. `404` de mensagem já removida conclui, `403` vai para reconciliação e falhas transitórias voltam com backoff. A linha `ended` desliga todos os vínculos ativos na leitura.

Consulta parametrizada de reivindicação. A tarefa que sair em `sending` segue **recuperação** e não a rotina do primeiro envio. Ao concluir, limpar lease e agendar o próximo instante na mesma escrita condicional.

```sql
WITH candidate AS (
  SELECT id
    FROM discord_lives
   WHERE state IN ('queued','sending','live','ending')
     AND next_check_at <= now()
     AND (lease_until IS NULL OR lease_until <= now())
   ORDER BY next_check_at, id
   LIMIT 1 FOR UPDATE SKIP LOCKED
)
UPDATE discord_lives AS d
   SET lease_token = $1, lease_until = now() + interval '30 seconds'
  FROM candidate
 WHERE d.id = candidate.id
RETURNING d.*;
```

O acompanhamento legado consulta a cada 20 s e encerra após duas confirmações seguidas de fechamento ou 12 h. Reconhecer o **run** com status interno/correlação persistida; consultar só o código pode confundir uma retransmissão. Separar “fechada” de “consulta indisponível”. Exemplo da regra pura:

```js
export function observeAnnouncement(previousStreak, observation, expired) {
  if (!["open", "closed", "unknown"].includes(observation) ||
      !Number.isInteger(previousStreak) || previousStreak < 0 || previousStreak > 2) {
    throw new RangeError("Observação inválida");
  }
  const streak = observation === "closed" ? Math.min(2, previousStreak + 1) : 0;
  return { streak, action: expired || streak === 2 ? "end" : "poll" };
}
```

Quando o processo tem fila vazia, suspender a varredura frequente no banco; despertar no enqueue ou usar consulta espaçada para detectar trabalho externo no modo standalone. `SKIP LOCKED` aqui é apropriado porque são itens de fila e uma tarefa ocupada pode ficar para outro consumidor. [Postgres SELECT](https://www.postgresql.org/docs/current/sql-select.html) · [transações Drizzle](https://orm.drizzle.team/docs/transactions)

## Contas, `@usuario` e e-mail

**Colisão no nome automático.** O hook `databaseHooks.user.create.before` pode sugerir o mesmo nome a dois cadastros. Uma consulta de disponibilidade nesse ponto não protege o insert que vem depois. Proposta simples para as contas OAuth novas: reservar o namespace `bl_` seguido **exclusivamente** por 1 a 17 dígitos, alocar o próximo número em uma sequence do Postgres e permitir que a pessoa personalize depois. O maior nome tem 20 caracteres. A constraint única do plugin permanece a autoridade para todos os nomes.

- Na migração, reconhecer contas legadas com esse formato, conservar seus usernames e posicionar a sequence acima do maior sufixo numérico existente. Calcular como `numeric`/`bigint` no banco. Se o espaço estivesse exaurido, escolher outro prefixo antes de ativar. Proteger o corte entre a varredura e a ativação de todas as rotas de escrita; um processo legado ainda escrevendo na faixa reservada invalida a garantia.
- Configurar `CREATE SEQUENCE blink_oauth_username_seq AS bigint MAXVALUE 99999999999999999 NO CYCLE`. Com linhas existentes usar `setval(seq, maior, true)` se `maior>=1`; sem elas, `setval(seq,1,false)`. A sequence pode ter lacunas após rollback. `nextval()` concorrente produz valores distintos. [Postgres sequences](https://www.postgresql.org/docs/current/functions-sequence.html)
- O gerador recebe o `bigint` ou a string retornada pelo driver, sem coerção para `Number`. Reservar a faixa no servidor nos cadastros e updates manuais, incluindo endpoints nativos do Better Auth; a validação de **login** continua aceitando aliases automáticos. Uma pessoa legada pode manter o nome reservado que já possuía. Se a versão do plugin usar o mesmo validador em todos os métodos, aplicar a regra nos hooks das rotas de mutação e deixar o validador sintático compartilhado.
- Ao editar `@`, usar `updateUser` do plugin, normalizar para `[a-z0-9_]`, 3–20, conferir a constraint física case-normalizada, traduzir colisão real para `409`. O link novo passa a funcionar após commit; o antigo pode deixar de apontar para o perfil. Avisar antes de salvar. A alteração de `displayName` não muda o handle. [Better Auth username](https://better-auth.com/docs/plugins/username)
- No mesmo Discord ID, o vínculo único do provedor deve resolver para a mesma conta. Revalidar o registro vencedor em caso de corrida na autenticação. Login pelo mesmo e-mail continua exigindo vinculação explícita à conta autenticada. Para Discord sem e-mail, oferecer entrar/criar conta com e-mail real e voltar para vincular o Discord. Verificar que o fluxo de vínculo da versão instalada aceita o perfil; caso contrário, orientar verificar um e-mail no próprio Discord. Recuperação de senha só aponta a endereço que a pessoa controla. [Provedor Discord](https://better-auth.com/docs/authentication/discord) · [vínculos](https://better-auth.com/docs/concepts/users-accounts)

**Recuperar senha.** Usar `requestPasswordReset`, `resetPassword`, `sendResetPassword` e `revokeSessionsOnPasswordReset:true` na versão instalada. Redirect absoluto do próprio Blink, resposta genérica e limite por origem/conta. A URL temporária só atravessa o canal de entrega. Enviar por HTTPS com timeout, identificador de idempotência opaco por pedido e tratamento de `error` mesmo quando o SDK resolve a promise. Solicitação nova gera nova chave; retry da mesma mensagem preserva o corpo e a chave dentro da validade do token. Registrar só status e latência. Resend documenta janela de idempotência de 24 h; a validade do link pode ser menor. [Better Auth](https://better-auth.com/docs/authentication/email-password) · [API de e-mail](https://resend.com/docs/send-with-nodejs) · [idempotência](https://resend.com/docs/dashboard/emails/idempotency-keys)

**Excluir conta.** Usar o fluxo de exclusão do Better Auth com verificação exigida pela modalidade (senha, verificação por e-mail ou sessão recente conforme configuração). Inventariar FKs antes de implementar: remover amizades, sessões e inscrições, invalidar sockets/tickets do usuário, encerrar lives e persistir os trabalhos de retirada de anúncio. A UI só confirma conclusão após commit; um serviço externo indisponível deixa o trabalho durável de término. Para assinante, integrar cancelamento e retenção mínima de registros financeiros pelo [caderno 08](08_MONETIZACAO_E_ESCALA.md). Manter a política de retenção financeira como decisão explícita do negócio. [Exclusão no Better Auth](https://better-auth.com/docs/concepts/users-accounts)

## Importação e aceite

| Evento | Resultado esperado |
|---|---|
| Primeiro deploy com `lives.json` disponível | Validar formato real; importar por ID de mensagem/canal com índice ou recibo único de importação. Só associar ao `run_id` quando a identidade da live original for demonstrável. Órfãos com `message_id` entram em reconciliação. Preservar cópia de leitura na transição. |
| Arquivo ausente no disco efêmero | Novos anúncios já são duráveis. Histórico que só existia no arquivo indisponível é marcado como irrecuperável por essa rota. |
| Mesmo import duas vezes ou `/live` e botão simultâneos | Mesmas linhas e uma intenção por execução/canal. Rodar com Postgres real e duas conexões independentes. |
| Worker morre antes de salvar o recibo Discord; outro assume | Sem publicação automática duplicada. Dado de reconciliação prevalece. |
| Duas contas “Alex” pelo Discord e dois edits manuais para o mesmo handle | Duas contas distintas no primeiro caso; no segundo, um sucesso e um `409`. Nenhum usuário ganha vínculo implícito. |
| `closed → unknown → closed`, prazo ainda válido | Contador `1 → 0 → 1`, anúncio segue ativo. No vencimento absoluto, entra em `ending`. |

Rollout: adicionar schema, ativar escrita Postgres nos dois caminhos, importar o legado ainda disponível, passar leitura ao Postgres e só então desligar escrita em JSON. Evitar dois escritores de anúncio durante a virada. Em rollback de código, manter a versão que entende a nova tabela e pausar a emissão externa se necessário.
