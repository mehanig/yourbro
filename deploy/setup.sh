#!/usr/bin/env bash
set -euo pipefail

# First-time VPS provisioning for yourbro.ai
# Run as root on a fresh Ubuntu/Debian VPS

DOMAIN="${DOMAIN:-yourbro.ai}"

echo "==> Installing Docker"
curl -fsSL https://get.docker.com | sh

echo "==> Installing Docker Compose plugin"
apt-get install -y docker-compose-plugin

echo "==> Creating yourbro user"
if ! id -u yourbro &>/dev/null; then
    useradd -m -s /bin/bash -G docker yourbro
fi

echo "==> Setting up UFW firewall"
apt-get install -y ufw
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP
ufw allow 443/tcp   # HTTPS
ufw --force enable

echo "==> Installing certbot"
apt-get install -y certbot
certbot certonly --standalone -d "$DOMAIN" --non-interactive --agree-tos --email "admin@$DOMAIN"

echo "==> Setting up .env"
if [ ! -f .env ]; then
    cp .env.example .env
    JWT_SECRET=$(openssl rand -hex 32)
    INTERNAL_KEY=$(openssl rand -hex 32)
    POSTGRES_PASS=$(openssl rand -hex 16)
    sed -i "s/JWT_SECRET=CHANGE_ME/JWT_SECRET=$JWT_SECRET/" .env
    sed -i "s/YOURBRO_INTERNAL_KEY=CHANGE_ME/YOURBRO_INTERNAL_KEY=$INTERNAL_KEY/" .env
    sed -i "s/POSTGRES_PASSWORD=CHANGE_ME/POSTGRES_PASSWORD=$POSTGRES_PASS/" .env
    sed -i "s|postgres://yourbro:CHANGE_ME@|postgres://yourbro:$POSTGRES_PASS@|" .env
    echo "==> Generated secrets in .env — fill in GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET"
else
    echo "==> .env already exists, skipping"
fi

echo "==> Setup complete. Run deploy/deploy.sh to start services."
