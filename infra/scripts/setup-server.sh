#!/bin/bash
# ============================================================
# Initial Server Setup Script
# Run once on a fresh EC2 instance
# ============================================================

set -euo pipefail

echo "============================================"
echo "  Agritech IoT — Server Setup"
echo "============================================"

# -----------------------------------------------------------
# System updates
# -----------------------------------------------------------
echo "[1/8] Updating system packages..."
apt-get update && apt-get upgrade -y

# -----------------------------------------------------------
# Install Docker
# -----------------------------------------------------------
echo "[2/8] Installing Docker..."
if ! command -v docker &> /dev/null; then
  curl -fsSL https://get.docker.com | sh
  usermod -aG docker ubuntu
  systemctl enable docker
  systemctl start docker
fi

# -----------------------------------------------------------
# Install Docker Compose
# -----------------------------------------------------------
echo "[3/8] Installing Docker Compose..."
if ! command -v docker-compose &> /dev/null; then
  curl -SL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64" \
    -o /usr/local/bin/docker-compose
  chmod +x /usr/local/bin/docker-compose
fi

# -----------------------------------------------------------
# Install monitoring tools
# -----------------------------------------------------------
echo "[4/8] Installing monitoring tools..."
apt-get install -y htop iotop iftop jq curl wget

# Create node_exporter textfile directory
mkdir -p /var/lib/node_exporter/textfile_collector

# -----------------------------------------------------------
# Configure firewall
# -----------------------------------------------------------
echo "[5/8] Configuring firewall..."
apt-get install -y ufw
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow 80/tcp    # HTTP
ufw allow 443/tcp   # HTTPS
ufw allow 1883/tcp  # MQTT
ufw allow 8883/tcp  # MQTT TLS
ufw --force enable

# -----------------------------------------------------------
# Create application directories
# -----------------------------------------------------------
echo "[6/8] Creating application directories..."
mkdir -p /opt/agritech/{logs,scripts,backups,certs,config}
mkdir -p /opt/agritech/docker/{postgres,nginx,emqx,monitoring}
chown -R ubuntu:ubuntu /opt/agritech

# -----------------------------------------------------------
# Configure log rotation
# -----------------------------------------------------------
echo "[7/8] Configuring log rotation..."
cat > /etc/logrotate.d/agritech << 'EOF'
/opt/agritech/logs/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 ubuntu ubuntu
    sharedscripts
    postrotate
        docker kill --signal=USR1 $(docker ps -q) 2>/dev/null || true
    endscript
}
EOF

# -----------------------------------------------------------
# Set up cron jobs
# -----------------------------------------------------------
echo "[8/8] Setting up cron jobs..."
cat > /tmp/agritech-cron << 'EOF'
# Database backup — daily at 3 AM ICT
0 3 * * * /opt/agritech/scripts/backup.sh >> /opt/agritech/logs/backup.log 2>&1

# Docker cleanup — weekly
0 4 * * 0 docker system prune -f >> /opt/agritech/logs/docker-cleanup.log 2>&1

# SSL certificate renewal check — daily
0 6 * * * /opt/agritech/scripts/check-ssl.sh >> /opt/agritech/logs/ssl-check.log 2>&1
EOF

crontab -u ubuntu /tmp/agritech-cron
rm /tmp/agritech-cron

echo ""
echo "============================================"
echo "  Setup Complete!"
echo "============================================"
echo ""
echo "Next steps:"
echo "  1. Copy docker-compose.prod.yml to /opt/agritech/"
echo "  2. Copy .env file to /opt/agritech/"
echo "  3. Copy SSL certificates to /opt/agritech/certs/"
echo "  4. Run: cd /opt/agritech && docker-compose -f docker-compose.prod.yml up -d"
echo ""
echo "Server is ready for deployment."
