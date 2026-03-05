#!/usr/bin/env bash
set -euo pipefail

# First-time VPS provisioning for yourbro.ai
# Run as root on a fresh Ubuntu 24.04 VPS
#
# Prerequisites:
#   - DNS: yourbro.ai A record pointed to this server's IP
#   - Google OAuth credentials ready
#
# Usage: bash setup.sh

DOMAIN="${DOMAIN:-yourbro.ai}"
DEPLOY_DIR="/opt/yourbro"

echo "==> Installing Docker"
curl -fsSL https://get.docker.com | sh

echo "==> Setting up UFW firewall"
apt-get install -y ufw
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP (redirect + ACME)
ufw allow 443/tcp   # HTTPS
ufw --force enable

echo "==> Installing certbot"
apt-get install -y certbot
certbot certonly --standalone -d "$DOMAIN" --non-interactive --agree-tos --email "admin@$DOMAIN"

# Set up auto-renewal
echo "0 3 * * * certbot renew --quiet --deploy-hook 'docker restart yourbro-nginx-1 2>/dev/null || true'" | crontab -
echo "==> Certbot auto-renewal configured (daily at 3am)"

echo "==> Setting up deploy directory"
mkdir -p "$DEPLOY_DIR/nginx"

# Generate .env with random secrets
if [ ! -f "$DEPLOY_DIR/.env" ]; then
    JWT_SECRET=$(openssl rand -hex 32)
    INTERNAL_KEY=$(openssl rand -hex 32)
    POSTGRES_PASS=$(openssl rand -hex 16)

    cat > "$DEPLOY_DIR/.env" <<EOF
DATABASE_URL=postgres://yourbro:${POSTGRES_PASS}@postgres:5432/yourbro?sslmode=disable
POSTGRES_PASSWORD=${POSTGRES_PASS}
JWT_SECRET=${JWT_SECRET}
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URL=https://${DOMAIN}/auth/google/callback
FRONTEND_URL=https://${DOMAIN}
YOURBRO_INTERNAL_KEY=${INTERNAL_KEY}
DOMAIN=${DOMAIN}
EOF

    echo "==> Generated .env with random secrets"
    echo "==> IMPORTANT: Edit $DEPLOY_DIR/.env and fill in GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET"
else
    echo "==> .env already exists, skipping"
fi

# Copy certbot certs into Docker volume
# (certbot runs standalone, but nginx reads from Docker volume)
echo "==> Copying SSL certificates to Docker volume"
docker volume create yourbro_certbot-etc 2>/dev/null || true
docker run --rm -v yourbro_certbot-etc:/certs -v /etc/letsencrypt:/host-certs:ro alpine \
    sh -c "cp -rL /host-certs/* /certs/"

# Login to Azure Container Registry
echo "==> Docker login to Azure Container Registry"
echo "    You need the AZ_REGISTRY_PASSWORD from your Azure portal or GitHub secrets."
read -rsp "Enter mehanig.azurecr.io password: " ACR_PASS
echo ""
docker login mehanig.azurecr.io -u mehanig -p "$ACR_PASS"

echo ""
echo "========================================="
echo "  Setup complete!"
echo "========================================="
echo ""
echo "Next steps:"
echo "  1. Edit $DEPLOY_DIR/.env — fill in GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET"
echo "  2. Copy docker-compose.yml, nginx/nginx.conf, and deploy.sh to $DEPLOY_DIR/"
echo "  3. Run: cd $DEPLOY_DIR && bash deploy.sh"
echo ""
