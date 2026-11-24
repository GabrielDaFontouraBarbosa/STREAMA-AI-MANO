# 08 · Como monetizar o Blink e quanto reservar para crescer

**Recomendação para Ino.** Começar com o espectador gratuito e testar **Blink Plus a R$ 29,90/mês por host**. Para operar um piloto pequeno no stack atual, reservar **R$ 67/mês**. Um beta com **1.000 horas-espectador/mês**, sendo 250 dentro do Discord, pede **R$ 713/mês** nas hipóteses abaixo. Para **5.000 horas-espectador/mês**, sendo 1.500 dentro do Discord, reservar **R$ 2.856/mês**. Para três meses no beta, a reserva operacional fica em **R$ 2.138**. Trabalho de implementação tem orçamento separado.

Valores em 23/11/2026. Tarifas públicas são referências. Uso, tamanho de máquina, taxa de conversão e preço de venda são hipóteses para validação. O câmbio de **R$ 5,50/US$** é de planejamento. Nenhuma conta de provedor, fatura ou telemetria do Blink foi fornecida.

## O que vender primeiro

| Oferta a testar | Quem paga | Entrega proposta | Como validar |
|---|---|---|---|
| **Blink gratuito** | Host e viewer começam sem cartão | Transmissão por convite, chat, presença e acesso básico ao Discord. Enquanto a franquia estiver em teste, exibir consumo e custo em modo de medição. | Medir hosts que completam a primeira live, voltam em 7 dias e têm ao menos um viewer que recebe vídeo. |
| **Blink Plus · R$ 29,90/mês** | Quem organiza transmissões recorrentes | Página do host com identidade visual, convites de evento com opção de aprovação e histórico agregado de público. Hipótese de franquia comercial de até **10 horas-espectador de relay Discord** por ciclo, condicionada às regras da plataforma. | Oferecer a hosts ativos. Rastrear checkout concluído, segunda mensalidade, uso da franquia e chamados de suporte. Nenhuma venda de qualidade/fila antes da medição e homologação. |
| **Apoio avulso · a partir de R$ 10** | Pessoa que quer apoiar o projeto | Apoio voluntário, sem liberar capacidade ou acesso a conteúdo. Manter botão discreto na web. | Medir receita líquida separadamente. Receita de apoio não compõe MRR. |

O primeiro público a testar é quem mostra processo criativo, faz sessões de jogo ou revisa trabalhos ao vivo com um grupo pequeno. Quem organiza enxerga valor no link reutilizável do perfil, na entrada controlada e no histórico. O viewer entra pelo link já conhecido. Fazer convites para 20 hosts ativos e observar quatro semanas; meta interna de decisão: cinco dispostos a pagar, pelo menos três pagamentos reais e evidência de repetição antes de financiar um plano de equipes. Esses números orientam o experimento e não projetam demanda.

