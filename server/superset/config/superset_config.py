import os
from datetime import timedelta

# ── Core Configuration ──
SECRET_KEY = os.getenv("SUPERSET_SECRET_KEY", "smartfarm-superset-secret-2026")
SQLALCHEMY_DATABASE_URI = f"postgresql://superset:{os.getenv('DATABASE_PASSWORD', 'superset2026')}@{os.getenv('DATABASE_HOST', 'superset-db')}:5432/superset"

# ── Redis Cache ──
REDIS_HOST = os.getenv("REDIS_HOST", "superset-redis")
REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))

CACHE_CONFIG = {
    "CACHE_TYPE": "RedisCache",
    "CACHE_DEFAULT_TIMEOUT": 300,
    "CACHE_KEY_PREFIX": "superset_",
    "CACHE_REDIS_HOST": REDIS_HOST,
    "CACHE_REDIS_PORT": REDIS_PORT,
    "CACHE_REDIS_DB": 1,
}

DATA_CACHE_CONFIG = {
    "CACHE_TYPE": "RedisCache",
    "CACHE_DEFAULT_TIMEOUT": 600,
    "CACHE_KEY_PREFIX": "superset_data_",
    "CACHE_REDIS_HOST": REDIS_HOST,
    "CACHE_REDIS_PORT": REDIS_PORT,
    "CACHE_REDIS_DB": 2,
}

# ── Celery (Async Queries) ──
class CeleryConfig:
    broker_url = f"redis://{REDIS_HOST}:{REDIS_PORT}/0"
    result_backend = f"redis://{REDIS_HOST}:{REDIS_PORT}/1"
    imports = ("superset.sql_lab", "superset.tasks.scheduler")
    task_annotations = {
        "sql_lab.get_sql_results": {"rate_limit": "100/s"},
    }

CELERY_CONFIG = CeleryConfig

# ── Feature Flags ──
FEATURE_FLAGS = {
    "ALERT_REPORTS": True,
    "ENABLE_TEMPLATE_PROCESSING": False,
    "ENABLE_EXPLORE_DRAG_AND_DROP": True,
    "DASHBOARD_NATIVE_FILTERS": True,
    "DASHBOARD_CROSS_FILTERS": True,
    "ENABLE_EXPLORE_DATA_SOURCES": True,
    "EMBEDDED_SUPERSET": False,
    "ENABLE_ADVANCED_DATA_TYPES": True,
    "ENABLE_JAVASCRIPT_CONTROLS": False,
}

# ── Security ──
PREVENT_UNSAFE_DB_CONNECTIONS = False
WTF_CSRF_ENABLED = True
WTF_CSRF_EXEMPT_LIST = [
    "superset.views.core.log",
    "superset.charts.api",
]

# ── Query Timeouts ──
SQLLAB_TIMEOUT = 300
SUPERSET_WEBSERVER_TIMEOUT = 300
SQLLAB_ASYNC_TIME_LIMIT_SEC = 600

# ── Dashboard Settings ──
DASHBOARD_NATIVE_FILTERS_SETS = True

# ── Logging ──
LOG_FORMAT = "%(asctime)s:%(levelname)s:%(name)s:%(message)s"
LOG_LEVEL = "INFO"

# ── Misc ──
ENABLE_PROXY_FIX = True
PROXY_FIX_CONFIG = {"x_for": 1, "x_proto": 1, "x_host": 1, "x_port": 1}
