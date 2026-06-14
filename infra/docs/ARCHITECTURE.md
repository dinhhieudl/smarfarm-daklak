# Infrastructure Architecture — IoT AgriTech Platform

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        AWS ap-southeast-1 (Singapore)                │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────┐     │
│  │                    VPC (10.0.0.0/16)                         │     │
│  │                                                               │     │
│  │  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐   │     │
│  │  │  Public Subnet│    │ Private Subnet│    │ Private Subnet│  │     │
│  │  │  10.0.1.0/24  │    │ 10.0.2.0/24   │    │ 10.0.3.0/24  │  │     │
│  │  │              │    │              │    │              │   │     │
│  │  │  ┌────────┐ │    │  ┌────────┐ │    │  ┌────────┐ │   │     │
│  │  │  │  ALB   │ │    │  │ EMQX   │ │    │  │TimescaleDB│ │  │     │
│  │  │  │(HTTPS) │ │    │  │(MQTT)  │ │    │  │(Primary) │ │   │     │
│  │  │  └────────┘ │    │  └────────┘ │    │  └────────┘ │   │     │
│  │  │              │    │  ┌────────┐ │    │  ┌────────┐ │   │     │
│  │  │              │    │  │  Go    │ │    │  │TimescaleDB│ │  │     │
│  │  │              │    │  │Worker  │ │    │  │(Replica) │ │   │     │
│  │  │              │    │  └────────┘ │    │  └────────┘ │   │     │
│  │  │              │    │  ┌────────┐ │    │              │   │     │
│  │  │              │    │  │Prometheus│ │    │              │   │     │
│  │  │              │    │  │Grafana │ │    │              │   │     │
│  │  │              │    │  └────────┘ │    │              │   │     │
│  │  └──────────────┘    └──────────────┘    └──────────────┘  │     │
│  └─────────────────────────────────────────────────────────────┘     │
│                                                                       │
│  ┌──────────────────┐    ┌──────────────────┐                        │
│  │   S3 Bucket       │    │  CloudWatch       │                       │
│  │ (Raw data backup) │    │  (Logs/Alerts)    │                       │
│  └──────────────────┘    └──────────────────┘                        │
└─────────────────────────────────────────────────────────────────────┘

         ┌──────────────────┐
         │ Raspberry Pi      │
         │ Edge Devices      │
         │ (DakLak Farms)    │
         │                   │
         │ MQTT ────────────┼──→ EMQX Broker
         │ HTTPS fallback───┼──→ ALB → Go Worker
         └──────────────────┘
```

## Data Flow
1. Edge device collects sensor data every 5 min
2. Batched and sent via MQTT (primary) or HTTPS (fallback)
3. Go ingestion worker validates, transforms, and writes to TimescaleDB
4. Raw payloads also archived to S3 for replay/debugging
5. Prometheus scrapes all services; Grafana visualizes
6. API serves data to frontend dashboard

## Component Stack
| Component | Technology | Purpose |
|-----------|-----------|---------|
| MQTT Broker | EMQX Open Source | Real-time device communication |
| Ingestion | Go workers | Parse, validate, write to DB |
| Database | PostgreSQL 15 + TimescaleDB 2.x | Time-series storage |
| Object Storage | S3 | Raw payload archive |
| Reverse Proxy | ALB + Nginx | TLS termination, routing |
| Monitoring | Prometheus + Grafana | Metrics, dashboards, alerts |
| CI/CD | GitHub Actions | Build, test, deploy |
| IaC | Terraform | Infrastructure provisioning |
| Container | Docker + Docker Compose | Service orchestration |
