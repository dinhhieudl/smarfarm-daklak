# IoT AgriTech Platform — Infrastructure

## Quick Start

### Prerequisites
- AWS CLI configured with appropriate IAM permissions
- Terraform >= 1.5.0
- Docker & Docker Compose
- Go 1.22+ (for building services)

### 1. Provision Infrastructure (Terraform)
```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your values

terraform init
terraform plan
terraform apply
```

### 2. Configure Server
```bash
# SSH to EC2 instance via SSM
aws ssm start-session --target <instance-id>

# Run setup script
bash /opt/agritech/scripts/setup-server.sh
```

### 3. Deploy Services (Docker Compose)
```bash
cd /opt/agritech
cp .env.example .env
# Edit .env with your values

docker compose -f docker-compose.prod.yml up -d
```

### 4. Verify
```bash
# Check all services
docker compose -f docker-compose.prod.yml ps

# Test API
curl https://api.agritech.vn/health

# Test MQTT (requires mosquitto-clients)
mosquitto_sub -h mqtt.agritech.vn -p 8883 --cafile ca.crt \
  -u "device-001" -P "token" -t "sensors/+/data"
```

---

## Directory Structure
```
infra/
├── README.md                          # This file
├── terraform/                         # Infrastructure as Code
│   ├── main.tf                        # VPC, EC2, RDS, S3, ALB, CloudWatch
│   ├── variables.tf                   # Input variables
│   ├── outputs.tf                     # Output values
│   ├── terraform.tfvars.example       # Example variable values
│   └── templates/
│       └── user_data.sh               # EC2 bootstrap script
├── docker/                            # Docker Compose configs
│   ├── docker-compose.prod.yml        # Production services
│   ├── .env.example                   # Environment variables
│   ├── postgres/
│   │   ├── init.sql                   # Database schema (TimescaleDB)
│   │   └── timescaledb.conf           # PostgreSQL tuning
│   ├── nginx/
│   │   └── nginx.conf                 # Reverse proxy & TLS
│   └── emqx/
│       └── emqx.conf                  # MQTT broker config
├── github-actions/                    # CI/CD Pipelines
│   ├── ci.yml                         # Build, test, push
│   └── deploy.yml                     # Deploy to production
├── monitoring/                        # Observability
│   ├── prometheus.yml                 # Prometheus config
│   ├── alert_rules.yml                # Alert definitions
│   └── grafana/
│       ├── provisioning/
│       │   ├── datasources.yml        # Grafana datasources
│       │   └── dashboards.yml         # Dashboard provisioning
│       └── dashboards/
│           └── overview.json          # Main dashboard
├── scripts/                           # Operational scripts
│   ├── backup.sh                      # Database backup
│   ├── restore.sh                     # Database restore
│   └── setup-server.sh               # Server initialization
└── docs/                              # Documentation
    ├── ARCHITECTURE.md                # System architecture
    ├── CLOUD-PROVIDER-ANALYSIS.md     # Provider comparison
    ├── COST-ESTIMATION.md             # Cost breakdown
    └── SECURITY.md                    # Security & compliance
```

---

## Key Design Decisions

### Why AWS Singapore (not Vietnamese cloud)?
1. **Managed services**: RDS Aurora Serverless handles TimescaleDB scaling
2. **Reliability**: 99.99% SLA vs limited SLAs from VN providers
3. **Team size**: 2-3 devs can't manage self-hosted infrastructure
4. **Latency**: ~30ms from DakLak is acceptable for 5-min batch syncs
5. **Cost**: Cheaper than self-hosted when factoring in ops overhead

### Why Docker Compose (not Kubernetes)?
1. **Simplicity**: 2-3 person team doesn't need K8s complexity
2. **Cost**: No EKS/GKE cluster fees (~$73/month saved)
3. **Scale**: Docker Compose handles 500+ farms easily on 1-2 EC2 instances
4. **Migration path**: Can move to K8s later if needed

### Why EMQX (not AWS IoT Core)?
1. **Cost**: EMQX is free (open source) vs AWS IoT Core ($1/Million messages)
2. **Control**: Full control over MQTT broker configuration
3. **Flexibility**: Custom authentication, ACLs, plugins
4. **Portability**: Not locked to AWS

### Why TimescaleDB (not InfluxDB)?
1. **SQL**: Team already knows PostgreSQL/SQL
2. **Ecosystem**: Rich PostgreSQL tooling (pgAdmin, backups, etc.)
3. **Compression**: 10-20x compression on time-series data
4. **Continuous aggregates**: Pre-computed hourly/daily views
5. **Retention policies**: Auto-cleanup of old data
6. **Cost**: Free (open source) vs InfluxDB Enterprise

---

## Operations Guide

### Daily Tasks (Automated)
- Database backup: 3 AM (cron)
- Log rotation: Daily
- Docker cleanup: Weekly (Sunday 4 AM)

### Manual Tasks
- Monitor Grafana dashboards
- Review CloudWatch alerts
- Check device sync status
- Review security alerts

### Scaling Guide

#### Vertical Scaling (Phase 1 → 2)
```bash
# Upgrade EC2 instance type
# t3.medium → t3.large → t3.xlarge
# No code changes needed
```

#### Horizontal Scaling (Phase 2 → 3)
```bash
# Add EC2 instances behind ALB
# Add RDS read replicas
# Add Redis cache layer
# Consider moving to ECS/EKS
```

---

## Troubleshooting

### Device Can't Connect to MQTT
```bash
# Check EMQX logs
docker logs agritech-emqx --tail=100

# Test authentication
mosquitto_pub -h mqtt.agritech.vn -p 8883 --cafile ca.crt \
  -u "device-001" -P "token" -t "test" -m "hello"

# Check device token in database
psql -c "SELECT * FROM device_auth WHERE username = 'device-001';"
```

### Database Performance Issues
```sql
-- Check slow queries
SELECT query, calls, mean_exec_time, total_exec_time
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 10;

-- Check hypertable size
SELECT hypertable_name, 
       pg_size_pretty(hypertable_size(format('%I.%I', hypertable_schema, hypertable_name)::regclass))
FROM timescaledb_information.hypertables;

-- Check compression status
SELECT hypertable_name, 
       pg_size_pretty(before_compression_total_bytes) as before,
       pg_size_pretty(after_compression_total_bytes) as after
FROM timescaledb_information.compressed_chunk_stats;
```

### Ingestion Worker Issues
```bash
# Check worker logs
docker logs agritech-ingestion-worker --tail=100

# Check metrics
curl http://localhost:8080/metrics | grep agritech

# Restart worker
docker compose -f docker-compose.prod.yml restart ingestion-worker
```

---

## Support

For infrastructure issues:
1. Check Grafana dashboards for anomalies
2. Review CloudWatch logs for errors
3. Check alert rules in Prometheus
4. Review this documentation

For code issues:
1. Check GitHub Actions CI/CD status
2. Review application logs
3. Run tests locally
4. Check database migrations
