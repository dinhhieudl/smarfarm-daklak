"""
Feature Engineering for ML Pipeline
Transforms raw sensor data into features for yield prediction, disease risk, etc.
"""

import os
from datetime import date, timedelta

import numpy as np
import pandas as pd
import psycopg2

DB_DSN = os.getenv("DATABASE_URL", "postgresql://agritech:agritech@localhost:5432/agritech")


def load_farm_features(farm_id: str, year: int) -> dict:
    """
    Generate a feature vector for a farm for a given year.
    Used for yield prediction, disease risk, and other ML models.
    """
    conn = psycopg2.connect(DB_DSN)
    
    try:
        # Load daily aggregates for the year
        df = pd.read_sql("""
            SELECT bucket AS date, zone_id, sensor_type, avg_value, min_value, max_value
            FROM readings_daily
            WHERE farm_id = %s
                AND bucket >= %s AND bucket < %s
            ORDER BY bucket
        """, conn, params=(farm_id, f"{year}-01-01", f"{year + 1}-01-01"))

        if df.empty:
            return {}

        # Pivot to wide format: one column per sensor_type
        df_pivot = df.pivot_table(
            index=["date", "zone_id"],
            columns="sensor_type",
            values=["avg_value", "min_value", "max_value"],
            aggfunc="mean",
        ).reset_index()

        # Flatten column names
        df_pivot.columns = [f"{col[0]}_{col[1]}" if col[1] else col[0]
                           for col in df_pivot.columns]

        features = {"farm_id": farm_id, "year": year}

        # ---- Stage-based features ----
        stages = {
            "rest": (f"{year - 1}-11-01", f"{year}-01-31"),
            "flowering": (f"{year}-02-01", f"{year}-03-31"),
            "fruiting": (f"{year}-03-15", f"{year}-05-31"),
            "development": (f"{year}-06-01", f"{year}-08-31"),
            "ripening": (f"{year}-09-01", f"{year}-10-31"),
            "harvest": (f"{year}-10-15", f"{year}-11-15"),
        }

        for stage_name, (start, end) in stages.items():
            stage_df = df_pivot[
                (df_pivot["date"] >= start) & (df_pivot["date"] <= end)
            ]

            for sensor in ["soil_moisture", "soil_temperature", "ph", "ec",
                          "nitrogen", "phosphorus", "potassium"]:
                col = f"avg_value_{sensor}"
                if col in stage_df.columns:
                    vals = stage_df[col].dropna()
                    if not vals.empty:
                        features[f"{stage_name}_{sensor}_mean"] = round(vals.mean(), 2)
                        features[f"{stage_name}_{sensor}_std"] = round(vals.std(), 2)
                        features[f"{stage_name}_{sensor}_min"] = round(vals.min(), 2)
                        features[f"{stage_name}_{sensor}_max"] = round(vals.max(), 2)
                        features[f"{stage_name}_{sensor}_range"] = round(vals.max() - vals.min(), 2)

        # ---- Whole-year aggregate features ----
        for sensor in ["soil_moisture", "soil_temperature", "ph", "ec",
                      "nitrogen", "phosphorus", "potassium"]:
            col = f"avg_value_{sensor}"
            if col in df_pivot.columns:
                vals = df_pivot[col].dropna()
                if not vals.empty:
                    features[f"year_{sensor}_mean"] = round(vals.mean(), 2)
                    features[f"year_{sensor}_std"] = round(vals.std(), 2)

        # ---- Stress day counts ----
        if "avg_value_soil_moisture" in df_pivot.columns:
            moisture = df_pivot["avg_value_soil_moisture"].dropna()
            features["drought_days"] = int((moisture < 20).sum())
            features["waterlog_days"] = int((moisture > 80).sum())

        if "avg_value_soil_temperature" in df_pivot.columns:
            temp = df_pivot["avg_value_soil_temperature"].dropna()
            features["hot_days"] = int((temp > 35).sum())
            features["cold_days"] = int((temp < 12).sum())

        if "avg_value_ph" in df_pivot.columns:
            ph = df_pivot["avg_value_ph"].dropna()
            features["acid_days"] = int((ph < 4.5).sum())
            features["alkaline_days"] = int((ph > 7.0).sum())

        # ---- Trend features (early vs late season) ----
        if "avg_value_soil_moisture" in df_pivot.columns:
            early = df_pivot[df_pivot["date"] < f"{year}-06-01"]["avg_value_soil_moisture"].dropna()
            late = df_pivot[df_pivot["date"] >= f"{year}-06-01"]["avg_value_soil_moisture"].dropna()
            if not early.empty and not late.empty:
                features["moisture_trend"] = round(late.mean() - early.mean(), 2)

        return features
    finally:
        conn.close()


def build_training_dataset(years: list[int] = None) -> pd.DataFrame:
    """
    Build a training dataset combining soil features with yield records.
    """
    if years is None:
        years = list(range(2020, date.today().year))

    conn = psycopg2.connect(DB_DSN)
    try:
        # Get all farms with yield data
        yields = pd.read_sql("""
            SELECT farm_id, year, yield_kg_per_ha
            FROM yield_records
            WHERE year = ANY(%s)
        """, conn, params=(years,))

        # Load farm metadata
        farms = pd.read_sql("""
            SELECT farm_id, region_id, area_hectares, elevation_m,
                   coffee_variety, irrigation_type, planting_year
            FROM farms WHERE is_active = TRUE
        """, conn)

        # Generate features for each farm-year
        feature_rows = []
        for _, row in yields.iterrows():
            features = load_farm_features(row["farm_id"], int(row["year"]))
            if features:
                features["yield_kg_per_ha"] = row["yield_kg_per_ha"]
                # Add farm metadata
                farm_meta = farms[farms["farm_id"] == row["farm_id"]]
                if not farm_meta.empty:
                    for col in ["region_id", "area_hectares", "elevation_m",
                               "coffee_variety", "irrigation_type", "planting_year"]:
                        features[col] = farm_meta.iloc[0][col]
                feature_rows.append(features)

        df = pd.DataFrame(feature_rows)

        # Encode categoricals
        for col in ["coffee_variety", "irrigation_type"]:
            if col in df.columns:
                df[col] = df[col].astype("category").cat.codes

        # Farm age
        if "planting_year" in df.columns:
            df["farm_age"] = df["year"] - df["planting_year"]

        return df
    finally:
        conn.close()


if __name__ == "__main__":
    df = build_training_dataset()
    print(f"Training dataset: {df.shape[0]} samples, {df.shape[1]} features")
    df.to_csv("training_data.csv", index=False)
    print("Saved to training_data.csv")
