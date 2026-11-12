# Blink na Oracle Cloud (grátis)

Site + banco + bot do Discord numa VM "Always Free", 24h, sem pagar.
HTTPS automático com um domínio grátis do tipo `129-1-2-3.sslip.io`.

## 1. Criar a conta

1. https://www.oracle.com/cloud/free → **Start for free**.
2. Pede cartão só pra verificar (cobra e devolve ~US$ 1). Contas Always Free
   não são cobradas — só não clique em "Upgrade to Pay As You Go".
3. **Home Region**: escolha **Brazil East (São Paulo)** (ou a mais perto).
   Não dá pra trocar depois.

## 2. Criar a VM

Menu ☰ → **Compute → Instances → Create instance**.

| Campo | O que escolher |
|---|---|
| Image | **Canonical Ubuntu 24.04** |
| Shape | **Ampere → VM.Standard.A1.Flex**, 1 OCPU, 6 GB RAM (grátis). Se der "out of capacity", use **VM.Standard.E2.1.Micro** (também grátis) |
| Networking | deixa criar a VCN nova, com **Assign public IPv4 address** ligado |
| SSH keys | **Generate a key pair for me** → **Save private key** (guarde o arquivo `.key`!) |

Clique **Create** e anote o **Public IP address**.

## 3. Liberar as portas 80 e 443 no painel

Na página da instância → clique na **Subnet** → **Security Lists** →
**Default Security List** → **Add Ingress Rules**:

| Source CIDR | IP Protocol | Destination Port |
|---|---|---|
| `0.0.0.0/0` | TCP | `80,443` |
| `0.0.0.0/0` | UDP | `443` |

(O firewall de dentro da VM o `setup.sh` libera sozinho.)

## 4. Entrar na VM

No terminal do VS Code (PowerShell no Windows):

```bash
ssh -i C:\caminho\da\chave.key ubuntu@SEU_IP
```

Se reclamar de permissão da chave no Windows: botão direito no `.key` →
Propriedades → Segurança → deixe só o seu usuário com acesso.

## 5. Instalar o Blink

Dentro da VM:

```bash
git clone -b claude/modest-bohr-o7jvjg https://github.com/GabrielDaFontouraBarbosa/STREAMA-AI-MANO.git blink
```

> Repositório privado? O GitHub vai pedir usuário e senha: a "senha" é um
> token de github.com/settings/tokens (escopo `repo`).

```bash
bash blink/deploy/oracle/setup.sh
```

Ele instala o Docker, libera o firewall, pergunta o **token do bot** (e o
TURN da Cloudflare, opcional), gera todos os segredos e sobe tudo. No fim
mostra o endereço: `https://SEU-IP.sslip.io`.

O bot liga junto — veja o link de convite nos logs:

```bash
cd ~/blink/deploy/oracle && sudo docker compose logs app | grep -A1 "Bot do Discord"
```

## Dia a dia

| Quero… | Comando (dentro de `~/blink/deploy/oracle`) |
|---|---|
| ver logs | `sudo docker compose logs -f app` |
| atualizar depois de um push | `bash update.sh` |
| reiniciar | `sudo docker compose restart app` |
| mudar o token / variáveis | `nano .env` e depois `sudo docker compose up -d app` |
| backup do banco | `sudo docker compose exec db pg_dump -U blink blink > backup.sql` |

Se a VM reiniciar, os containers voltam sozinhos.

## Trazer os dados do Railway (opcional)

Com a `DATABASE_PUBLIC_URL` do Postgres do Railway, dentro da VM:

```bash
cd ~/blink/deploy/oracle
sudo docker run --rm postgres:alpine pg_dump "COLE_A_DATABASE_PUBLIC_URL" --no-owner --no-acl --clean --if-exists | sudo docker compose exec -T db psql -U blink blink
```

```bash
sudo docker compose restart app
```

Depois disso pode desligar o Railway. Tire o `DISCORD_TOKEN` de lá se tiver
colocado — senão os avisos saem em dobro.

## Problemas comuns

- **Site não abre**: confira as regras do passo 3. Teste `curl -I http://SEU_IP` de fora.
- **Certificado não sai**: o Caddy precisa da porta 80 aberta. `sudo docker compose logs caddy`.
- **"Out of host capacity" ao criar a VM**: tente outro *Availability Domain*, ou o shape E2.1.Micro, ou tente de novo mais tarde.
- **Oracle desligou a VM por ociosidade**: contas grátis com uso muito baixo podem ser recuperadas. Usar o Blink normalmente costuma bastar; se acontecer, é só iniciar a instância de novo no painel (os dados ficam).
