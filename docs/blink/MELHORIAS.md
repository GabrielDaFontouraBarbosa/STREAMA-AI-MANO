# Blink · Plano de melhorias e entrada para o Claude Code

**Revisão de 23/11/2026.** O texto de origem avaliou a interface em 1366 px e 390 px, com e sem sessão, e citou uma revisão após o PR #2. A arquitetura enviada descreve o PR #3. Nesta edição, achados históricos continuam identificados como tal. O checkout e a telemetria são a referência para confirmar o que já foi corrigido.

## Comece por aqui

Coloque os dez Markdown na mesma pasta do repositório, por exemplo `docs/blink/`. Este é o documento de entrada. O texto abaixo também funciona como primeira mensagem no Claude Code. No ZIP, os arquivos já estão em `docs/blink/`; ao extrair na raiz do checkout, o prompt e as referências relativas funcionam com os caminhos abaixo.

> Leia `docs/blink/MELHORIAS.md`, `docs/blink/ARQUITETURA.md` e o caderno indicado para a entrega. Comece pelo PR 0 e pela primeira parte do PR 1: localize os handlers reais da configuração de áudio e vídeo da Activity, registre as versões do checkout e escreva um teste em que o áudio chega depois de o vídeo começar. Implemente a correção, execute o teste e os testes existentes do bot. Se a correção já estiver presente, demonstre-a com o teste e siga para o próximo item pronto da fila. Use o gerenciador e o lockfile existentes. Ao concluir, informe arquivos alterados, comando de teste e resultado observado. O orçamento e o checkout comercial têm PR próprio.

| Preciso implementar… | Abrir |
|---|---|
| Escolha de framework, biblioteca ou plugin | [01_ESCOLHAS_TECNICAS.md](01_ESCOLHAS_TECNICAS.md) |
| Salas, convites, sessões e resolvedor do Discord | [02_SALAS_E_ACESSO.md](02_SALAS_E_ACESSO.md) |
| Captura, som, troca de tela ou bitrate | [03_WEBRTC_DO_HOST.md](03_WEBRTC_DO_HOST.md) |
| Codec, keyframe, fila, reconexão do player | [04_RELAY_E_ACTIVITY.md](04_RELAY_E_ACTIVITY.md) |
| Interface mobile, Open Graph, acessibilidade, módulos e PWA | [05_FRONTEND_E_PWA.md](05_FRONTEND_E_PWA.md) |
| Banco, cadastro, recuperação, exclusão e bot | [06_DADOS_CONTAS_E_BOT.md](06_DADOS_CONTAS_E_BOT.md) |
| CI, cenários manuais, telemetria e rollout | [07_TESTES_E_OPERACAO.md](07_TESTES_E_OPERACAO.md) |
| Preços em reais, orçamento de escala e fluxo de assinatura | [08_MONETIZACAO_E_ESCALA.md](08_MONETIZACAO_E_ESCALA.md) |

A numeração a seguir preserva as quatro frentes da revisão de origem. A fila de PRs na seção 6 organiza a execução por dependências.

---

## 1. Menos "cara de IA"

O Blink hoje parece uma landing gerada:

- título gigante à esquerda e cartão de formulário à direita;
- fundo escuro com detalhes em teal;
- rodapé com dois slogans;
- frases de marketing que prometem demais.

Funciona, mas não tem personalidade e não mostra o produto.

### 1.1 Mostrar o produto em vez de um slogan

