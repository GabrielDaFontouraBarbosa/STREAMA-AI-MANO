# Blink

Página web (sem instalar nada) que transmite sua tela pra vários amigos ao
mesmo tempo via WebRTC. Você e seus amigos abrem a mesma URL — uma aba
"Transmitir" e outra "Assistir".

## Estrutura

- `server/` — um único processo Node.js que serve a página (`public/`) E faz
  a sinalização por WebSocket na mesma porta. Só troca mensagens de handshake
  do WebRTC (offer/answer/ICE); o vídeo nunca passa por ele.
- `public/` — a página com as abas "Transmitir" e "Assistir". Usa
  `getDisplayMedia()`, a API nativa do navegador pra capturar tela — não
  precisa de Electron nem de instalar nada.
- `host-app/` e `viewer/` — versão antiga (Electron + arquivo HTML solto).
  Ficou aqui só de histórico; não é mais necessário rodar.

## Como rodar (teste local, todos na mesma rede)

```bash
cd server
npm install
npm start
```

Abra `http://localhost:8080` no navegador. Na aba "Transmitir", clique em
"Selecionar tela e transmitir" — o próprio navegador vai perguntar qual
tela/janela/aba compartilhar. Vai aparecer um código de sala (ex: `F4K9QZ`).

Seus amigos abrem a mesma URL (`http://<seu-ip-na-rede>:8080` se estiverem em
outro PC na mesma Wi-Fi), vão na aba "Assistir", digitam o código e clicam em
"Entrar".

## Deploy no Railway (funcionando pela internet)

Pra sua colega transmitir de qualquer lugar (não só na mesma rede), hospeda o
servidor no Railway (free tier):

### Passo a passo:

1. Acessa [railway.app](https://railway.app) e clica "Login with GitHub"
2. Clica "New Project" → "Deploy from GitHub repo"
   - Se você não tiver um repo GitHub, clica "Deploy from GitHub repo" mesmo assim
   - Ou cria um repo rápido com:
     ```bash
     git init
     git add .
     git commit -m "Initial commit"
     ```
     E depois conecta no GitHub
3. Seleciona este repositório
4. Railway detecta que é Node.js — confirma e ativa
5. Vai gerar um domínio tipo `https://seu-app-random.railway.app`

### Depois que tá rodando no Railway:

Na página do app, a URL muda de `ws://localhost:8080` pra `wss://seu-app-random.railway.app`.
No navegador, você usa: `https://seu-app-random.railway.app`

**Compartilha essa URL** (`https://...`, não `ws://...`) com a galera — todo mundo
que clicar lá consegue transmitir e assistir de qualquer lugar do mundo.

**Nota:** O free tier do Railway dorme o app depois de inatividade, mas acorda
na hora que alguém acessa. Funciona tranquilo pra usar esporadicamente.

## Limitações desse esqueleto

- Sem áudio (só vídeo da tela). Pra incluir áudio, dá pra pedir
  `getDisplayMedia({ video: true, audio: true })` — no Chrome/Edge no Windows,
  ao compartilhar a tela inteira aparece a opção "Compartilhar áudio do
  sistema" no seletor nativo.
- Sem autenticação — qualquer um com o código entra na sala. Fácil de
  adicionar uma senha simples se quiser.
- Testado conceitualmente, não rodado de ponta a ponta aqui — revise antes de
  usar em produção.
