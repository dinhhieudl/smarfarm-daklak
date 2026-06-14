"""
Pydantic models for API request/response validation.
"""

from datetime import datetime, date
from typing import Optional
from pydantic import BaseModel, Field
from enum import Enum


# ============================================================
# Enums
# ============================================================

class SensorType(str, Enum):
    SOIL_TEMPERATURE = "soil_temperature"
    SOIL_MOISTURE = "soil_moisture"
    EC = "ec"
    NITROGEN = "nitrogen"
    PHOSPHORUS = "phosphorus"
    POTASSIUM = "potassium"
    PH = "ph"
    SALINITY = "salinity"


class CropStage(str, Enum):
    REST = "rest"
    FLOWERING = "flowering"
    FRUITING = "fruiting"
    DEVELOPMENT = "development"
    RIPENING = "ripening"
    HARVEST = "harvest"


class Severity(str, Enum):
    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"


class TimeGranularity(str, Enum):
    RAW = "raw"
    FIVE_MIN = "5min"
    HOURLY = "hourly"
    DAILY = "daily"
    WEEKLY = "weekly"
    MONTHLY = "monthly"


# ============================================================
# Request Models
# ============================================================

class TimeRangeParams(BaseModel):
    """Common time range parameters."""
    start: Optional[datetime] = Field(None, description="Start time (ISO 8601)")
    end: Optional[datetime] = Field(None, description="End time (ISO 8601)")
    granularity: TimeGranularity = TimeGranularity.HOURLY


class FarmQueryParams(TimeRangeParams):
    """Query parameters scoped to a farm."""
    farm_id: str = Field(..., description="Farm UUID")
    sensor_type: Optional[SensorType] = None


class ZoneQueryParams(FarmQueryParams):
    """Query parameters scoped to a zone."""
    zone_id: str = Field(..., description="Zone UUID")


class BenchmarkParams(BaseModel):
    """Parameters for farm benchmarking."""
    farm_id: str
    period_days: int = Field(30, ge=7, le=365)
    metrics: list[SensorType] = Field(
        default=[SensorType.SOIL_MOISTURE, SensorType.PH, SensorType.EC]
    )


class CorrelationParams(BaseModel):
    """Parameters for correlation analysis."""
    region_id: Optional[int] = None
    metric_x: SensorType = SensorType.SOIL_MOISTURE
    metric_y: SensorType = SensorType.SOIL_TEMPERATURE
    period_days: int = Field(90, ge=30, le=365)


class ExportParams(BaseModel):
    """Export request parameters."""
    farm_ids: Optional[list[str]] = None  # None = all farms
    region_id: Optional[int] = None
    sensor_types: Optional[list[SensorType]] = None
    start_date: date
    end_date: date
    granularity: TimeGranularity = TimeGranularity.DAILY
    format: str = Field("csv", pattern="^(csv|xlsx|json)$")


# ============================================================
# Response Models
# ============================================================

class ReadingResponse(BaseModel):
    """A single aggregated reading."""
    time: datetime
    farm_id: str
    zone_id: Optional[str] = None
    sensor_type: str
    avg_value: float
    min_value: Optional[float] = None
    max_value: Optional[float] = None
    sample_count: Optional[int] = None


class AnomalyResponse(BaseModel):
    """An anomaly detection result."""
    farm_id: str
    farm_name: str
    zone_id: str
    zone_name: str
    sensor_type: str
    current_value: float
    baseline_mean: float
    z_score: float
    severity: str
    detected_at: datetime


class BenchmarkResponse(BaseModel):
    """Farm benchmark result."""
    farm_id: str
    sensor_type: str
    farm_30d_avg: float
    region_30d_avg: float
    percentile_rank: float
    performance_band: str


class AlertResponse(BaseModel):
    """Alert details."""
    alert_id: int
    time: datetime
    farm_id: Optional[str]
    zone_id: Optional[str]
    rule_name: str
    severity: str
    metric: Optional[str]
    current_value: Optional[float]
    threshold: Optional[float]
    message: str
    acknowledged: bool
    resolved_at: Optional[datetime]


class PaginatedResponse(BaseModel):
    """Paginated list response."""
    items: list
    total: int
    page: int = 1
    page_size: int = 100
    has_more: bool = False
