# Blink — Plano de melhorias

Lista do que melhorar no Blink, em quatro frentes:

1. visual e texto com menos "cara de IA";
2. uso;
3. desempenho;
4. bugs e robustez.

Cada item diz o problema que se vê hoje, o que fazer e onde mexer. No fim há
uma ordem sugerida, por impacto e esforço.

Base: o site rodando de `master` em tela grande (1366 px) e celular
(390 px), deslogado e logado, mais a revisão de código feita depois do PR #2.

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
  com uma gravação curta, o selo AO VIVO, o contador de quem assiste e o
  chat rolando. Quem chega entende o produto em 2 segundos.
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
  Blink", versão (`/version`) e contato.
- Revisar a mistura de "pra"/"para" e "você"/"tu". Escolher um tom e
  manter (hoje é informal com "pra" e "você", o que é bom: só padronizar).

### 1.3 Uma assinatura visual

**Hoje:** a paleta (teal + lilás sobre quase preto) e as fontes (Anybody +
Instrument Sans) são bonitas, mas aparecem em muitos produtos parecidos.

**Fazer:**
- **Usar o nome:** a "piscada" do Blink como movimento da marca. O logo
  pisca ao abrir a sala, a borda do player pisca quando alguém entra, e o
  "Sintonizando…" vira uma piscada lenta. Hoje o efeito aparece só no
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
**Entrar com Discord** em destaque. O campo "Seu nome" só faz sentido em
**Assistir** sem conta.

### 2.2 Topo apertado no celular

**Hoje:** a 390 px aparecem avatar, "Conectar Discord" e "Sair"; o nome
some.

**Fazer:** um **menu de conta** (clique no avatar) com nome, `@usuario`,
Discord (conectar/desconectar), "Copiar meu link" e Sair.

### 2.3 Conta: o básico que falta

| Falta | Por que importa |
|---|---|
| **Esqueci minha senha** | Hoje quem esquece perde a conta. O Better Auth tem o fluxo; falta a interface e um provedor de e-mail. |
| **Editar perfil** (nome e `@usuario`) | Quem entrou pelo Discord recebe um `@` gerado (`gabrielfontoura38394`) e não consegue trocar. |
| **Excluir conta** | Expectativa básica (e pedida pela LGPD). |

### 2.4 Som: avisar antes de abrir a sala

**Hoje:** o aviso "Live sem som" aparece **depois** de começar.

**Fazer:** detectar o sistema antes. No Linux, no Mac e no Firefox, mostrar
ao lado de "Mandar o áudio junto": "Aqui só dá para mandar o som de uma aba
do Chrome", com um link "como fazer".

### 2.5 Convite melhor

- **QR code** do link da sala, para quem está no PC chamar alguém no celular.
- **Pré-visualização do link** (Open Graph): hoje as meta tags são
  genéricas ("Sua tela ao vivo pra geral. P2P…", que também repete a
  promessa do P2P), e o `og:image` usa caminho relativo (`icon-512.png`),
  que vários apps ignoram: tem que ser URL absoluta. Para `/s/:code`, servir
  meta tags próprias com "Fulano está ao vivo" e uma imagem da marca.

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
referências.

### 3.2 `app.js` com 1.780 linhas

**Hoje:** um arquivo só com autenticação, chat, host, viewer, amigos e
atalhos.

**Fazer:** separar em módulos ES (`auth.js`, `host.js`, `viewer.js`,
`friends.js`, `chat.js`). O navegador já entende `import`, então não
precisa de build. Ganha manutenção, e o viewer pode carregar sem o código do
host.

### 3.3 Primeira carga

- As fontes já têm `preload` e `font-display: swap` (bom). Dá para cortar
  mais: um subset da Anybody só com os caracteres do título.
- O SDK do Discord (147 KB) já carrega só dentro da Activity (bom).

### 3.4 Banco

O `/api/me` faz 1 a 2 consultas ao Neon. Com o Neon "dormindo", o primeiro
acesso demora. Como o Render já fica acordado, considerar um ping leve ao
banco a cada poucos minutos **só durante o dia**, ou aceitar o atraso.

---

## 4. Bugs conhecidos

