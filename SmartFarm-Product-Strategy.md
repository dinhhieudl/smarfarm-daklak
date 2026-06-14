# SmartFarm Cloud Platform — Product Strategy Document

**Version:** 1.0  
**Date:** 2026-06-14  
**Product:** SmartFarm IoT (Local) + SmartFarm Cloud (SaaS)  
**Target Market:** Coffee farms, DakLak & Central Highlands, Vietnam  

---

## Executive Summary

Vietnam is the world's second-largest coffee producer and the #1 Robusta exporter, with a $8.4B coffee economy (2024-2025). DakLak province alone accounts for ~35% of regional GDP from coffee, with 60% of farming households depending on it. Climate stress (severe flooding in Nov 2025), rising input costs (fertilizer = 1/3 of production costs), and price volatility create urgent demand for data-driven farming.

We sell a **local-first SmartFarm system** (Raspberry Pi + LoRaWAN sensors + on-premise software) and are building a **cloud platform** to aggregate data across customer farms, enabling cross-farm analytics, AI advisory, and a farmer ecosystem.

**Core insight:** Average farmer income is ~3.6M VND/month (~$144). Any solution must deliver clear ROI within one crop cycle or it won't be adopted.

---

## 1. Business Model

### 1.1 Hardware Pricing

| Bundle | Contents | Target | Price (VND) | Price (USD) |
|--------|----------|--------|-------------|-------------|
| **Starter Kit** | 1× RPi 4, 1× LoRa gateway, 3× soil moisture sensors, 2× temp/humidity, 1× rain gauge | Small farm (5-20ha) | 5,000,000 | ~$200 |
| **Standard Kit** | 1× RPi 4, 1× LoRa gateway, 6× soil sensors, 4× temp/humidity, 2× rain gauge, 1× light sensor | Medium farm (20-100ha) | 9,500,000 | ~$380 |
| **Pro Kit** | 2× RPi 4, 2× LoRa gateways, 12× soil sensors, 8× temp/humidity, 4× rain gauge, 2× light, 1× leaf wetness | Large farm (100+ha) | 18,000,000 | ~$720 |
| **Add-on Sensor** | Individual sensor units | Expansion | 500,000-1,200,000 | $20-$48 |

**Pricing rationale:**
- Starter Kit costs ~14% of a small farmer's annual income — significant but justifiable if it saves 15-20% on fertilizer (fertilizer = 1/3 of costs)
- ROI target: hardware pays for itself within 1 crop season through fertilizer savings + yield improvement
- Offer **installment plans** (3-6 months) via partnerships with agricultural banks (Agribank, VBARD)

### 1.2 Local Software Licensing

**Recommendation: Free with hardware, forever.**

Rationale:
- Vietnamese farmers are extremely price-sensitive and skeptical of recurring fees
- Local software is the "glue" that makes hardware useful — charging separately creates friction
- Local software acts as the gateway to cloud upsell (show cloud features in greyed-out state)
- Support costs for local software are manageable since it runs on standardized RPi hardware

