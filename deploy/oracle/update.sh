#!/usr/bin/env bash
# Puxa o código novo do GitHub e reconstrói o app (banco e certificados ficam).
set -euo pipefail
cd "$(dirname "$0")"
git -C ../.. pull --ff-only
DOCKER="docker"; docker info >/dev/null 2>&1 || DOCKER="sudo docker"
$DOCKER compose up -d --build app
$DOCKER image prune -f >/dev/null
echo "Atualizado."
