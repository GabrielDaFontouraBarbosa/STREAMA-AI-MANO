# 05 · Experiência no navegador, acessibilidade e atualização da PWA

**Objetivo.** Em um celular de 390 px, quem recebe um convite deve ver como assistir; quem quer transmitir deve saber quando precisa entrar e se a fonte inclui áudio. Durante uma live, navegação, troca de versão e menus precisam preservar o vídeo. Os caminhos originais são `public/index.html`, `public/styles.css`, `public/app.js`, `public/discord/` e `public/sw.js`.

## Primeira tela e regras de precedência

| Entrada | Primeira tela | Ação principal |
|---|---|---|
| `/?frame_id=…` no mapeamento configurado | HTML da Activity. O SDK confirma o contexto. | Entrar na transmissão vinculada ou digitar o código. |
| `/s/ABC123` ou `/?sala=ABC123` | Convite com opção de nome para visitante. | “Assistir”. A sessão opcional não bloqueia a abertura do convite. |
| `/@usuario` ou `/?perfil=usuario` | Perfil público e presença conforme permissão. | “Pedir para entrar” só quando permitido. |
| Raiz sem sessão | Prévia local identificada como “Demonstração”. Texto curto e botão de assistir/entrar. | “Entrar para transmitir”. Mostrar Discord se o servidor o habilitou. |
| Raiz com sessão | Painel “Amigos ao vivo”, depois “Transmitir”. | Estado vazio com “Copiar meu perfil” e botão de transmissão. |
| OAuth volta com sala ou perfil já selecionado | A mesma intenção sanitizada retorna após o callback tratado. | Restaurar foco e mostrar o resultado do login/vínculo. |

Funções de referência para o roteador de UI. O servidor mantém validações próprias. Interpretar retorno OAuth somente depois de o mecanismo existente processar os seus parâmetros. Antes de iniciar OAuth, salvar na sessão da aba apenas a intenção Blink validada (`sala`, `perfil` ou aba), com validade curta e consumo único. Reset de senha tem uma rota dedicada e seu token permanece intacto até o Better Auth consumi-lo.

```js
export function firstScreen(href, sessionState) {
  const u = new URL(href, "https://blink.example");
  if (u.pathname === "/" && u.searchParams.has("frame_id")) return { screen: "activity" };
  const pathRoom = /^\/s\/([a-f0-9]{6})\/?$/i.exec(u.pathname);
  const pathProfile = /^\/@([a-z0-9_]{3,20})\/?$/i.exec(u.pathname);
  const code = pathRoom?.[1] ?? u.searchParams.get("sala");
  if (code && /^[a-f0-9]{6}$/i.test(code)) return { screen: "invite", code: code.toUpperCase() };
  const name = pathProfile?.[1] ?? u.searchParams.get("perfil");
  if (name && /^[a-z0-9_]{3,20}$/i.test(name)) return { screen: "profile", username: name.toLowerCase() };
  if (sessionState === "loading") return { screen: "pending" };
  return { screen: sessionState === "authenticated" ? "dashboard" : "welcome" };
}

export function cleanOAuthReturn(href, consumedKeys, siteOrigin) {
  const origin = new URL(siteOrigin).origin;
  const u = new URL(href, origin);
  if (u.origin !== origin || u.pathname.startsWith("//")) return "/";
  for (const name of consumedKeys) {
    if (name !== "sala" && name !== "perfil") u.searchParams.delete(name);
  }
  const query = u.searchParams.toString();
  return u.pathname + (query ? "?" + query : "") + u.hash;
}
```

Normalizar o código para o formato que o servidor já aceita ao enviá-lo. `cleanOAuthReturn` recebe somente as chaves efetivamente consumidas e a origem do app (`location.origin`); a função produz um caminho relativo para `history.replaceState`. O uso de `toString()` resolve a dependência de `URLSearchParams.size` citada no Safari antigo. Uma falha transitória de `/api/me` mostra ação “Tentar de novo”; responder `401` muda a sessão para visitante. [URLSearchParams](https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams/toString)

## Composição visual e interação

