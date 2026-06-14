"""
FastAPI Analytics API
Exposes analytics queries, data export, and alert management endpoints.
"""

import os
from contextlib import asynccontextmanager

import psycopg2
import psycopg2.extras
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from routes.query import router as query_router
from routes.export import router as export_router
from routes.alerts import router as alerts_router

DB_DSN = os.getenv("DATABASE_URL", "postgresql://agritech:agritech@localhost:5432/agritech")


def get_db():
    """Get a database connection."""
    return psycopg2.connect(DB_DSN, cursor_factory=psycopg2.extras.RealDictCursor)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifecycle — startup/shutdown."""
    # Startup
    app.state.db_pool = None  # TODO: Use asyncpg pool for production
    yield
    # Shutdown
    pass


app = FastAPI(
    title="AgriTech Coffee Farm Analytics API",
    description="Analytics, export, and alerting for DakLak coffee farm sensor data",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS for frontend dashboards
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Restrict in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount routers
app.include_router(query_router, prefix="/v1/query", tags=["Analytics Queries"])
app.include_router(export_router, prefix="/v1/export", tags=["Data Export"])
app.include_router(alerts_router, prefix="/v1/alerts", tags=["Alert Management"])


@app.get("/health")
async def health():
    """Health check endpoint."""
    try:
        conn = get_db()
        with conn.cursor() as cur:
            cur.execute("SELECT 1")
        conn.close()
        return {"status": "healthy", "database": "connected"}
    except Exception as e:
        raise HTTPException(503, detail=f"Database connection failed: {e}")


@app.get("/v1/stats")
async def platform_stats():
    """Quick platform statistics for the dashboard header."""
    conn = get_db()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                SELECT
                    (SELECT COUNT(*) FROM farms WHERE is_active = TRUE) AS active_farms,
                    (SELECT COUNT(*) FROM zones) AS total_zones,
                    (SELECT COUNT(*) FROM sensors WHERE is_active = TRUE) AS active_sensors,
                    (SELECT COUNT(*) FROM sensor_readings
                     WHERE time >= NOW() - INTERVAL '24 hours') AS readings_24h,
                    (SELECT MAX(time) FROM sensor_readings) AS latest_reading,
                    (SELECT COUNT(*) FROM alerts
                     WHERE acknowledged = FALSE AND resolved_at IS NULL) AS active_alerts
            """)
            stats = dict(cur.fetchone())
            # Convert datetime to ISO string
            for k, v in stats.items():
                if hasattr(v, "isoformat"):
                    stats[k] = v.isoformat()
            return stats
    finally:
        conn.close()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
