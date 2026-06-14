# Cost Estimation — IoT AgriTech Platform (AWS ap-southeast-1)

## Assumptions
- Region: AWS ap-southeast-1 (Singapore)
- Each device syncs every 5 min = 288 syncs/day = 8,640/month
- Payload: ~500KB/day per device = ~15MB/month per device
- MQTT messages: 288/day per device
- TimescaleDB compression reduces storage by ~90%

---

## Phase 1: 10 Farms (~10 devices)

| Service | Spec | Monthly Cost (USD) |
|---------|------|--------------------|
| **EC2** (t3.medium) | 2 vCPU, 4GB RAM | $35 |
| **RDS Aurora Serverless v2** | Min 0.5 ACU, max 4 ACU | $45 |
| **S3** (data archive) | ~150MB/month | $1 |
| **ALB** | Low traffic | $18 |
| **NAT Gateway** | Low data transfer | $35 |
| **Data Transfer** | ~1.5GB outbound | $2 |
| **CloudWatch** | Basic monitoring | $5 |
| **Secrets Manager** | 1 secret | $1 |
| **Route 53** (optional) | 1 hosted zone | $1 |
| **SSL Certificate** (ACM) | Free | $0 |
| | | |
| **Total** | | **~$143/month** |

---

## Phase 2: 100 Farms (~100 devices)

| Service | Spec | Monthly Cost (USD) |
|---------|------|--------------------|
| **EC2** (t3.large) | 2 vCPU, 8GB RAM | $70 |
| **EC2** (t3.medium) — standby | Failover instance | $35 |
| **RDS Aurora Serverless v2** | Min 2 ACU, max 8 ACU | $120 |
| **RDS Read Replica** | 1 replica | $60 |
| **S3** (data archive) | ~1.5GB/month | $2 |
| **ALB** | Medium traffic | $22 |
| **NAT Gateway** | Medium data transfer | $45 |
| **Data Transfer** | ~15GB outbound | $15 |
| **CloudWatch** | Enhanced monitoring | $15 |
| **Secrets Manager** | 3 secrets | $3 |
| **SNS** | Alerts | $1 |
| | | |
| **Total** | | **~$388/month** |

---

## Phase 3: 500 Farms (~500 devices)

| Service | Spec | Monthly Cost (USD) |
|---------|------|--------------------|
| **EC2** (t3.xlarge) — x2 | 4 vCPU, 16GB RAM | $280 |
| **EC2** (t3.large) — worker | Dedicated ingestion | $70 |
| **RDS Aurora Serverless v2** | Min 4 ACU, max 16 ACU | $350 |
| **RDS Read Replicas** — x2 | Read scaling | $120 |
| **S3** (data archive) | ~7.5GB/month | $5 |
| **S3** (Glacier) | Older archives | $2 |
| **ALB** | High traffic | $30 |
| **NAT Gateway** | High data transfer | $65 |
| **Data Transfer** | ~75GB outbound | $70 |
| **CloudWatch** | Full monitoring | $30 |
| **ElastiCache** (Redis) | Cache layer, t3.small | $30 |
| **Secrets Manager** | 5 secrets | $5 |
| **SNS + SES** | Alerts + notifications | $5 |
| | | |
| **Total** | | **~$1,062/month** |

---

## Cost Optimization Tips

### Immediate Savings
1. **Reserved Instances** (1-year): Save ~30% on EC2 (~$100-200/month at scale)
2. **Aurora Reserved Capacity**: Save ~40% on database
3. **S3 Intelligent-Tiering**: Auto-optimize storage costs
4. **VPC Endpoints**: Reduce NAT Gateway data transfer costs

### Architecture Optimizations
1. **Batch writes**: Already implemented (5-min sync) — good
2. **TimescaleDB compression**: ~10x storage reduction after 7 days
3. **Continuous aggregates**: Pre-computed hourly/daily reduces query load
4. **Data retention**: Auto-drop raw data after 2 years

### Vietnamese Cloud Alternative (Cost Comparison)
| Scale | AWS (SG) | VNG Cloud (est.) | Viettel IDC (est.) |
|-------|----------|-------------------|---------------------|
| 10 farms | $143 | ~$80-100 | ~$70-90 |
| 100 farms | $388 | ~$250-300 | ~$200-250 |
| 500 farms | $1,062 | ~$600-800 | ~$500-700 |

*Note: Vietnamese providers are cheaper but have fewer managed services, requiring more ops effort.*

---

## Break-Even Analysis

### Cost per Farm per Month
| Scale | AWS | Self-Hosted (amortized) |
|-------|-----|------------------------|
| 10 farms | $14.30 | ~$50+ (hardware, colo, power) |
| 100 farms | $3.88 | ~$20 |
| 500 farms | $2.12 | ~$10 |

Cloud is more expensive per unit at small scale, but eliminates:
- Hardware procurement and maintenance
- Physical security and power
- On-site DevOps requirements
- Capital expenditure

---

## Free Tier Eligibility (First 12 Months)
- EC2: 750 hours/month t2.micro (not suitable for production)
- RDS: 750 hours/month db.t2.micro (not suitable for production)
- S3: 5GB storage
- Data Transfer: 100GB/month outbound

**Recommendation**: Use free tier for development/staging only, not production.