**Local software includes:**
- Real-time sensor dashboard (web UI on local network)
- Data logging and 90-day local storage
- Basic alerts (SMS via local SIM when thresholds exceeded)
- Data export (CSV/JSON)
- Cloud sync button (shows what they're missing)

### 1.3 Cloud Platform Subscription Tiers

| Feature | Free | Basic | Pro | Enterprise |
|---------|------|-------|-----|------------|
| **Price** | Free forever | 99,000 VND/mo (~$4) | 299,000 VND/mo (~$12) | Custom |
| **Target** | All hardware buyers | Small farms, trial | Medium-large farms | Co-ops, consultants |
| **Farm dashboards** | 1 | 1 | Up to 5 | Unlimited |
| **Data history** | 30 days | 1 year | 3 years | Unlimited |
| **Sync frequency** | Daily | Every 6h | Every 1h | Real-time |
| **Alerts** | Basic (in-app) | SMS + in-app | Multi-channel (SMS, Zalo, push) | Custom webhooks |
| **Weather data** | Current only | 7-day forecast | 14-day + historical | API access |
| **Analytics** | Basic charts | Trend analysis | Cross-field comparison, benchmarks | Custom reports |
| **AI advisory** | — | — | Fertilizer recommendations, pest alerts | Full AI suite |
| **Yield prediction** | — | — | ✓ | ✓ |
| **Marketplace access** | Read-only | Buy | Buy + Sell | Full API |
| **Support** | Community (Zalo group) | Email (48h) | Priority (12h) | Dedicated account manager |
| **Users** | 1 | 2 | 5 | Unlimited |
| **Cooperative view** | — | — | — | Aggregate across members |

**Pricing psychology notes:**
- 99,000 VND/month ≈ the price of 1 kg of coffee beans — farmers can mentally benchmark this
- Free tier retains users and creates data lock-in; conversion happens when they see value
- Annual discount: 2 months free (pay 10 months for 12) — common in Vietnam SaaS
- Enterprise tier sold per-cooperative, not per-farmer — lower per-unit cost but higher total contract

---

## 2. User Personas

### 2.1 Anh Ba — Small Farmer (5-20 hectares)

| Attribute | Detail |
|-----------|--------|
| **Age** | 35-55 |
| **Education** | Secondary school (THCS) to high school |
| **Tech comfort** | Uses Zalo, Facebook, basic smartphone apps |
| **Farm size** | 8 hectares Robusta, family-operated |
| **Annual revenue** | ~120-200M VND ($4,800-$8,000) |
| **Annual income (net)** | ~40-60M VND ($1,600-$2,400) |
| **Key pain points** | Weather unpredictability, fertilizer costs, no data to make decisions, relies on experience/neighbors for advice |
| **Decision drivers** | ROI within 1 season, word-of-mouth from trusted peers, simplicity |
| **Buying behavior** | Extremely cautious, needs to see it working on a neighbor's farm first. Will ask cooperative leader for opinion |
| **Cloud tier fit** | Free → Basic (after seeing value) |
| **Quote** | *"If I spend 5 million on this thing, it better save me 10 million or I'm returning it"* |

**Design implications:**
- Interface must work in Vietnamese with large text, icons, minimal reading
- SMS/Zalo alerts preferred over email
- Show data in familiar units (kg fertilizer/ha, mm rainfall)
- "How much did I save?" must be front and center

### 2.2 Chị Hoa — Medium Farm Manager (20-100 hectares)

| Attribute | Detail |
|-----------|--------|
| **Age** | 30-50 |
| **Education** | High school to college diploma |
| **Tech comfort** | Comfortable with smartphone, uses Zalo for business, some use Excel |
| **Farm size** | 45 hectares, employs 5-15 seasonal workers |
| **Annual revenue** | ~500M-2B VND ($20,000-$80,000) |
| **Key pain points** | Managing workers across fields, tracking inputs/outputs, optimizing irrigation schedules, can't be on all fields at once |
| **Decision drivers** | Efficiency gains, professional image (for buyers/exporters), data-driven decisions |
| **Buying behavior** | Researches online, compares options, willing to invest if ROI is clear. May attend agricultural trade shows |
| **Cloud tier fit** | Pro |
| **Quote** | *"I have 3 different plots and I can't be everywhere. I need to know what's happening without driving there"* |

**Design implications:**
- Multi-field dashboard is critical
- Worker task assignment and monitoring
- Input cost tracking per field
- Comparison views (field A vs field B)
- Export reports for loan applications / buyer negotiations

### 2.3 Ông Tín — Large Plantation Owner (100+ hectares)

| Attribute | Detail |
|-----------|--------|
| **Age** | 45-65 |
| **Education** | College/university, possibly studied abroad or in HCMC |
| **Tech comfort** | Uses laptop, email, business apps. Delegates tech to staff |
| **Farm size** | 200 hectares, employs 30-80 workers, may have processing facility |
| **Annual revenue** | ~5-20B VND ($200,000-$800,000) |
| **Key pain points** | Labor management at scale, quality consistency across fields, export certification requirements (Rainforest Alliance, 4C), cost optimization |
| **Decision drivers** | Competitive advantage, export market access, sustainability credentials, operational efficiency |
| **Buying behavior** | Decision delegated to farm manager; he approves budget. Wants enterprise features, integration with existing systems |
| **Cloud tier fit** | Enterprise |
| **Quote** | *"My European buyers want sustainability data. If this system can generate compliance reports, I'm interested"* |

**Design implications:**
- Role-based access (owner, manager, field supervisor, worker)
- Compliance/certification report generation
- Integration with ERP/accounting
- API for custom workflows
- White-label capability for his brand

### 2.4 Thầy Minh — Agricultural Consultant / Cooperative Leader

| Attribute | Detail |
|-----------|--------|
| **Age** | 35-55 |
| **Education** | University degree in agronomy or agricultural economics |
| **Tech comfort** | High — uses PC daily, comfortable with data analysis |
| **Role** | Agricultural extension officer OR cooperative chairman serving 50-500 farmer members |
| **Key pain points** | Can't visit all farms, needs to provide advice at scale, members don't follow recommendations, no visibility into actual farm conditions |
| **Decision drivers** | Scale of impact, credibility with members, government program alignment |
| **Buying behavior** | Bulk purchasing for cooperative, negotiates discount, needs management dashboard |
| **Cloud tier fit** | Enterprise (multi-farm management) |
| **Quote** | *"I advise 200 farmers but I've only been to 30 of their farms this year. I need eyes on all of them"* |

**Design implications:**
- Cooperative dashboard: see all member farms at a glance
- Anomaly detection: flag farms with unusual readings
- Broadcast advisory messages to members
- Aggregate statistics for government reporting
- Member management (add/remove farms)

---

## 3. Feature Roadmap

### Phase 1: MVP Cloud Dashboard (Months 1-4)

**Goal:** Prove cloud value proposition. Get farmers to sync data.

| Feature | Description | Priority |
|---------|-------------|----------|
| User registration & auth | Phone number + OTP (Vietnamese phone), Zalo login | P0 |
| Farm profile setup | Map-based farm boundary drawing, crop type, planting date | P0 |
| Auto-sync from local RPi | Scheduled push of sensor data to cloud via 4G/WiFi | P0 |
| Basic dashboard | Current readings (soil moisture, temp, humidity, rainfall) | P0 |
| Historical charts | 30-day data visualization, date range selector | P0 |
| Simple alerts | In-app notifications when thresholds exceeded | P0 |
| Farm comparison | Compare current readings to historical averages | P1 |
| Weather widget | Current weather from nearest station (Open-Meteo API) | P1 |
| Vietnamese localization | Full Vietnamese UI, metric units familiar to farmers | P0 |

**Success criteria:** 70% of hardware buyers activate cloud account. 40% sync weekly.

### Phase 2: Intelligence Layer (Months 5-8)

**Goal:** Make the platform indispensable. Proactive insights.

| Feature | Description | Priority |
|---------|-------------|----------|
| 14-day weather forecast | Integrated with farm-specific alerts (frost risk, heavy rain) | P0 |
| Cross-farm benchmarking | "Your soil moisture is 15% below average for your area" | P0 |
| Smart alerts | Multi-channel: SMS, Zalo, push. Configurable thresholds | P0 |
| Irrigation advisor | When to water based on soil data + weather forecast | P1 |
| Seasonal reports | Auto-generated end-of-season summary with ROI metrics | P1 |
| Input tracking | Log fertilizer, pesticide, water usage per field | P1 |
| Data export | PDF reports for banks, certification bodies, buyers | P1 |
| Zalo integration | Receive alerts and quick data via Zalo OA | P0 |

**Success criteria:** 50% Free→Basic conversion. 80% monthly active rate among paid users.

### Phase 3: AI Advisory & Marketplace (Months 9-14)

**Goal:** Become the operating system for coffee farming.

| Feature | Description | Priority |
|---------|-------------|----------|
| AI fertilizer advisor | Soil-specific, stage-specific fertilizer recommendations | P0 |
| Pest & disease detection | Photo-based diagnosis via mobile camera | P1 |
| Yield prediction | ML model based on sensor data + historical patterns | P1 |
| Coffee price dashboard | Real-time VN coffee prices, trend analysis | P0 |
| Marketplace (buyer side) | Connect farmers with exporters, roasters | P1 |
| Marketplace (seller side) | List harvest, quality grading, logistics | P2 |
| Peer network | Connect with nearby farmers, share tips | P2 |
| Certification support | Rainforest Alliance, 4C compliance data collection | P1 |

**Success criteria:** 30% Pro adoption among medium+ farms. Marketplace GMV > $100K in first year.

### Phase 4: Platform & Scale (Months 15-24)

**Goal:** Become the standard platform for Vietnamese coffee farming.

| Feature | Description | Priority |
|---------|-------------|----------|
| Multi-crop support | Pepper, durian, rubber — common intercrops in Central Highlands | P0 |
| Public API | Allow third-party integrations (ERP, farm management) | P1 |
| White-label | Cooperatives/enterprises can rebrand the platform | P1 |
| Satellite integration | NDVI, crop health from satellite imagery | P2 |
| Carbon credit tracking | Measure and certify carbon sequestration for carbon markets | P2 |
| Financial services | Micro-loans, crop insurance integration | P2 |
| Hardware v2 | Next-gen sensors, solar-powered, lower cost | P1 |

**Success criteria:** 500+ farms on platform. 3+ cooperative partnerships. API revenue > 10% of total.

---

## 4. Go-to-Market Strategy

### 4.1 The Trust Problem

Vietnamese coffee farmers are pragmatic and skeptical of technology. They trust:
- **Neighbors** (word of mouth is #1 channel)
- **Cooperative leaders** (authority figures)
- **Agricultural extension officers** (government-backed credibility)
- **Visible results** (show me the savings, then I'll buy)

They do NOT trust:
- Tech companies from Hanoi/HCMC (perceived as disconnected from farming reality)
- Subscription models (prefer one-time purchases)
- English-language or complex interfaces

### 4.2 Distribution Strategy

#### Phase 1: Cooperative-First (Months 1-12)

**Primary channel:** Agricultural cooperatives in DakLak

1. **Identify 5 pilot cooperatives** in DakLak (Buôn Ma Thuột, Krông Buk, Cư M'gar districts)
2. **Install on 2-3 demo farms** per cooperative — visible, showpiece installations
3. **Train cooperative leaders** as "SmartFarm Ambassadors" — they recommend to members
4. **Cooperative discount:** 15% off hardware for bulk orders (10+ units)
5. **Free 6-month Pro trial** for cooperative management dashboard

**Why cooperatives?**
- 1 recommendation from a trusted cooperative leader = 100 ad impressions
- Cooperatives aggregate purchasing power
- They provide after-sales support infrastructure
- Government programs (MARD) often work through cooperatives

#### Phase 2: Field Day Marketing (Months 6-18)

1. **"Ngày Đồng Ruộng" (Field Day) events** at demo farms
   - Live demonstration: show real sensor data on projector
   - Side-by-side comparison: sensor-managed vs. traditional plot
   - Free soil testing for attendees (immediate value, collects contact info)
   - Lunch provided (standard for Vietnamese agricultural events)
2. **Partner with WASI** (Western Highlands Agroforestry Scientific and Technical Institute) — already partnering with Enfarm, shows institutional appetite
3. **Agricultural trade shows:** DakLak Coffee Festival, Vietnam International Agriculture Fair

#### Phase 3: Digital & Channel Expansion (Months 12-24)

1. **Zalo OA (Official Account)** — primary digital channel
   - Daily coffee price updates (farmers check prices obsessively)
   - Weather tips
   - Success stories from other farmers
   - Customer support
2. **Facebook groups** — farmers are very active in regional farming groups
3. **YouTube/TikTok** — short videos: "How Anh Ba saved 3 million VND on fertilizer"
4. **Agribank partnership** — bundle hardware with agricultural loans (hardware as collateral/equipment loan)
5. **Export company partnerships** — exporters want traceability data; they can subsidize hardware for their supplier farmers

### 4.3 Pricing Psychology for Rural Vietnam

| Tactic | Implementation |
|--------|---------------|
| **Anchor to coffee price** | "Costs less than 1 bag of coffee per month" (1 bag = 60kg = ~6.6M VND) |
| **Visible ROI calculator** | "You spent X on fertilizer last year. SmartFarm users in your area spent Y. Save Z." |
| **Installment payments** | 3-6 month installments via Agribank, no interest (we absorb or bank subsidizes) |
| **Seasonal billing** | Don't bill during harvest (Dec-Mar) when cash is tight. Bill during growing season when farmers see value |
| **Family plan** | 1 subscription covers the main farm + family members' smaller plots |
| **Referral rewards** | Refer a neighbor → 1 month free. Refer 5 → hardware discount |
| **"Try before you buy"** | Loan a Starter Kit for 2 weeks to skeptical farmers |

### 4.4 Partnership Ecosystem

| Partner Type | Example Partners | Value Exchange |
|-------------|-----------------|----------------|
| **Agricultural cooperatives** | DakLak Coffee Cooperative Union | Distribution, trust, bulk orders |
| **Government (MARD)** | Provincial Dept. of Agriculture | Subsidy programs, data for policy |
| **Research institutes** | WASI, Western Highlands Univ. | Field trials, scientific credibility |
| **Banks** | Agribank, VBARD | Financing for hardware, bundled loans |
| **Export companies** | Simexco DakLak, Intimex | Subsidize hardware for traceability |
| **Coffee brands** | Trung Nguyen, Highlands Coffee | Sustainability storytelling, sponsorship |
| **Telcos** | Viettel, Mobifone | Bundled 4G data plans for RPi connectivity |
| **Input suppliers** | fertilizer companies | Data-driven product recommendations |

---

## 5. Competitive Analysis

### 5.1 Direct Competitors in Vietnam/SEA

| Competitor | What They Do | Strengths | Weaknesses | Our Advantage |
|-----------|-------------|-----------|------------|---------------|
| **Enfarm Agritech** | IoT + AI for smart fertilization, coffee focus in Central Highlands | Strong WASI partnership, VC-backed (seed round Dec 2025), focused on fertilization | Narrow scope (fertilizer only), no local-first architecture, cloud-dependent | Full-farm monitoring, local resilience, multi-crop roadmap |
| **MimosaTEK** | IoT irrigation management, based in HCMC | Government contracts, established brand | General agriculture, not coffee-specific, expensive for small farmers | Coffee-specific, lower price point, cooperative-first model |
| **FarmersEdge** (Canada) | Precision agriculture platform | Strong technology, satellite integration | Too expensive for Vietnam market, no local presence, English-first | Vietnamese-first, affordable, ground-truth sensor data |
| **CropIn** (India) | Farm management SaaS | AI capabilities, multi-crop | Enterprise-only, no hardware, no Vietnam presence | End-to-end (hardware + software + cloud), local support |
| **Manual methods** | Pen + paper, experience, neighbors | Free, trusted, no learning curve | No data, reactive, inconsistent | Data-driven decisions, early warnings, quantified ROI |

### 5.2 Our Key Differentiators

1. **Local-first architecture** — Works without internet. Critical for rural areas with spotty connectivity. Data syncs when connection is available. Competitors are cloud-dependent.

2. **Purpose-built for Vietnamese coffee** — Not a generic AgriTech platform. UI in Vietnamese, metrics in local units, alerts relevant to coffee lifecycle (flowering, fruit development, harvest).

3. **Hardware + Software + Cloud integrated** — Most competitors are either hardware OR software. We own the full stack, which means better integration and lower total cost.

4. **Cooperative-centric model** — Selling through cooperatives (not direct-to-farmer) reduces CAC and builds trust. Competitors try to sell to individual farmers.

5. **Price point** — Starter Kit at $200 is 50-70% cheaper than comparable commercial solutions. RPi-based architecture keeps costs low.

6. **Data network effects** — More farms on the platform → better benchmarks → better AI recommendations → more value → more farms. First-mover advantage in this niche.

### 5.3 Threats

| Threat | Mitigation |
|--------|-----------|
| Enfarm scales quickly with VC money | Move fast on cooperative partnerships; lock in exclusivity |
| Government launches free smart farming program | Position as complementary (hardware + implementation partner for govt programs) |
| Telco bundles (Viettel launches farming IoT) | Differentiate on coffee expertise; telcos are generic |
| Chinese cheap IoT flooding market | Emphasize local support, Vietnamese software, coffee-specific intelligence |
| Farmers don't renew cloud subscriptions | Make free tier valuable enough to keep data; demonstrate clear ROI for paid tiers |

---

## 6. KPIs & Metrics

### 6.1 North Star Metric

**Monthly Active Farms (MAF)** — A farm is "active" if it synced data ≥4 times in the past month.

Why this metric?
- Syncing = hardware deployed and working = they see value
- Predicts revenue (active farms convert to paid)
- Measures real impact (not just signups)

### 6.2 Acquisition Metrics

| Metric | Target (Year 1) | Target (Year 2) |
|--------|-----------------|-----------------|
| Hardware units sold | 200 | 800 |
| Cloud accounts activated | 160 (80% of hardware) | 680 (85%) |
| Cooperative partnerships | 5 | 20 |
| Customer Acquisition Cost (CAC) | < 1,000,000 VND ($40) | < 600,000 VND ($24) |
| Referral rate | 15% of new customers from referrals | 25% |

### 6.3 Engagement Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Monthly Active Farms (MAF) | 60% of activated accounts | ≥4 syncs/month |
| Daily Active Farms | 30% of activated accounts | ≥1 sync/day |
| Alert open rate | >70% | Push/SMS read |
| Dashboard sessions/week | 3+ per active farm | Analytics |
| Feature adoption (Pro) | >50% use ≥3 Pro features | Feature tracking |

### 6.4 Revenue Metrics

| Metric | Target (Year 1) | Target (Year 2) |
|--------|-----------------|-----------------|
| Hardware revenue | 1,000M VND ($40K) | 4,000M VND ($160K) |
| Subscription ARR | 150M VND ($6K) | 1,200M VND ($48K) |
| Free→Basic conversion | 25% | 35% |
| Basic→Pro conversion | 15% | 25% |
| ARPU (monthly, paying) | 200,000 VND ($8) | 250,000 VND ($10) |

### 6.5 Retention Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| 90-day retention (cloud) | >70% | Still active after 90 days |
| Annual renewal rate (paid) | >80% | Subscription renewals |
| Hardware churn | <10%/year | Units returned or disconnected |
| Net Revenue Retention | >110% | Expansion revenue from upgrades |
| NPS | >40 | Quarterly survey |

### 6.6 Impact Metrics (The "Why We Exist" Numbers)

| Metric | Target | Measurement |
|--------|--------|-------------|
| Avg. fertilizer cost reduction | 15-20% | Self-reported + input tracking |
| Avg. yield improvement | 10-15% | Harvest data comparison |
| Water usage reduction | 20% | Irrigation tracking |
| Farmer income increase | ≥10% | Net income tracking |
| Time saved (decision-making) | 5+ hours/week | User surveys |

---

## 7. Financial Model Summary (Year 1-3)

| | Year 1 | Year 2 | Year 3 |
|---|--------|--------|--------|
| Hardware units sold | 200 | 800 | 2,000 |
| Active cloud farms | 120 | 500 | 1,500 |
| Paid subscribers | 30 | 200 | 700 |
| Hardware revenue | $40K | $160K | $400K |
| Subscription revenue | $6K | $48K | $168K |
| **Total revenue** | **$46K** | **$208K** | **$568K** |
| COGS (hardware) | $25K | $96K | $240K |
| Gross margin | $21K | $112K | $328K |

**Break-even:** ~Month 18 (assuming $15K/month burn rate with a lean team of 5-8 people in Vietnam)

---

## 8. Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|-----------|
| Low tech adoption by farmers | High | High | Cooperative-first approach, demo farms, Vietnamese UI, Field Day events |
| Internet connectivity issues | High | Medium | Local-first architecture, 4G fallback, batch sync |
| Competitor (Enfarm) captures market | Medium | High | Speed of execution, lock in cooperative partnerships early |
| Government subsidy disruption | Medium | Medium | Position as implementation partner, not competitor |
| Hardware supply chain (RPi) | Low | High | Multi-source (RPi + alternatives like Orange Pi), buffer inventory |
| Climate events reduce farmer spending | Medium | High | Insurance partnerships, flexible payment terms, free tier retains users |
| Data privacy concerns | Low | Medium | Clear data ownership policy, Vietnamese data stored in Vietnam |

---

## 9. Team & Execution Priorities (First 12 Months)

| Role | Headcount | Priority |
|------|-----------|----------|
| Full-stack developer (cloud) | 2 | Build MVP cloud platform |
| Embedded/IoT developer | 1 | RPi firmware, sensor integration |
| Field sales/BD (DakLak-based) | 2 | Cooperative partnerships, demo farms |
| Agronomist/coffee expert | 1 | Advisory content, AI training data |
| Product manager | 1 | Roadmap, prioritization, user research |
| **Total** | **7** | |

**Critical first hires:** Field sales in DakLak (must be local, trusted, speak the dialect) and a full-stack developer who can ship fast.

---

## 10. Appendix: Market Data

### Vietnam Coffee Industry Snapshot (2024-2025)

- Total cultivation area: ~720,000 hectares
- Central Highlands share: 90-95% of production
- DakLak province: largest coffee-producing province
- Total output: ~1.7 million tons
- Industry value: $8.4 billion
- Global position: #2 producer, #1 Robusta exporter (40% global share)
- Average farmer income: 3.6M VND/month (~$144)
- Fertilizer cost share: ~33% of production costs
- Coffee price (2024-25): 110,000 VND/kg (~$4.17) — record high

### Key Trends

1. **Climate stress:** Severe flooding (Nov 2025) destroyed crops, increasing demand for weather monitoring and early warning systems
2. **Sustainability requirements:** European buyers increasingly require traceability and sustainability certifications (Rainforest Alliance, 4C)
3. **Government support:** MARD's "Smart Coffee Cultivation Program" (2023-2030) creates policy tailwinds
4. **Price volatility:** Record coffee prices make farmers more willing to invest in yield optimization
5. **Digital adoption:** Zalo penetration >90% in rural Vietnam; smartphone adoption rising rapidly among 30-50 age group

---

*Document prepared for internal strategic planning. All pricing in VND with USD approximations at 25,000 VND/USD.*
