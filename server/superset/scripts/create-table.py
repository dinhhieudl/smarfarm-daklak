#!/usr/bin/env python3
"""Create soil_readings table in SmartFarm PostgreSQL"""
from superset.app import create_app
from sqlalchemy import text, create_engine

app = create_app()
with app.app_context():
    engine = create_engine('postgresql://chirpstack:chirpstack@postgres:5432/chirpstack')

    with engine.begin() as conn:
        # Create table
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS soil_readings (
                id SERIAL PRIMARY KEY,
                timestamp TIMESTAMP DEFAULT NOW(),
                zone VARCHAR(50),
                temperature REAL,
                moisture REAL,
                ec REAL,
                ph REAL,
                nitrogen REAL,
                phosphorus REAL,
                potassium REAL
            );
        """))
        print("Table created")

        # Insert data
        conn.execute(text("""
            INSERT INTO soil_readings (zone, temperature, moisture, ec, ph, nitrogen, phosphorus, potassium)
            SELECT
                'zone-A',
                25 + RANDOM() * 10,
                40 + RANDOM() * 30,
                300 + RANDOM() * 400,
                5.5 + RANDOM() * 1.5,
                100 + RANDOM() * 100,
                30 + RANDOM() * 40,
                150 + RANDOM() * 100
            FROM generate_series(1, 100);
        """))
        print("Data inserted (100 rows)")
