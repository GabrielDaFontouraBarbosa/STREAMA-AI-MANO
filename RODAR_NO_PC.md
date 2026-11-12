# Rodar o Blink no seu PC (de graça)

O seu PC vira o servidor. Um túnel grátis da Cloudflare dá um link
`https://...trycloudflare.com` que funciona de qualquer lugar. As contas ficam
salvas num Postgres que roda junto, dentro do Docker.

## Uma vez só

1. Instale o **Docker Desktop**: https://www.docker.com/products/docker-desktop/
   (no Windows ele pode pedir pra ativar o WSL2 e reiniciar).
2. Baixe este repositório (botão **Code → Download ZIP** no GitHub, ou `git clone`).

Não precisa criar `.env`: o segredo de login é gerado sozinho na primeira vez.

## Toda vez que for usar

1. Abra o Docker Desktop e espere ele ficar verde.
2. Dê dois cliques em **`iniciar.bat`** (no Mac/Linux: `docker compose up -d --build`
   e depois `docker compose logs app`).
3. Vai aparecer:

   ```
   Link pra mandar pra sua namorada: https://palavras-aleatorias.trycloudflare.com
   ```

   Abra esse link você também (não use `localhost`) e mande pra ela.
4. Pra desligar: **`parar.bat`** (ou `docker compose down`).

## Bom saber

- **O link muda toda vez que você liga.** As contas continuam, mas vocês vão
  precisar entrar de novo, porque o login fica preso ao endereço antigo.
- O app só funciona com o PC ligado e o Docker aberto.
- O vídeo vai direto de um navegador pro outro (WebRTC). Se não conectar em
  alguma rede (comum em 4G), configure o TURN grátis da Cloudflare: crie um
  arquivo `.env` ao lado do `docker-compose.yml` com `CLOUDFLARE_TURN_KEY_ID` e
  `CLOUDFLARE_TURN_API_TOKEN` (veja `.env.example`) e rode o `iniciar.bat` de novo.
- **Nunca** rode `docker compose down -v`: o `-v` apaga o banco com as contas.