**Hoje:** a primeira tela é um título de 4 linhas ("Sua tela, ao vivo, pra
geral."). No celular ele ocupa a tela inteira, e o formulário fica abaixo da
dobra.

**Fazer:**
- **Deslogado:** trocar o título por uma **prévia da live**: um "player"
  com gravação curta identificada como “Demonstração”, poster leve e
  reprodução por escolha da pessoa. Reservar o selo “Ao vivo”, a contagem de
  espectadores e as mensagens reais para uma transmissão em andamento.
- **Logado:** pular a capa e abrir direto no painel. No topo, **"Amigos ao
  vivo agora"** (já existe `presence`) e, embaixo, "Transmitir".
- **No celular:** título de no máximo 2 linhas; o botão principal precisa
  aparecer sem rolar.

**Onde:** `public/index.html` (seção do hero), `public/styles.css`
(`.hero*`) e `public/app.js` (decidir a primeira tela por `account.me`).

### 1.2 Texto honesto e com voz própria

**Hoje:**
- "sem servidor no meio" (`index.html`, linha 84): deixou de ser verdade.
  Com TURN e no Discord o vídeo passa por servidor.
- "em menos de um segundo": não é garantido.
- Rodapé com "num piscar de olhos" e "direto de um navegador pro outro":
  slogans sem informação.

**Fazer:**
- Descrever **o que acontece**, não adjetivos. Ex.: "Abre uma sala, manda
  o link, teus amigos assistem. Sem instalar nada."
- Trocar o rodapé por coisas úteis: status do serviço, link "Apoiar o
  Blink", versão (`/version`) e contato quando configurados. A consulta pública não precisa acordar o banco.
- Revisar a mistura de "pra"/"para" e "você"/"tu". Escolher um tom e
  manter (hoje é informal com "pra" e "você", o que é bom: só padronizar).

### 1.3 Uma assinatura visual

**Hoje:** a paleta (teal + lilás sobre quase preto) e as fontes (Anybody +
Instrument Sans) são bonitas, mas aparecem em muitos produtos parecidos.

**Fazer:**
- **Usar o nome:** a "piscada" do Blink como movimento da marca. O logo
  pode fazer um movimento breve quando a sala abre. Aplicar `prefers-reduced-motion`
  e manter a imagem estável durante entradas frequentes. Hoje o efeito aparece só no
  título.
- **Uma cor de destaque só para "ao vivo"**, que não seja o teal dos botões.
  Hoje "AO VIVO", foco e botão primário dividem a mesma cor e se confundem.
- **Textura ou grão sutil no fundo** (CSS, sem imagem), para fugir do
  "dark mode chapado".
- **Estados vazios com personalidade:** "Esperando alguém entrar…" e
  "Nenhum amigo ainda" podem ter uma ilustração pequena ou uma frase com
  graça.

### 1.4 Coerência de ícones

**Hoje:** a interface usa o sprite SVG (`#i-mic`, `#i-share`…), mas as partes
novas usam **emoji**: `🔊 Toque pra ouvir`, `Apoiar o Blink ❤`, e no bot
`📺` e `🌐`. Emoji muda de cara em cada sistema e destoa do resto.

**Fazer:** criar `#i-vol`, `#i-heart` e `#i-discord` no sprite e usar nos
botões novos (`public/index.html`, `public/app.js`,
`public/discord/index.html`).

### 1.5 Linguagem técnica na interface

**Hoje:** a pílula "Offline" e o rótulo "Sem sala" no cartão de transmitir
parecem painel de desenvolvedor.

**Fazer:** esconder antes de abrir a sala; depois, mostrar só "AO VIVO ·
3 assistindo".

---

## 2. Uso

### 2.1 Pedir conta antes, não depois

**Hoje:** deslogado, a aba **Transmitir** mostra o campo "Seu nome" e todas as
opções, mas transmitir exige conta. A pessoa preenche tudo e só no clique
abre o login.

**Fazer:** deslogado, a aba Transmitir mostra "Entre para transmitir" com
**Entrar com Discord** em destaque se o provedor estiver habilitado. O login por credenciais continua disponível. O campo "Seu nome" só faz sentido em
**Assistir** sem conta.

### 2.2 Topo apertado no celular

**Hoje:** a 390 px aparecem avatar, "Conectar Discord" e "Sair"; o nome
some.

**Fazer:** um **menu de conta** (clique no avatar) com nome, `@usuario`,
Discord (conectar/desconectar), "Copiar meu link" e Sair.

### 2.3 Conta: o básico que falta

| Falta | Por que importa |
|---|---|
| **Esqueci minha senha** | Better Auth tem o fluxo de recuperação. Usar envio HTTPS de e-mail na hospedagem descrita e testar a expiração do link. |
| **Editar perfil** (nome e `@usuario`) | Quem entrou pelo Discord recebe um `@` gerado (`gabrielfontoura38394`) e não consegue trocar. |
| **Excluir conta** | Permitir o encerramento verificável de conta, sessões e dados relacionados. O caderno 06 define a operação e os dados que exigem política de retenção. |

### 2.4 Som: avisar antes de abrir a sala

**Hoje:** o aviso "Live sem som" aparece **depois** de começar.

**Revisão.** Antes do seletor, explicar que a opção depende do navegador e da
fonte. Depois da seleção, verificar os tracks retornados. Sem áudio, oferecer
escolher de novo ou continuar sem som, antes de publicar a sala. [Captura de tela](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia)

### 2.5 Convite melhor

- **QR code** do link da sala, para quem está no PC chamar alguém no celular.
- **Pré-visualização do link** (Open Graph): hoje as meta tags são
  genéricas ("Sua tela ao vivo pra geral. P2P…", que também repete a
  promessa do P2P), e o `og:image` usa caminho relativo (`icon-512.png`),
  que vários apps ignoram: tem que ser URL absoluta. Para `/s/:code`, servir
  meta tags no HTML inicial com uma imagem absoluta da marca e o título
  “Convite para uma transmissão no Blink”. Isso preserva a privacidade do host
  e funciona igualmente com convites ativos ou encerrados.

### 2.6 Quem assiste

- Mostrar **quem está pelo Discord** na lista do host. Hoje aparece só uma
  mensagem no chat.
- **Reações rápidas** (👏 🔥 😂) por cima do vídeo: barato via sinalização
  e dá vida à live.

---

## 3. Desempenho

### 3.1 Cache de arquivos

**Hoje:** HTML, CSS e JS vão com `Cache-Control: no-cache`. A cada visita o
navegador pergunta se mudou: no 4G isso é um round-trip a mais por arquivo.

**Fazer:** nome de arquivo com hash (`app.3f9a.js`) e
`Cache-Control: immutable` de 1 ano; só o HTML fica `no-cache`. Dá para
fazer sem bundler: um script de build pequeno que renomeia e reescreve as
referências. A escolha desta revisão é reutilizar esbuild, já citado no SDK do
Discord, para resolver também imports transitivos, CSS e workers. A PWA mantém
acesso aos chunks da release anterior durante a live.

### 3.2 `app.js` com 1.780 linhas

**Hoje:** um arquivo só com autenticação, chat, host, viewer, amigos e
atalhos.

**Fazer:** separar em módulos ES (`auth.js`, `host.js`, `viewer.js`,
`friends.js`, `chat.js`). O navegador já entende `import`, então não
precisa de build para começar a extração. Separar o refactor da etapa de publicação
com hash. O viewer pode carregar sem o código do host.

### 3.3 Primeira carga

- As fontes já têm `preload` e `font-display: swap` (bom). Dá para cortar
  mais: um subset da Anybody só com os caracteres do título.
- O SDK do Discord (147 KB) já carrega só dentro da Activity (bom).

### 3.4 Banco

O `/api/me` faz 1 a 2 consultas ao Neon. Com o Neon "dormindo", o primeiro
acesso pode demorar. Medir `/api/me` frio e aquecido, revisar consultas e
inicialização da sessão. Polling artificial pode manter o compute do banco
ativo; revisar o custo depois de medir. [Neon](https://neon.com/docs/introduction/scale-to-zero)

---

## 4. Bugs conhecidos

Da revisão de código depois do PR #2. Os dois graves já foram corrigidos no
PR #3; estes são os que ficaram:

| Bug | Onde | Correção |
|---|---|---|
| Quem sabe o ID de um canal do Discord descobre o código da sala anunciada nele | `GET /api/discord/room?channel=` (`server/src/app.js`) | Retirar a resolução pública por canal; confirmar usuário OAuth, aplicação, participação na instância e vínculo bot→run. Um ID público isolado é insuficiente. |
| Dois cadastros simultâneos pelo Discord com o mesmo nome: um falha | `uniqueUsername()` (`server/src/auth.js`) | Reservar aliases automáticos com sequence e prefixo protegido; editar @ usa a constraint real. Ver caderno 06. |
| Conta do Discord sem e-mail não consegue se cadastrar e vê erro genérico | callback do Discord + `discordReturn()` (`public/app.js`) | Explicar como verificar o e-mail no Discord ou vincular à conta Blink autenticada; recuperação exige um endereço sob controle da pessoa. |
| Na Activity, o vídeo trava quando chega a configuração do áudio | `setupVideo()` (`public/discord/viewer.js`) | Comparar configuração efetiva por trilha, incluindo bytes de descrição. Patch de áudio conserva o decoder de vídeo. |
| Erro do decodificador pode entrar em loop de reinício | `resetVideoDecoder()` (`public/discord/viewer.js`) | Após 3 falhas seguidas, encerrar resets e oferecer “Abrir no navegador”. Zerar a sequência após janela saudável. |
| Host sem codec para o relay: quem assiste no Discord espera para sempre | `runVideo()` (`public/relay-host.js`) | Mandar `{type:'unsupported'}` ao relay e mostrar na Activity; idem para "sem som". |
| No Safari antigo, voltar do Discord apaga `?sala` da URL | `discordReturn()` usa `URLSearchParams.size` | Usar `p.toString()`. |
| `docker compose up` sem `POSTGRES_PASSWORD` falha de forma confusa | `docker-compose.yml` | Validar e explicar no topo do arquivo. |
| Anúncios do bot se perdem no redeploy | `mini-blink/data/lives.json` em disco efêmero | Persistir intenção, recibo, lease e vínculo no Postgres; conciliar envio cujo resultado ficou incerto. |

---

## 5. Robustez e segurança

- **Cabeçalhos de segurança:** CSP, `X-Frame-Options`/`frame-ancestors`
  (liberando o domínio do Discord só para a Activity), `Referrer-Policy` e
  `Permissions-Policy`. Hoje nenhum é enviado.
- **Rate limit fora do login:** `/api/rooms/:code`, `/api/discord/room` e
  `viewer-join` permitem tentar códigos em sequência. Um limite simples por
  origem confiável e finalidade deve abranger HTTP e WS. Compartilhar orçamento
  no processo, proteger reconexões legítimas e ajustar os valores com dados reais.
- **Testes no repositório:** os testes de WebRTC, relay, áudio e rate limit
  foram feitos com Playwright, mas os roteiros não estão no repositório.
  Trazer para `tests/e2e/` com Postgres em Docker.
- **CI no GitHub Actions:** `npm test` do bot + E2E a cada PR. Hoje só o
  GitGuardian roda.
- **Logs estruturados:** trocar `console.*` por JSON com nível e contexto
  (evento, operação, duração e resultado). Evitar código de sala, dados pessoais ou URL com credenciais.

---

## 6. Fila de implementação

O PR 0 levanta o que a branch realmente contém. O primeiro bug tem um critério visível: o vídeo continua em movimento ao entrar a configuração de áudio. Operar cada PR como uma unidade pequena; dividir uma linha da tabela quando handlers, migrations ou superfícies forem independentes.

| PR | Entrega e caderno | Depende de | Evidência que encerra a entrega |
|---|---|---|---|
| 0 | Caracterizar checkout, build, rotas, versões e primeiro teste; 01 e 07 | Nenhum | Comandos existentes do bot registrados; fixture vídeo/áudio reproduz o comportamento da branch. |
| 1 | Corrigir Activity em etapas: config por trilha, recuperação finita, capacidade do host e fila por viewer; 04 | 0 | Um decoder segue entregando quadros após patch de áudio; host incompatível dá fallback; leitor lento não paralisa outro. |
| 2A | Schema aditivo de execução, anúncios e vínculos; 06 | 0 | Migrations no banco vazio/legado; unicidade e reivindicação concorrente verificadas. |
| 2B | Corrigir acesso por canal, tickets, limite HTTP/WS, retomada e headers por superfície; 02 | 2A; publicar a escrita autenticada do vínculo com o leitor (2C para importação) | Convite anônimo e entrada verificada pela Activity funcionam. Se necessário antecipar a retirada do fallback por canal, o cliente oferece código manual. |
| 2C | Bot e reconciliação, importação dos anúncios e rollout de persistência; 06 | 2A | Repetir o botão e reiniciar o worker mantém um anúncio por execução/canal. |
| 3 | Aviso de áudio, upload, troca de fonte e reconexão do navegador; 03 | 0; integrar demanda do relay do 1 | 1 e 5 viewers com/sem relay; orçamento respeitado e troca sem encerrar a live saudável. |
| 4A | Gate de login, copy, mobile, ícones, acessibilidade, convites e preview; 05 | 0; contrato de captura do 3 | Deep links mantidos, visitante consegue assistir e 390 px tem CTA visível. |
| 4B | Conta, `@`, redefinição, exclusão, menu e retorno OAuth; 05 e 06 | 2A e provedores opcionais para as funções correspondentes | Colisão concorrente tratada, reset respeita expiração, exclusão fecha a live e suas inscrições. |
| 5 | Extração de módulos, build, assets com hash e PWA; 05 e 07 | Smoke das jornadas 1, 3 e 4A | Imagem Docker gerada em clone limpo; atualização de SW durante live não interrompe o player. |
| 6 | Medição de custos, teste de oferta, checkout e direitos de assinatura; 08 | Acesso e telemetria básicos; checkout começa em modo de teste | Modelos financeiros conferidos e webhook duplicado deixa um benefício. |
| 7 | Experimento de escala ou SFU, se os gatilhos previstos ocorrerem; 01 e 08 | Medições por transporte | Comparação de custo, upload, qualidade e tempo de entrada no mesmo cenário. |

Logs, testes e métricas entram no PR que muda o comportamento. Em cada PR informar **o que o checkout já fazia**, **qual comportamento mudou**, **como foi verificado** e **como reverter a mudança**. Valores de SLO, preços e faixas de esforço são propostas para o projeto. Suporte específico de navegador ou do Discord só é dado como confirmado quando houver versão e teste correspondentes.