**Discord e pagamentos.** Na primeira versão comercial, vender no site os recursos próprios do painel web e manter a Activity básica disponível. Antes de habilitar vantagens pagas que se manifestam na Activity ou no bot, verificar elegibilidade do time no Developer Portal e a política aplicável. Nas regiões e ofertas cobertas, o Discord exige também compra por Premium Apps e preço no Discord igual ou inferior ao de outros canais. A página de suporte consultada cita EUA, Reino Unido e União Europeia; confirmar a situação da entidade operadora no momento de lançar. O modelo abaixo considera apenas assinaturas web em cartão brasileiro. Receitas via Discord precisam de uma linha de taxas e repasses própria. [Política do Discord](https://support-dev.discord.com/hc/en-us/articles/8563934450327-Discord-Developer-Policy) · [aplicação regional da regra](https://support-dev.discord.com/hc/en-us/articles/23810643331735-Premium-Apps-Required-Support-for-Monetizing-Apps) · [elegibilidade](https://support-dev.discord.com/hc/en-us/articles/17297949965079-How-Do-I-Monetize-My-App)

## A unidade que define o custo

Uma hora com dez pessoas assistindo soma **10 horas-espectador**. Uma pessoa do navegador assistindo 30 minutos e outra no Discord assistindo 30 minutos somam **1 hora-espectador**, repartida em dois caminhos. Tempo do host e duração da sala são medidas diferentes. O pico simultâneo determina CPU/memória e capacidade de upload. A soma mensal de horas e bitrates determina transferência.

| Caminho | Exemplo de cobrança no desenho atual | Medidor para confrontar com a fatura |
|---|---|---|
| Navegador com WebRTC direto | O host envia mídia ao viewer. O Render serve sinalização e estáticos. | Horas do par com ICE direto; registrar agregado e bytes de controle/estáticos. |
| Navegador que precisou de TURN | Cloudflare mede os GB de saída em realtime. O Render continua fora desse caminho de mídia. | Horas por par ICE com candidato `relay`; comparar a estimativa com egress medido no provedor. |
| Viewer na Activity | O host envia **um** fluxo ao Blink. O Render envia **uma cópia por viewer** pelo WebSocket do relay. | Somar bytes enviados por sockets de leitores; o painel do Render inclui também tráfego web e demais apps do workspace. |
| SFU futuro | Mídia passa a sair do provedor SFU para os viewers migrados. Podem entrar também minutos por participante, bases fixas e ponte Discord. | Orçar somente os fluxos que realmente mudam de caminho e contabilizar host/ponte quando o provedor cobra participante. |

Hipótese de mídia para os cenários: vídeo médio de **2 Mbps**, áudio de **0,096 Mbps** e **10%** de overhead de rede. Assim, `GB por hora-espectador = (2 + 0,096) × 0,45 × 1,10 = 1,03752 GB` decimais. O fator `0,45` converte megabits por segundo em gigabytes por hora. Na produção, usar bitrate efetivo por transporte; os perfis mesh do Blink podem chegar a 6 Mbps de vídeo. A margem de 10% estima bytes faturáveis; os 15% do caderno de host reservam capacidade de uplink e não entram de novo na fatura.

## Tarifas e hipóteses de compra

| Componente | Preço usado | Regra do orçamento |
|---|---|---|
| Render, web service | Compute de US$ 7 (0,5 CPU/512 MB), US$ 25 (1 CPU/2 GB) ou US$ 85 (2 CPUs/4 GB) por mês | Uma instância ativa por cenário. Workspace Hobby US$ 0 ou Pro US$ 25/mês adicional. Sizing inicial, sujeito a ensaio de pico. [Preços](https://render.com/pricing) · [compute](https://render.com/docs/compute-plans) · [planos de workspace](https://render.com/docs/new-workspace-plans) |
| Render, saída pública | US$ 0,15/GB após 5 GB/mês no Hobby ou 25 GB no Pro | Inclui respostas WS, estáticos e demais serviços no mesmo workspace. Cenários assumem workspace dedicado e plano vigente, não legado. [Banda faturável](https://render.com/docs/outbound-bandwidth) |
| Cloudflare Realtime TURN/SFU | US$ 0,05/GB após os primeiros **1.000 GB/mês compartilhados** | Considerar a franquia disponível para o Blink. Se outro projeto usar a mesma franquia, subtrair essa parcela. [Preço Realtime](https://developers.cloudflare.com/realtime/sfu/platform/pricing/) · [TURN](https://developers.cloudflare.com/realtime/turn/) |
| Neon | Free no piloto, dentro das cotas. Launch a US$ 0,106/CU-h + US$ 0,35/GB-mês | `CU-h` mede capacidade × tempo. Cenários assumem histórico recuperável, backups extras e tráfego adicional sem custo material; adicionar uso real dessas rubricas. [Neon](https://neon.com/docs/introduction/plans) |
| E-mail | Resend Free com até 3.000/mês e limite diário, ou Pro a US$ 20/mês com 50.000/mês incluídos | Escalonar pelo volume e pelo pico diário. [Preços Resend](https://resend.com/pricing) |
| Domínio e reserva | **R$ 8/mês** provisionados para domínio; **25%** de reserva sobre custo convertido e domínio | Hipóteses internas. Processamento de cartão, tributos, suporte e trabalho são tratados à parte. |

## Três cenários mensais reproduzíveis

| Entrada | Piloto | Beta | Crescimento |
|---|---:|---:|---:|
| Horas-espectador totais | 100 | 1.000 | 5.000 |
| Horas no relay Discord | 10 | 250 | 1.500 |
| Horas de navegador | 90 | 750 | 3.500 |
| Fração do navegador com TURN | 20% | 20% | 35% |
| Outros GB saindo do Render | 3 | 10 | 30 |
| Workspace / compute em US$ | Hobby 0 + 7 | Pro 25 + 25 | Pro 25 + 85 |
| Banco e e-mail em US$ | Free + Free | 140 CU-h e 2 GB = 15,54; e-mail Free | 325 CU-h e 5 GB = 36,20; e-mail 20 |
| Pico simultâneo a ensaiar, como hipótese | 1 sala × 5 viewers | 5 salas × 8 viewers | 15 salas × 10 viewers |

| Saída calculada | Piloto | Beta | Crescimento |
|---|---:|---:|---:|
| GB públicos Render, incluindo extras | 13,38 | 269,38 | 1.586,28 |
| GB TURN | 18,68 | 155,63 | 1.270,96 |
| Excedente de banda Render, em US$ | 1,26 | 36,66 | 234,19 |
| Excedente TURN, em US$ | 0,00 | 0,00 | 13,55 |
| Total dos provedores, em US$ | 8,26 | 102,20 | 413,94 |
| Custo em reais, incluindo domínio | R$ 53,41 | R$ 570,08 | R$ 2.284,67 |
| **Reserva mensal, com 25%** | **R$ 67** | **R$ 713** | **R$ 2.856** |
| **Caixa de 90 dias no mesmo uso** | **R$ 200** | **R$ 2.138** | **R$ 8.568** |

Arredondar somente as saídas. O piloto já inclui compute pago para evitar que a primeira apresentação dependa de cold start do plano gratuito. O beta inclui o workspace Pro como escolha operacional; no **mesmo tráfego** e compute de US$ 25, trocar Pro por Hobby reduziria US$ 25 de base e acrescentaria US$ 3 de excedente no modelo, economia líquida de **US$ 22/mês** se os recursos do Pro forem dispensáveis. Tráfego e franquias são compartilhados por workspace. Nenhum dos três tamanhos de máquina equivale a uma garantia de viewers simultâneos.

## Calculadora em JavaScript

Função pura para um futuro comando interno ou planilha de conferência. `turnFraction` incide apenas sobre as horas de navegador. Informar o saldo **disponível** de cada franquia e custo mensal USD já estimado de banco e e-mail. Usar valores reais separados por transporte se o host enviar perfis diferentes. Uso financeiro de clientes deve ser armazenado em centavos inteiros; o cálculo de planejamento aqui preserva decimais até a apresentação.

```js
export function estimateMonth({
  viewerHours, discordHours, turnFraction, workspaceUSD, computeUSD,
  neonUSD, emailUSD, renderExtraGB, renderAllowanceGB, cfAllowanceGB = 1000,
  discordMbps = 2.096, browserMbps = 2.096, overhead = 0.10,
  fx = 5.5, localBRL = 8, reserve = 0.25
}) {
  const numbers = [viewerHours, discordHours, turnFraction, workspaceUSD, computeUSD,
    neonUSD, emailUSD, renderExtraGB, renderAllowanceGB, cfAllowanceGB,
    discordMbps, browserMbps, overhead, fx, localBRL, reserve];
  if (!numbers.every(n => Number.isFinite(n) && n >= 0) ||
      discordHours > viewerHours || turnFraction > 1 || fx === 0) {
    throw new RangeError("Premissas inválidas");
  }
  const gb = (hours, mbps) => hours * mbps * 0.45 * (1 + overhead);
  const renderGB = renderExtraGB + gb(discordHours, discordMbps);
  const turnGB = gb((viewerHours - discordHours) * turnFraction, browserMbps);
  const renderOverage = Math.max(0, renderGB - renderAllowanceGB) * 0.15;
  const turnOverage = Math.max(0, turnGB - cfAllowanceGB) * 0.05;
  const usd = workspaceUSD + computeUSD + neonUSD + emailUSD + renderOverage + turnOverage;
  const brl = usd * fx + localBRL;
  return { renderGB, turnGB, renderOverage, turnOverage, usd, brl, budget: brl * (1 + reserve) };
}
```

**Sensibilidade.** A câmbio de R$ 5,00 a R$ 6,00 por dólar, o beta varia de **R$ 649 a R$ 776/mês** com reserva. Com a franquia do Render já gasta, cada 100 horas-espectador adicionais no Discord custam cerca de **R$ 85,60** de saída, antes da reserva. Um viewer em TURN após a franquia consome cerca de **R$ 0,29/h** no perfil adotado. Um host com cinco viewers, todos no navegador direto, pode saturar o próprio upload mesmo se a fatura do servidor for pequena.

## Preço, margem e ponto de equilíbrio

Stripe Brasil publica **3,99% + R$ 0,39** por transação em cartão nacional e Stripe Billing avulso cobra **0,7%** do volume elegível. Uma cobrança web de R$ 29,90 rende aproximadamente **R$ 28,11** após essas duas taxas. Tributos, estorno, chargeback, suporte, pró-labore e aquisição reduzem o valor disponível. A simulação usa uma transação nacional bem-sucedida por mês. [Stripe Brasil](https://stripe.com/br/pricing) · [Stripe Billing](https://stripe.com/br/billing/pricing)

| Pergunta | Conta | Interpretação |
|---|---|---|
| Quantos assinantes cobrem o orçamento de cada cenário? | `ceil(reserva mensal / 28,10769)` | **3 no piloto, 26 no beta, 102 no crescimento**. Válido mantendo o tráfego daquele cenário; ele já inclui o consumo total. |
| Quanto sobra de um Plus de uso intensivo? | `28,10769 − 10 × 0,855954 − 2 × 0,285318` | **R$ 18,98** em contribuição antes dos demais custos, para 10h de Discord e 2h de TURN, com franquias já gastas. É uma visão marginal separada da cobertura de caixa. |
| O que o beta precisa para pagar também trabalho recorrente? | Exemplo de 8h/mês × R$ 100/h, além da reserva de R$ 712,60 | **54 assinantes**, mantidos o mesmo tráfego e as taxas. O valor-hora é uma premissa que você pode substituir. |

Começar sem compra de tráfego. Comparar receita de coortes com seu consumo de relay e retenção no segundo ciclo. Se o uso aumentar junto com assinaturas, recalcular os custos em cada coorte antes de aumentar franquias. Alertar a 70% e 90% do orçamento/volume projetado. Perto do limite, oferecer o link para navegador e limitar **novas** admissões de relay com uma explicação antes de novos compromissos de capacidade.

## Quando colocar dinheiro em escala

| Decisão | Evidência de entrada | Investimento e critério de saída |
|---|---|---|
| Piloto → beta | Usuários retornando, primeira carga afetada por cold start, primeiros pagantes | Reservar **R$ 2.138 para três meses** no cenário beta. Subir o compute só com evidência de pico. Medir custo por hora-espectador e tempo até primeiro quadro. |
| Separar relay do processo web | Event loop/memória ou bytes do relay degradam login e sinalização; fila chega ao limiar com carga real | Orçar segundo processo e seu egress, independentemente do número de cadastros. Uma separação no mesmo provedor pode melhorar isolamento mantendo custo de GB semelhante. Medir o pico antes de contratar. |
| Prototipar SFU para navegador | Host satura o uplink em grupos frequentes, conforme [01_ESCOLHAS_TECNICAS.md](01_ESCOLHAS_TECNICAS.md) | Exemplo isolado: LiveKit Ship a US$ 50/mês com 250 GB e 150.000 minutos WebRTC, excedentes de US$ 0,12/GB e US$ 0,0005/min na tabela consultada. Para 500h-viewer + 100h-host nesse SFU: ~519 GB de saída e 36.000 min → **~US$ 82,25/mês** para o SFU. O relay Discord e o plano de controle seguem no orçamento. [Tabela LiveKit, seção Participants](https://livekit.com/pricing) |
| Investimento único em desenvolvimento | Equipe vai implementar e homologar cobrança/medição ou a ponte SFU | Estimativa interna: 24–40h para billing, medição inicial e homologação = **R$ 2.400–4.000** a R$ 100/h. Spike SFU separado: 16–32h = **R$ 1.600–3.200**. Não cobre refatoração de todos os cadernos, produção de uma ponte de mídia ou manutenção. |

Com trabalho próprio, separar as horas no planejamento. Se contratar a implementação comercial, **beta por 90 dias + implementação inicial = cerca de R$ 4.538–6.138**, antes de tributos do negócio e de aquisição paga. Não há necessidade de financiar a investigação de SFU no primeiro ciclo de cobrança.

## Implementação de cobrança e medição para o Claude Code

1. Criar `billing_customers(user_id UNIQUE, provider_customer_id UNIQUE)`, `subscriptions(provider, external_id, user_id, status, paid_through, cancel_at_period_end, UNIQUE(provider,external_id))` e `billing_events(provider,event_id,state,received_at, UNIQUE(provider,event_id))`. Contas e segredos separados para teste e produção. Manter apenas IDs, valores e estados necessários, sem dados de cartão. Um `user_id` pode ter um único benefício Plus efetivo, mesmo durante reconciliação de provedores.
2. `POST /api/billing/checkout` exige sessão atual, aceita um `planKey` conhecido e escolhe `price_id` e BRL do catálogo no servidor. Chave de idempotência por intenção de checkout; recuperar sessão aberta em duplo clique. `POST /api/billing/portal` cria sessão do portal para o customer da conta atual. O redirecionamento de sucesso mostra “Confirmando pagamento”.
3. `POST /api/billing/webhook` recebe bytes crus por parser exclusivo **antes** do JSON global; o handler do Better Auth mantém sua própria ordem. Verificar assinatura Stripe e ambiente. Persistir evento válido em inbox e confirmar `2xx` após commit. Duplicata já aceita pode receber `2xx`; indisponibilidade do banco antes de persistir requer retry. Worker busca o estado canônico da assinatura/fatura, serializa por assinatura e atualiza direito e evento na mesma transação. Reprocessar eventos fora de ordem com a versão/estado atual do provedor. [Webhooks Stripe](https://docs.stripe.com/webhooks) · [assinaturas](https://docs.stripe.com/billing/subscriptions/webhooks)
4. Liberar Plus após pagamento confirmado e vínculo inequívoco de fatura, assinatura, customer e plano. Cancelamento no fim do período mantém Plus até `paid_through`; uma fatura falha não aumenta esse prazo. Mapear reembolso integral/contestação a revisão de benefício com estado canônico. Permitir atualizar cartão e cancelar pelo portal. Queda de billing mantém a conta gratuita e o acesso já pago até o prazo conhecido.
5. Medir no servidor o intervalo de cada conexão de `view` admitida no relay. Registrar checkpoints, por exemplo a cada 15 s, e no fechamento. Chave idempotente `(connection_id, interval_seq)` e transação que soma delta ao bucket `(host_id, billing_period)`. Relógio monotônico mede duração, fronteira UTC divide os segundos entre ciclos. Reconnect ganha novo ID e fecha o intervalo anterior no último instante confirmado; uma queda perde no máximo o checkpoint pendente sob cadência normal. Não faturar excedentes automaticamente a partir dessa estimativa. `send` de bytes e segundos de viewer são métricas distintas.
6. Se a franquia virar limite rígido, acrescentar reservas atômicas por pequenos blocos de segundos e compensação do saldo não usado ao fechar; antes desse PR, a medição só informa consumo. Confirmar política do Discord antes de disponibilizar a diferenciação de capacidade. Metadados do preço e direitos vêm do servidor, e o front mostra `used`, `included` e `renewsAt` retornados por `/api/billing/me`.

**Regra de leitura do benefício.** O reconciliador escreve `paidThroughMs` depois de validar o período com o provedor e o valor fica em UTC. Uma suspensão explícita marcada pela revisão de estorno/contestação prevalece sobre a data. O vencimento é exclusivo. A regra serve ao painel web, e a Activity mantém a política de produto definida acima.

```js
export function webTier({ linked, suspended, paidThroughMs }, nowMs) {
  if (!Number.isFinite(nowMs)) throw new RangeError("Relógio inválido");
  const active = linked === true && suspended === false &&
    Number.isFinite(paidThroughMs) && paidThroughMs > nowMs;
  return active ? "plus" : "free";
}
```

**Aceite comercial.** Em modo de teste, duas tentativas de checkout retornam a mesma intenção; webhook duplicado concede um único período; evento atrasado não reativa assinatura encerrada; acesso permanece válido até o fim do período pago; troca de mês divide o intervalo; retries não dobram segundos. Comparar por uma semana os GB calculados com as faturas de Render e Cloudflare. Investigar diferença acima de 15% ajustando bitrate médio, outros serviços no workspace e tráfego descartado/overhead antes de abrir cobrança por uso.