Da revisão de código depois do PR #2. Os dois graves já foram corrigidos no
PR #3; estes são os que ficaram:

| Bug | Onde | Correção |
|---|---|---|
| Quem sabe o ID de um canal do Discord descobre o código da sala anunciada nele | `GET /api/discord/room?channel=` (`server/src/app.js`) | Exigir a instância da Activity; tirar o fallback por canal ou validar com token do bot. |
| Dois cadastros simultâneos pelo Discord com o mesmo nome: um falha | `uniqueUsername()` (`server/src/auth.js`) | Repetir com sufixo quando o insert bater na restrição única. |
| Conta do Discord sem e-mail não consegue se cadastrar e vê erro genérico | callback do Discord + `discordReturn()` (`public/app.js`) | Mensagem específica, ou e-mail substituto. |
| Na Activity, o vídeo trava quando chega a configuração do áudio | `setupVideo()` (`public/discord/viewer.js`) | Só reconfigurar se o codec ou o tamanho mudaram. |
| Erro do decodificador pode entrar em loop de reinício | `resetVideoDecoder()` (`public/discord/viewer.js`) | Contar erros seguidos e, depois de 3, mostrar "Abrir no navegador". |
| Host sem codec para o relay: quem assiste no Discord espera para sempre | `runVideo()` (`public/relay-host.js`) | Mandar `{type:'unsupported'}` ao relay e mostrar na Activity; idem para "sem som". |
| No Safari antigo, voltar do Discord apaga `?sala` da URL | `discordReturn()` usa `URLSearchParams.size` | Usar `p.toString()`. |
| `docker compose up` sem `POSTGRES_PASSWORD` falha de forma confusa | `docker-compose.yml` | Validar e explicar no topo do arquivo. |
| Anúncios do bot se perdem no redeploy | `mini-blink/data/lives.json` em disco efêmero | Guardar no Postgres. |

---

## 5. Robustez e segurança

- **Cabeçalhos de segurança:** CSP, `X-Frame-Options`/`frame-ancestors`
  (liberando o domínio do Discord só para a Activity), `Referrer-Policy` e
  `Permissions-Policy`. Hoje nenhum é enviado.
- **Rate limit fora do login:** `/api/rooms/:code`, `/api/discord/room` e
  `viewer-join` permitem tentar códigos em sequência. Um limite simples por
  IP (o mesmo `clientIp()`) resolve.
- **Testes no repositório:** os testes de WebRTC, relay, áudio e rate limit
  foram feitos com Playwright, mas os roteiros não estão no repositório.
  Trazer para `tests/e2e/` com Postgres em Docker.
- **CI no GitHub Actions:** `npm test` do bot + E2E a cada PR. Hoje só o
  GitGuardian roda.
- **Logs estruturados:** trocar `console.*` por JSON com nível e contexto
  (sala, usuário) para achar problemas no log do Render.

---

## 6. Ordem sugerida

| # | Item | Impacto | Esforço |
|---|---|---|---|
| 1 | Pedir conta antes de transmitir (2.1) + Entrar com Discord em destaque | Alto | Baixo |
| 2 | Texto honesto e rodapé útil (1.2) | Alto | Baixo |
| 3 | Aviso de som antes de abrir a sala (2.4) | Alto | Baixo |
| 4 | Ícones SVG no lugar de emoji (1.4) e sem linguagem técnica (1.5) | Médio | Baixo |
| 5 | Menu de conta no celular (2.2) + editar perfil (2.3) | Alto | Médio |
| 6 | Bugs da seção 4 (os três da Activity primeiro) | Médio | Médio |
| 7 | Capa com prévia real / painel para logado (1.1) | Alto | Médio |
| 8 | Pré-visualização do link no WhatsApp/Discord (2.5) | Alto | Médio |
| 9 | Cabeçalhos de segurança + rate limit (5) | Médio | Baixo |
| 10 | Assinatura visual: piscada e cor do "ao vivo" (1.3) | Médio | Médio |
| 11 | Esqueci minha senha (2.3), que precisa de provedor de e-mail | Médio | Médio |
| 12 | Dividir `app.js` + cache com hash (3.1, 3.2) | Médio | Médio |
| 13 | Testes E2E no repositório + CI (5) | Médio | Médio |
