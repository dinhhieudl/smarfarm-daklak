#!/bin/bash
# User data script for EC2 application instances
set -euo pipefail

# Update system
apt-get update && apt-get upgrade -y

# Install Docker
curl -fsSL https://get.docker.com | sh
usermod -aG docker ubuntu

# Install Docker Compose
curl -SL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64" \
  -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose

# Install CloudWatch agent
wget https://s3.amazonaws.com/amazoncloudwatch-agent/ubuntu/amd64/latest/amazon-cloudwatch-agent.deb
dpkg -i amazon-cloudwatch-agent.deb

# Configure CloudWatch agent
cat > /opt/aws/amazon-cloudwatch-agent/etc/config.json << 'EOF'
{
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [
          {
            "file_path": "/var/log/docker/*.log",
            "log_group_name": "/agritech/${environment}/docker",
            "log_stream_name": "{instance_id}"
          },
          {
            "file_path": "/opt/agritech/logs/*.log",
            "log_group_name": "/agritech/${environment}/app",
            "log_stream_name": "{instance_id}"
          }
        ]
      }
    }
  },
  "metrics": {
    "metrics_collected": {
      "disk": {
        "measurement": ["used_percent"],
        "resources": ["*"]
      },
      "mem": {
        "measurement": ["mem_used_percent"]
      }
    }
  }
}
EOF

# Start CloudWatch agent
/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
  -a fetch-config -m ec2 \
  -c file:/opt/aws/amazon-cloudwatch-agent/etc/config.json -s

# Create app directory
mkdir -p /opt/agritech/logs
chown -R ubuntu:ubuntu /opt/agritech

# Set hostname
hostnamectl set-hostname "${project_name}-${environment}-app"

echo "User data script completed successfully"
