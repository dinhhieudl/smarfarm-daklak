-- ============================================================================
-- SmartFarm Cloud - Migration 002: Cooperative, Crop Seasons, Inputs, Users
-- ============================================================================
-- Adds: users (phone auth), cooperatives, crop_seasons, inputs, 
--        expanded sensor types, farm metadata
-- ============================================================================

-- ============================================================================
-- USERS (Phone-based authentication for Vietnamese farmers)
-- ============================================================================
CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone           VARCHAR(15) NOT NULL UNIQUE,   -- Vietnamese phone: +84xxxxxxxxx
    name            VARCHAR(200) NOT NULL,
    role            VARCHAR(20) NOT NULL DEFAULT 'farmer'
                    CHECK (role IN ('farmer', 'manager', 'consultant', 'admin')),
    zalo_id         VARCHAR(50),
    email           VARCHAR(255),
    avatar_url      TEXT,
    preferred_lang  VARCHAR(5) DEFAULT 'vi',
    is_active       BOOLEAN NOT NULL DEFAULT true,
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
CREATE INDEX IF NOT EXISTS idx_users_zalo ON users(zalo_id) WHERE zalo_id IS NOT NULL;

-- ============================================================================
-- USER ↔ TENANT MAPPING (multi-tenancy via user accounts)
-- ============================================================================
CREATE TABLE IF NOT EXISTS tenant_users (
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role            VARCHAR(20) NOT NULL DEFAULT 'member'
                    CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
    joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, user_id)
);

