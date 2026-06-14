# Security & Compliance — IoT AgriTech Platform

## Network Security

### VPC Architecture
```
Internet
    │
    ▼
┌─────────────────────────────────────────┐
│  Public Subnet (10.0.1.0/24)            │
│  ┌─────────────────────────────────┐    │
│  │  ALB (TLS termination)          │    │
│  │  - Port 443 (HTTPS)             │    │
│  │  - Port 8883 (MQTT TLS)         │    │
│  └─────────────────────────────────┘    │
│  ┌─────────────────────────────────┐    │
│  │  NAT Gateway                    │    │
│  └─────────────────────────────────┘    │
└─────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────┐
│  Private Subnet — App (10.0.2.0/24)     │
│  ┌─────────────────────────────────┐    │
│  │  EMQX (MQTT Broker)             │    │
│  │  Go Workers                     │    │
│  │  Nginx                          │    │
│  │  Prometheus + Grafana           │    │
│  └─────────────────────────────────┘    │
└─────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────┐
│  Private Subnet — DB (10.0.3.0/24)      │
│  ┌─────────────────────────────────┐    │
│  │  TimescaleDB (Aurora)           │    │
│  │  - Only accessible from App SG  │    │
│  └─────────────────────────────────┘    │
└─────────────────────────────────────────┘
```

### Security Groups (Firewall Rules)
| Source | Destination | Port | Protocol | Purpose |
|--------|-------------|------|----------|---------|
| Internet | ALB | 443 | TCP | HTTPS API |
| Internet | ALB | 8883 | TCP | MQTT TLS |
| ALB | App Servers | 8080-8081 | TCP | API traffic |
| App Servers | Database | 5432 | TCP | PostgreSQL |
| App Servers | S3 | 443 | TCP | Data archive |
| VPC CIDR | All | 22 | TCP | SSH (bastion only) |

---

## Encryption

### At Rest
| Component | Encryption Method |
|-----------|------------------|
| RDS (TimescaleDB) | AES-256 (AWS KMS) |
| S3 (data archive) | AES-256 (AWS KMS) |
| EBS volumes | AES-256 (AWS KMS) |
| Secrets Manager | AES-256 (AWS KMS) |
| Backups | AES-256 (AWS KMS) |

### In Transit
| Connection | Method |
|------------|--------|
| Device → MQTT | TLS 1.2+ (port 8883) |
| Device → HTTPS | TLS 1.3 (port 443) |
| Nginx → API | HTTP (internal network) |
| API → Database | TLS (sslmode=require) |
| EMQX → Database | TLS (sslmode=require) |

---

## Device Authentication

### MQTT Authentication Flow
```
1. Device connects to EMQX on port 8883 (TLS)
2. Device sends username (device serial) + password (API token)
3. EMQX validates against device_auth table in PostgreSQL
4. On success: connection established
5. On failure: connection rejected, logged
```

### Device Token Management
```sql
-- Device authentication table
CREATE TABLE device_auth (
    username        VARCHAR(100) PRIMARY KEY,
    password_hash   VARCHAR(255) NOT NULL,  -- bcrypt hash
    device_id       UUID REFERENCES devices(id),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    last_used_at    TIMESTAMPTZ,
    is_active       BOOLEAN DEFAULT true
);

-- Device ACL (topic-level authorization)
CREATE TABLE device_acl (
    clientid        VARCHAR(100) NOT NULL,
    permission      VARCHAR(10) NOT NULL,  -- publish, subscribe
    topic           VARCHAR(255) NOT NULL,
    PRIMARY KEY (clientid, permission, topic)
);
```

### Token Rotation Policy
- Tokens are generated during device provisioning
- Stored as bcrypt hashes in database
- Rotated every 90 days (configurable)
- Revoked tokens are immediately disconnected
- Emergency revocation via admin API

### HTTPS Fallback Authentication
```
POST /sync/data
Authorization: Bearer <JWT token>
Content-Type: application/json

{
  "device_id": "uuid",
  "readings": [...]
}
```

---

## Backup Strategy

