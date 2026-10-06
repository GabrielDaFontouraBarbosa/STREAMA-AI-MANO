# Deploy no Railway — Passo a Passo

## O que é Railway?
Platform-as-a-Service (PaaS) que hospeda aplicações Node.js, Python, etc. Tem free tier que funciona tranquilo pra apps pequenos como esse.

## Pré-requisitos
- Conta GitHub (gratuita)
- Conta Railway (conecta via GitHub, sem custo)

## Instruções

### 1. Criar conta no Railway
- Vai em [railway.app](https://railway.app)
- Clica **"Login with GitHub"** e autoriza

### 2. Subir o código pro GitHub

Abre o terminal na pasta `streama-ai-mano` e roda:

```bash
git remote add origin https://github.com/SEU-USUARIO/streama-ai-mano.git
git branch -M main
git push -u origin main
```

(Substitui `SEU-USUARIO` pelo seu username no GitHub)

Ou, se preferir, clica em "+ New" no GitHub e cria um novo repo chamado `streama-ai-mano`, aí copia os comandos que ele sugere.

### 3. Fazer deploy no Railway

- Volta em [railway.app](https://railway.app)
- Clica **"New Project"**
- Clica **"Deploy from GitHub repo"**
- Seleciona `seu-usuario/streama-ai-mano`
- Railway detecta que é Node.js e faz o deploy automaticamente

### 4. Pegar a URL pública

Depois que o deploy termina (uns 2-5 minutos):
- Clica no projeto
- Vai em "Settings" ou "View Domain"
- Copia a URL tipo `https://seu-app-random.railway.app`

### 5. Compartilhar

Manda essa URL pra galera:
```
https://seu-app-random.railway.app
```

Pronto! Qualquer um que clica nessa URL consegue:
- Na aba "Transmitir": compartilhar a tela
- Na aba "Assistir": entrar com o código da sala

## Troubleshooting

**"Failed to deploy"**
- Verifica se o `Procfile` tá na raiz da pasta
- Verifica se o `server/package.json` tá lá

**"App sleeping / waking up"**
- Railway dorme apps free tier inativo, mas acorda quando alguém acessa
- Primeira vez pode demorar uns 10-15s pra acordar, depois é rápido

**"Não consegue conectar WebSocket"**
- Railway força HTTPS/WSS
- A página já vem configurada pra detectar automaticamente (`wss://` se for HTTPS)
- Se der erro, manda mensagem

## Custos

- **Free tier:** Até 500 horas/mês de uso (mais que suficiente pra uso casual)
- **Depois:** Pode pagar conforme usa, ou pausar o projeto

Não precisa de cartão de crédito pra começar! 🎉