| Superfície | Composição | Interação e critério |
|---|---|---|
| Celular 390 × 844 e menor largura de 320 px | Cabeçalho compacto, avatar com nome acessível, player com `aspect-ratio`; CTA de entrada antes dos detalhes. | Na escala padrão, CTA visível na primeira viewport de 390 × 844. A 320 px e com zoom de 200%, preservar leitura e rolagem vertical. |
| Desktop 1366 × 768 | Player e chat lado a lado durante a live; amigos e ação do host no painel. | Foco segue a ordem visual. Abrir o chat não faz remount do elemento de vídeo. |
| Conta | Botão com `aria-expanded` abre uma lista de botões/links comuns, nome e `@`. | Conectar/desvincular Discord, copiar perfil, editar e sair. Escape fecha e devolve foco ao avatar. Não usar `role=menu` sem implementar o modelo de teclado correspondente. |
| Marca e status | Conservar a tipografia do Blink; dedicar uma cor ao “Ao vivo”, outra ao foco. Usar os ícones do sprite para volume, coração e Discord, com nome no botão. | Brilho breve e discreto na entrada, desativado em `prefers-reduced-motion`. Estado sempre tem texto. Esconder “Sem sala” antes de abrir uma live. |
| Prévia pública | Poster leve e vídeo curto de demonstração com `preload="none"`, reprodução opt-in, controles e `playsinline`. | Nenhum nome, contador ou selo sugere que a demonstração é uma transmissão real. Quem economiza dados pode entender a página só com o poster. |
| Rodapé | Versão, ajuda/contato e apoio apenas com destinos configurados. | Versão usa `/version`; o status de conexão vem da própria sessão. Sem polling do banco por visitante. |
| Exclusão de conta | Diálogo nativo `<dialog>` com título, efeito escrito e botão de cancelar em foco inicial. | Tab fica no diálogo, Escape fecha, foco retorna à origem. Para o app preferir alvo de toque de 44 CSS px e contraste mínimo de 4,5:1 no texto normal. [WAI-ARIA APG](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) · [WCAG 2.2](https://www.w3.org/TR/WCAG22/) |

Ações de mídia usam estados do caderno [03_WEBRTC_DO_HOST.md](03_WEBRTC_DO_HOST.md). “Ativar som” aparece por bloqueio de reprodução; “Live sem som” descreve a ausência de track enviada. Renderizar mensagens, nomes e reações como texto. Avisos importantes usam `role="status"` com moderação; não narrar cada reação ou incremento de viewers no leitor de tela.

## Convite, presença e interação social

- **URL pública.** O servidor monta `/s/CODE` a partir de `PUBLIC_URL` canônica e de código validado. Entregar HTML com `og:title`, `og:type`, `og:image` absoluta e `og:url` canônica do convite na primeira resposta HTTP. Usar a mesma imagem e título “Convite para uma transmissão no Blink” para links válidos/encerrados. Sem dados pessoais, screenshot da live ou consulta de presença para o crawler. O bootstrap JS lê o caminho `/s/`; preservar query legada. Usar `Referrer-Policy: no-referrer` e `no-store` no convite. [Open Graph](https://ogp.me/)
- **Compartilhar.** Preferir o compartilhamento nativo quando disponível, com fallback para cópia e campo selecionável. QR usando `qrcode.toCanvas` no navegador; carregar o módulo só quando o painel abrir. Mostrar o link por escrito. Quando encerrar, o QR também sai do DOM. [node-qrcode](https://github.com/soldair/node-qrcode)
- **Lista do host.** Mostrar “Navegador · 3” e “Discord · 2” a partir de conexões confirmadas no servidor. Quando só houver contagem do relay, usar “2 conexões no Discord”. Exibir nomes somente quando conhecidos, autorizados e pertencentes àquela transmissão. Um mesmo usuário com duas abas pode contar duas vezes.
- **Reações.** Começar nos clientes Blink que já têm socket de sinalização admitido. `reaction` leva enum curto, por exemplo `clap`, `laugh`, `heart`; o servidor associa a identidade ao socket e verifica o run. Proposta de janela: até 3 reações em 5 s por conexão. Agrupar animações por 700 ms, manter no máximo 3 grupos visíveis e oferecer modo sem animação. Activity pode permanecer espectadora até ter canal de interação autorizado; a recepção de vídeo não depende desse recurso.
- **Texto consistente.** Usar “você” e o informal já presente em “pra” onde couber. Exemplos finais: “Escolher tela”, “Copiar convite”, “Reconectando à sala”, “Essa transmissão terminou”. O produto não promete qualidade, compatibilidade nem atraso que não consegue medir.

## Extração dos módulos e build

| Módulo sugerido | Dono do estado | Entrada/saída |
|---|---|---|
| `router` / `account` | Rota, sessão e retorno local | Emite intenção de navegação; mudanças de conta refazem o painel sem destruir mídia ativa. |
| `host` / `viewer` | Track, peer, timers e geração da respectiva sessão | `start`, `resume` e `dispose` com cleanup idempotente. |
| `friends` / `chat` | Presença social, mensagens e pedido de entrada | Assinam o transporte existente; usam `AbortSignal` no ciclo de montagem. |
| `invite` | Compartilhar, cópia, QR e preview | Recebe link já validado; não solicita credencial TURN nem importa SDK. |
| `discord/viewer` | SDK, player e controles da Activity | Entrada independente, sem dependência do painel ou de captura do host. |

Primeiro extrair mantendo os nomes públicos dos handlers usados pelo HTML e os listeners atuais cobertos por teste. Depois retirar handlers inline para a CSP do site. Aquecer a importação de captura ao abrir a aba Transmitir, antes do clique que pede permissão. A cada etapa, comparar a jornada de entrada no navegador e no Discord.

No estágio de build do Docker, instalar devDependencies do workspace dono do bundler. Construir em diretório separado de `public/` para evitar referências circulares. Esbuild recebe entradas nomeadas, `bundle:true`, `format:"esm"`, `splitting:true`, `metafile:true`, nomes com `[name]-[hash]` para entry/chunk/asset e loaders para fontes/imagens. Usar o `metafile.outputs` real para montar `entryPoint → URL`, incluindo CSS emitido e imports dinâmicos. Reescrever os dois HTMLs com o manifesto, copiar ícones/PWA e produzir o SW por último. Artefatos de build vão para a imagem final com as dependências de runtime. Testar também os caminhos de workers, CSS `url()` e mapeamento do proxy Discord. [esbuild](https://esbuild.github.io/api/)

## Cache e atualização durante uma live

| Recurso | HTTP | Service worker |
|---|---|---|
| Assets com hash presentes no manifesto | `public, max-age=31536000, immutable` | Cache por versão, apenas lista permitida do próprio domínio. |
| HTML público, manifesto PWA e `/sw.js` | Revalidar (`no-cache`) | Shell offline estático à parte. `/sw.js` conserva a URL estável. |
| `/?frame_id`, `/s/:code`, `/@usuario`, auth/callback, perfil, API, pagamentos | `no-store` nas páginas/retornos sensíveis | Rede direta, antes de qualquer regra de navegação. Nunca guardar convites nem tokens como cache key. |
| `/relay/*`, sinalização, TURN e notificações | Sem cache de conteúdo privado | WS segue no transporte dedicado. Preservar handlers `push`/`notificationclick`; validar destino permitido antes de navegar. |

Publicar manifesto e assets juntos. Incluir no artefato da release os assets da release anterior a partir do artefato de CI, porque o disco do serviço é efêmero. Instalar o novo SW em `waiting`; em live, não forçar `skipWaiting`, `clients.claim()` ou `location.reload()`. Com várias abas, conservar a espera natural até que as páginas controladas fechem, ou coordenar aceite explícito de **todas** as abas ociosas. Sem confirmação de uma aba, adiar. Limpar caches antigos só quando for seguro, limitar a retenção e oferecer recarga após o fim da sessão se um chunk muito antigo não estiver disponível. [Ciclo do service worker](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers)

**Aceite de release.** A versão N inicia uma live e mantém o primeiro player montado enquanto N+1 é publicada. Outra aba abre N+1 ou segue o ciclo de atualização gerenciado pelo navegador. A antiga ainda carrega um chunk tardio e continua transmitindo. Ao encerrar e reabrir, ambas convergem para N+1. Em modo offline o app apresenta indisponibilidade e ajuda, sem reexibir dados privados de outra conta. O relatório inclui teclado, movimento reduzido, contraste, tamanho transferido das duas entradas e a lista real de requests da página de boas-vindas.
