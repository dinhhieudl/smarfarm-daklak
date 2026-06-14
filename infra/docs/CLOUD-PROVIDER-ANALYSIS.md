# Cloud Provider Analysis — Vietnamese AgriTech IoT Platform

## Decision Matrix

| Factor | AWS | GCP | Azure | VNG Cloud | Viettel IDC | Self-Hosted |
|--------|-----|-----|-------|-----------|-------------|-------------|
| **Vietnam Region** | ✅ (ap-southeast-1 SG, ap-southeast-2 Jakarta) | ✅ (asia-southeast1 SG) | ✅ (southeast-asia HK/SG) | ✅ HCMC/Hanoi | ✅ Hanoi/HCMC | ✅ Local DC |
| **Latency from DakLak** | ~30ms (SG) | ~35ms (SG) | ~40ms (HK) | ~15ms | ~15ms | ~5ms |
| **Data Sovereignty** | ❌ No VN region | ❌ No VN region | ❌ No VN region | ✅ Full VN | ✅ Full VN | ✅ Full |
| **Managed DB (PG)** | ✅ RDS | ✅ Cloud SQL | ✅ Flexible Server | ⚠️ Basic | ⚠️ Basic | ❌ Self-manage |
| **IoT/MQTT Support** | ✅ IoT Core | ✅ IoT Core | ✅ IoT Hub | ❌ | ❌ | ❌ |
| **Cost (small)** | $$ | $$ | $$$ | $ | $ | $$$$ (upfront) |
| **Ops Complexity** | Low | Low | Medium | High | High | Very High |
| **Team Skill Fit** | High | High | Medium | Medium | Medium | Varies |
| **Scalability** | Excellent | Excellent | Excellent | Good | Good | Manual |
| **Ecosystem** | Rich | Rich | Rich | Limited | Limited | N/A |

## Recommendation: **Hybrid — AWS (Primary) + Vietnamese Provider (Data Residency)**

### Phase 1 (0–10 farms): AWS Singapore
- Lowest ops overhead for a 2-3 person team
- Managed services reduce burden significantly
- ~$150-300/month total
- Acceptable latency for batch sync (5-min intervals)

### Phase 2 (10–100 farms): AWS + Evaluate VNG Cloud
- Consider VNG Cloud for static assets / object storage within Vietnam
- Keep compute + DB on AWS for reliability

### Phase 3 (100–500 farms): Multi-region or Vietnamese Cloud
- If Vietnamese data sovereignty becomes a hard requirement,
  migrate to VNG Cloud or Viettel IDC with self-managed infra
- At this scale, hire a dedicated DevOps person

### Why NOT Self-Hosted
- A 2-3 person team cannot afford the operational overhead
- Hardware failures in rural DakLak require on-site intervention
- No managed backups, monitoring, or auto-scaling
- Capital expenditure vs operational expenditure tradeoff

### Why NOT Vietnamese Cloud (initially)
- Limited managed services (no RDS-equivalent with TimescaleDB)
- Smaller community, fewer docs, harder to troubleshoot
- Good for data residency layer, not as primary compute

## Architecture Decision
**Primary**: AWS ap-southeast-1 (Singapore)
- Closeest AWS region to Vietnam (~25-30ms from DakLak)
- Full managed services available
- Data sovereignty: store aggregated/analytics data in VN if required by law

## Vietnamese Data Residency Considerations
- **Decree 13/2023/ND-CP**: Requires certain data to be stored in Vietnam
- Agricultural sensor data (non-personal) is generally exempt
- If personal data (farmer info) is collected, must store in Vietnam
- Solution: PII in VNG Cloud / encrypted local DB, sensor data on AWS
