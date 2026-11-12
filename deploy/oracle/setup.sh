#!/usr/bin/env bash
# Prepara uma VM Ubuntu da Oracle Cloud e sobe o Blink + bot.
# Rode de dentro do projeto clonado:   bash deploy/oracle/setup.sh
# Pode rodar de novo quantas vezes quiser — ele não apaga nada.
set -euo pipefail
cd "$(dirname "$0")"

say() { printf '\n\033[1;35m▶ %s\033[0m\n' "$*"; }

# 1) Docker
if ! command -v docker >/dev/null; then
  say "Instalando Docker"
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
fi
DOCKER="docker"; docker info >/dev/null 2>&1 || DOCKER="sudo docker"

# 2) Swap (a VM de 1 GB de RAM trava no build sem isso)
if [ "$(free -m | awk '/Mem:/{print $2}')" -lt 3000 ] && ! swapon --show | grep -q /swapfile; then
  say "Criando 2 GB de swap"
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
  sudo mkswap /swapfile >/dev/null && sudo swapon /swapfile
  grep -q /swapfile /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

# 3) Firewall da própria VM (as imagens Ubuntu da Oracle bloqueiam tudo
#    menos a 22). A "Security List" do painel é outra — veja o guia.
say "Liberando portas 80 e 443 no firewall da VM"
for p in 80 443; do
  sudo iptables -C INPUT -p tcp --dport $p -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 1 -p tcp --dport $p -j ACCEPT
done
sudo iptables -C INPUT -p udp --dport 443 -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 1 -p udp --dport 443 -j ACCEPT
if command -v netfilter-persistent >/dev/null; then sudo netfilter-persistent save >/dev/null
else sudo DEBIAN_FRONTEND=noninteractive apt-get install -y iptables-persistent >/dev/null && sudo netfilter-persistent save >/dev/null; fi

# 4) .env (só na primeira vez)
if [ ! -f .env ]; then
  say "Criando o .env"
  IP=$(curl -fsS https://api.ipify.org)
  DOMAIN="${IP//./-}.sslip.io"   # domínio grátis que aponta pro seu IP, sem cadastro
  read -rp "Token do bot do Discord (Enter pra pular): " -s DISCORD_TOKEN; echo
  read -rp "Cloudflare TURN Key ID (Enter pra pular): " TURN_ID
  TURN_TOKEN=""; [ -n "$TURN_ID" ] && { read -rp "Cloudflare TURN API Token: " -s TURN_TOKEN; echo; }
  VAPID=$($DOCKER run --rm node:22-alpine npx -y web-push generate-vapid-keys --json)
  VAPID_PUB=$(echo "$VAPID" | sed -E 's/.*"publicKey":"([^"]+)".*/\1/')
  VAPID_PRIV=$(echo "$VAPID" | sed -E 's/.*"privateKey":"([^"]+)".*/\1/')
  umask 077
  cat > .env <<ENV
DOMAIN=$DOMAIN
PUBLIC_URL=https://$DOMAIN
POSTGRES_PASSWORD=$(openssl rand -hex 24)
BETTER_AUTH_SECRET=$(openssl rand -base64 32)
VAPID_PUBLIC_KEY=$VAPID_PUB
VAPID_PRIVATE_KEY=$VAPID_PRIV
VAPID_SUBJECT=mailto:admin@$DOMAIN
CLOUDFLARE_TURN_KEY_ID=$TURN_ID
CLOUDFLARE_TURN_API_TOKEN=$TURN_TOKEN
DISCORD_TOKEN=$DISCORD_TOKEN
ENV
fi

# 5) Sobe tudo
say "Subindo o Blink (o primeiro build leva alguns minutos)"
$DOCKER compose up -d --build

DOMAIN=$(grep '^DOMAIN=' .env | cut -d= -f2)
say "Pronto! Abra https://$DOMAIN"
echo "  Logs:       $DOCKER compose -f $(pwd)/docker-compose.yml logs -f app"
echo "  Atualizar:  bash $(pwd)/update.sh"