### Automated Backups
| Backup Type | Frequency | Retention | Location |
|-------------|-----------|-----------|----------|
| RDS Automated | Daily (3 AM) | 14 days | AWS (same region) |
| RDS Snapshots | Weekly | 30 days | AWS (same region) |
| pg_dump | Daily | 14 days local, 30 days S3 | S3 (Glacier after 90 days) |
| S3 Versioning | Continuous | 2 years | S3 (same region) |

### Backup Verification
- Automated restore test: Monthly (via CI/CD)
- Manual restore test: Quarterly
- RTO (Recovery Time Objective): 4 hours
- RPO (Recovery Point Objective): 24 hours

### Cross-Region Backup (Future)
For disaster recovery, consider replicating to ap-southeast-2 (Jakarta):
```bash
# S3 cross-region replication
aws s3api put-bucket-replication \
  --bucket agritech-data-archive-production \
  --replication-configuration file://replication-config.json
```

---

## Vietnamese Data Compliance

### Decree 13/2023/ND-CP (Data Protection)
- **Scope**: Personal data of Vietnamese citizens
- **Requirement**: Personal data must be stored in Vietnam
- **Our data**: Agricultural sensor data (non-personal) — generally exempt
- **PII collected**: Farmer name, phone, email — must comply

### Compliance Strategy
```
┌─────────────────────────────────────────────────┐
│  Data Classification                            │
├─────────────────────────────────────────────────┤
│  Sensor Data (temp, moisture, etc.)             │
│  → Non-personal → Can store on AWS Singapore    │
│                                                 │
│  Farmer PII (name, phone, email)                │
│  → Personal → Store in Vietnam (VNG Cloud)      │
│  → Encrypt at rest                              │
│  → Access logs required                         │
│                                                 │
│  Aggregated Analytics                           │
│  → Non-personal → Can store on AWS Singapore    │
└─────────────────────────────────────────────────┘
```

### Implementation
1. **Database schema**: Separate PII tables from sensor data
2. **VNG Cloud**: Host PII database in Vietnam
3. **Cross-reference**: API joins PII (VN) with sensor data (AWS) at query time
4. **Audit logs**: All PII access logged and retained

### Data Subject Rights (Decree 13)
- Right to access: API endpoint for farmers to view their data
- Right to delete: Automated data deletion workflow
- Right to data portability: Export in JSON/CSV format
- Consent management: Opt-in for data collection

---

## Monitoring & Alerting (Security Events)

### Security Alerts
| Event | Alert | Severity |
|-------|-------|----------|
| Failed MQTT auth | >10 failures in 5 min | Critical |
| Failed SSH login | Any failure | Warning |
| Unauthorized API call | Any 401/403 response | Warning |
| Database connection from unknown IP | Any connection | Critical |
| SSL cert expiry < 30 days | Automated check | Warning |
| Backup failure | Any failure | Critical |

### Audit Logging
```sql
-- Audit trail for sensitive operations
CREATE TABLE audit_log (
    id          BIGSERIAL PRIMARY KEY,
    timestamp   TIMESTAMPTZ DEFAULT NOW(),
    user_id     VARCHAR(100),
    action      VARCHAR(50) NOT NULL,
    resource    VARCHAR(255),
    details     JSONB,
    ip_address  INET,
    user_agent  TEXT
);

-- Index for fast queries
CREATE INDEX idx_audit_log_timestamp ON audit_log (timestamp DESC);
CREATE INDEX idx_audit_log_user ON audit_log (user_id, timestamp DESC);
```

---

## Security Checklist

### Pre-Launch
- [ ] All security groups reviewed and minimized
- [ ] TLS certificates installed and verified
- [ ] Database passwords rotated from defaults
- [ ] EMQX anonymous access disabled
- [ ] S3 bucket public access blocked
- [ ] CloudWatch logging enabled
- [ ] Backup automation tested
- [ ] Device authentication tested
- [ ] SSL/TLS configuration verified (A+ rating target)

### Ongoing
- [ ] Monthly security patching
- [ ] Quarterly access review
- [ ] Annual penetration testing
- [ ] Continuous monitoring of security alerts
- [ ] Regular backup restore testing