-- ============================================================================
-- COOPERATIVES (Hợp tác xã - groups of farms)
-- ============================================================================
CREATE TABLE IF NOT EXISTS cooperatives (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(300) NOT NULL,
    description     TEXT,
    province        VARCHAR(50) DEFAULT 'DakLak',
    district        VARCHAR(50),
    commune         VARCHAR(50),
    address         TEXT,
    contact_phone   VARCHAR(15),
    contact_email   VARCHAR(255),
    member_count    INTEGER DEFAULT 0,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- COOPERATIVE ↔ GARDEN MEMBERSHIP
-- ============================================================================
CREATE TABLE IF NOT EXISTS cooperative_members (
    cooperative_id  UUID NOT NULL REFERENCES cooperatives(id) ON DELETE CASCADE,
    garden_id       UUID NOT NULL REFERENCES gardens(id) ON DELETE CASCADE,
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    role            VARCHAR(20) DEFAULT 'member'
                    CHECK (role IN ('member', 'board', 'chairman')),
    joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (cooperative_id, garden_id)
);

CREATE INDEX IF NOT EXISTS idx_coop_members_coop ON cooperative_members(cooperative_id);
CREATE INDEX IF NOT EXISTS idx_coop_members_garden ON cooperative_members(garden_id);

-- ============================================================================
-- Add cooperative_id to gardens (optional link)
-- ============================================================================
DO $$ BEGIN
    ALTER TABLE gardens ADD COLUMN cooperative_id UUID REFERENCES cooperatives(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE gardens ADD COLUMN province VARCHAR(50) DEFAULT 'DakLak';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE gardens ADD COLUMN district VARCHAR(50);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- ============================================================================
-- CROP SEASONS (Mùa vụ canh tác)
-- ============================================================================
CREATE TABLE IF NOT EXISTS crop_seasons (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    garden_id       UUID NOT NULL REFERENCES gardens(id) ON DELETE CASCADE,
    zone_id         UUID REFERENCES zones(id) ON DELETE SET NULL,
    crop_type       VARCHAR(50) NOT NULL,          -- robusta, arabica, pepper, durian
    variety         VARCHAR(100),                  -- TR4, Catimor, etc.
    planting_date   DATE,
    expected_harvest DATE,
    actual_harvest  DATE,
    yield_kg        DECIMAL(12,2),
    yield_kg_ha     DECIMAL(10,2),
    status          VARCHAR(20) DEFAULT 'active'
                    CHECK (status IN ('planned', 'active', 'harvested', 'abandoned')),
    notes           TEXT,
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crop_seasons_garden ON crop_seasons(garden_id);
CREATE INDEX IF NOT EXISTS idx_crop_seasons_status ON crop_seasons(status);

-- ============================================================================
-- INPUTS (Phân bón, thuốc trừ sâu, nước tưới)
-- ============================================================================
CREATE TABLE IF NOT EXISTS inputs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    garden_id       UUID NOT NULL REFERENCES gardens(id) ON DELETE CASCADE,
    zone_id         UUID REFERENCES zones(id) ON DELETE SET NULL,
    season_id       UUID REFERENCES crop_seasons(id) ON DELETE SET NULL,
    input_type      VARCHAR(30) NOT NULL
                    CHECK (input_type IN ('fertilizer', 'pesticide', 'herbicide', 'water', 'mulch', 'lime', 'organic')),
    product_name    VARCHAR(300),
    quantity        DECIMAL(12,2),
    unit            VARCHAR(20),                   -- kg, L, m3, bags
    cost_vnd        BIGINT,                        -- VND
    application_date DATE,
    notes           TEXT,
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inputs_garden ON inputs(garden_id);
CREATE INDEX IF NOT EXISTS idx_inputs_season ON inputs(season_id);
CREATE INDEX IF NOT EXISTS idx_inputs_type ON inputs(input_type);
CREATE INDEX IF NOT EXISTS idx_inputs_date ON inputs(application_date);

-- ============================================================================
-- ALERT NOTIFICATION PREFERENCES
-- ============================================================================
CREATE TABLE IF NOT EXISTS alert_notifications (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    channel         VARCHAR(20) NOT NULL
                    CHECK (channel IN ('sms', 'zalo', 'email', 'push', 'webhook')),
    target          VARCHAR(255) NOT NULL,          -- phone number, zalo id, email, webhook URL
    is_active       BOOLEAN NOT NULL DEFAULT true,
    severity_filter VARCHAR(20) DEFAULT 'warning',  -- minimum severity to notify
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_notif_tenant ON alert_notifications(tenant_id);

-- ============================================================================
-- WEATHER DATA CACHE (external weather API data)
-- ============================================================================
CREATE TABLE IF NOT EXISTS weather_cache (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    garden_id       UUID NOT NULL REFERENCES gardens(id) ON DELETE CASCADE,
    latitude        DOUBLE PRECISION NOT NULL,
    longitude       DOUBLE PRECISION NOT NULL,
    fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    forecast_date   DATE NOT NULL,
    temp_min_c      DECIMAL(5,2),
    temp_max_c      DECIMAL(5,2),
    humidity_pct    DECIMAL(5,2),
    rainfall_mm     DECIMAL(8,2),
    wind_speed_ms   DECIMAL(5,2),
    condition       VARCHAR(50),                    -- clear, cloudy, rain, storm
    raw_data        JSONB,
    UNIQUE(garden_id, forecast_date)
);

CREATE INDEX IF NOT EXISTS idx_weather_garden_date ON weather_cache(garden_id, forecast_date);

-- ============================================================================
-- OTP SESSIONS (for phone authentication)
-- ============================================================================
CREATE TABLE IF NOT EXISTS otp_sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone           VARCHAR(15) NOT NULL,
    otp_hash        VARCHAR(255) NOT NULL,          -- bcrypt hash of OTP
    attempts        INTEGER DEFAULT 0,
    max_attempts    INTEGER DEFAULT 5,
    expires_at      TIMESTAMPTZ NOT NULL,
    used            BOOLEAN DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_otp_phone ON otp_sessions(phone, expires_at) WHERE used = false;

-- ============================================================================
-- UPDATED_AT TRIGGERS for new tables
-- ============================================================================
CREATE OR REPLACE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE TRIGGER trg_cooperatives_updated_at
    BEFORE UPDATE ON cooperatives
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE TRIGGER trg_crop_seasons_updated_at
    BEFORE UPDATE ON crop_seasons
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
