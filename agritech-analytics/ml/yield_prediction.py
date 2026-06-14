"""
Yield Prediction Model
Uses soil sensor data and weather to predict coffee yield per farm.

Model: XGBoost with time-series features
Target: yield_kg_per_ha (annual)
"""

import os
import pickle
from datetime import date

import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingRegressor, RandomForestRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import cross_val_score, train_test_split
from sklearn.preprocessing import StandardScaler

from features import build_training_dataset

# ============================================================
# Model Training
# ============================================================

class YieldPredictor:
    """
    Predicts coffee yield (kg/ha) based on soil sensor features.
    
    Features include:
    - Stage-based soil metrics (mean, std, min, max per crop stage)
    - Stress day counts (drought, waterlog, heat, cold)
    - Seasonal trends (early vs late season moisture)
    - Farm metadata (age, variety, elevation, irrigation)
    
    Model: Gradient Boosting (handles non-linear relationships well)
    """

    def __init__(self):
        self.model = GradientBoostingRegressor(
            n_estimators=200,
            max_depth=5,
            learning_rate=0.05,
            subsample=0.8,
            min_samples_leaf=5,
            random_state=42,
        )
        self.scaler = StandardScaler()
        self.feature_columns = None
        self.is_trained = False
        self.metrics = {}

    def train(self, df: pd.DataFrame = None):
        """
        Train the yield prediction model.
        
        Args:
            df: Training DataFrame. If None, loads from database.
        """
        if df is None:
            print("Loading training data from database...")
            df = build_training_dataset()

        print(f"Training data: {df.shape[0]} samples, {df.shape[1]} features")

        # Separate features and target
        target_col = "yield_kg_per_ha"
        exclude_cols = {"farm_id", "year", target_col}
        self.feature_columns = [c for c in df.columns if c not in exclude_cols]

        X = df[self.feature_columns].fillna(0)
        y = df[target_col]

        # Train/test split
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.2, random_state=42
        )

        # Scale features
        X_train_scaled = self.scaler.fit_transform(X_train)
        X_test_scaled = self.scaler.transform(X_test)

        # Train model
        print("Training model...")
        self.model.fit(X_train_scaled, y_train)

        # Evaluate
        y_pred = self.model.predict(X_test_scaled)
        self.metrics = {
            "mae": round(mean_absolute_error(y_test, y_pred), 1),
            "rmse": round(np.sqrt(mean_squared_error(y_test, y_pred)), 1),
            "r2": round(r2_score(y_test, y_pred), 3),
            "mape": round(np.mean(np.abs((y_test - y_pred) / y_test)) * 100, 1),
        }

        # Cross-validation
        cv_scores = cross_val_score(
            self.model, X_train_scaled, y_train,
            cv=5, scoring="neg_mean_absolute_error"
        )
        self.metrics["cv_mae"] = round(-cv_scores.mean(), 1)
        self.metrics["cv_mae_std"] = round(cv_scores.std(), 1)

        print(f"Model Performance:")
        print(f"  MAE:  {self.metrics['mae']} kg/ha")
        print(f"  RMSE: {self.metrics['rmse']} kg/ha")
        print(f"  R²:   {self.metrics['r2']}")
        print(f"  MAPE: {self.metrics['mape']}%")
        print(f"  CV MAE: {self.metrics['cv_mae']} ± {self.metrics['cv_mae_std']} kg/ha")

        self.is_trained = True

        # Feature importance
        importance = pd.DataFrame({
            "feature": self.feature_columns,
            "importance": self.model.feature_importances_,
        }).sort_values("importance", ascending=False)

        print(f"\nTop 15 Features:")
        for _, row in importance.head(15).iterrows():
            print(f"  {row['feature']:40s} {row['importance']:.4f}")

        return self

    def predict(self, features: dict) -> dict:
        """
        Predict yield for a single farm.
        
        Args:
            features: Dictionary of feature values.
            
        Returns:
            Prediction with confidence interval.
        """
        if not self.is_trained:
            raise RuntimeError("Model not trained. Call train() first.")

        # Build feature vector
        X = pd.DataFrame([{col: features.get(col, 0) for col in self.feature_columns}])
        X_scaled = self.scaler.transform(X)

        # Point prediction
        prediction = self.model.predict(X_scaled)[0]

        # Confidence interval using individual tree predictions
        tree_predictions = np.array([
            tree.predict(X_scaled)[0]
            for tree in self.model.estimators_.flatten()
        ])
        ci_lower = np.percentile(tree_predictions, 5)
        ci_upper = np.percentile(tree_predictions, 95)

        return {
            "predicted_yield_kg_ha": round(prediction, 1),
            "confidence_interval": {
                "lower": round(ci_lower, 1),
                "upper": round(ci_upper, 1),
            },
            "confidence_level": 90,
        }

    def save(self, path: str = "yield_model.pkl"):
        """Save trained model to disk."""
        with open(path, "wb") as f:
            pickle.dump({
                "model": self.model,
                "scaler": self.scaler,
                "feature_columns": self.feature_columns,
                "metrics": self.metrics,
            }, f)
        print(f"Model saved to {path}")

    @classmethod
    def load(cls, path: str = "yield_model.pkl") -> "YieldPredictor":
        """Load a trained model from disk."""
        with open(path, "rb") as f:
            data = pickle.load(f)

        predictor = cls()
        predictor.model = data["model"]
        predictor.scaler = data["scaler"]
        predictor.feature_columns = data["feature_columns"]
        predictor.metrics = data["metrics"]
        predictor.is_trained = True
        return predictor


# ============================================================
# Disease Risk Model (simplified)
# ============================================================

class DiseaseRiskPredictor:
    """
    Predicts disease risk based on environmental conditions.
    
    High-risk conditions for coffee diseases:
    - Coffee Rust (Hemileia vastatrix): High moisture + moderate temp (20-28°C)
    - Root Rot (Fusarium): Waterlogged soil + poor drainage
    - Cercospora Leaf Spot: High humidity + warm temp
    """

    RISK_THRESHOLDS = {
        "coffee_rust": {
            "moisture_range": (60, 85),
            "temp_range": (20, 28),
            "humidity_threshold": 70,
        },
        "root_rot": {
            "moisture_threshold": 75,
            "duration_days": 7,
            "ec_threshold": 3.0,
        },
        "cercospora": {
            "temp_range": (22, 30),
            "moisture_range": (55, 75),
            "humidity_threshold": 65,
        },
    }

    def assess_risk(self, features: dict) -> dict:
        """
        Assess disease risk based on current/predicted conditions.
        Returns risk level (low/medium/high) for each disease.
        """
        risks = {}

        # Coffee Rust
        moisture = features.get("flowering_soil_moisture_mean", 50)
        temp = features.get("flowering_soil_temperature_mean", 25)
        rust = self.RISK_THRESHOLDS["coffee_rust"]

        if (rust["moisture_range"][0] <= moisture <= rust["moisture_range"][1] and
            rust["temp_range"][0] <= temp <= rust["temp_range"][1]):
            risks["coffee_rust"] = "HIGH"
        elif moisture > 55 and 18 <= temp <= 30:
            risks["coffee_rust"] = "MEDIUM"
        else:
            risks["coffee_rust"] = "LOW"

        # Root Rot
        waterlog_days = features.get("waterlog_days", 0)
        ec = features.get("development_ec_mean", 1.0)
        if waterlog_days > 7 or ec > 3.0:
            risks["root_rot"] = "HIGH"
        elif waterlog_days > 3 or ec > 2.0:
            risks["root_rot"] = "MEDIUM"
        else:
            risks["root_rot"] = "LOW"

        # Cercospora
        dev_temp = features.get("development_soil_temperature_mean", 25)
        dev_moisture = features.get("development_soil_moisture_mean", 45)
        if (22 <= dev_temp <= 30 and 55 <= dev_moisture <= 75):
            risks["cercospora"] = "HIGH"
        elif 20 <= dev_temp <= 32 and dev_moisture > 50:
            risks["cercospora"] = "MEDIUM"
        else:
            risks["cercospora"] = "LOW"

        # Overall risk
        risk_levels = {"LOW": 0, "MEDIUM": 1, "HIGH": 2}
        max_risk = max(risk_levels.get(r, 0) for r in risks.values())
        overall = {v: k for k, v in risk_levels.items()}[max_risk]

        return {
            "diseases": risks,
            "overall_risk": overall,
            "recommendations": self._get_recommendations(risks),
        }

    def _get_recommendations(self, risks: dict) -> list[str]:
        recs = []
        if risks.get("coffee_rust") == "HIGH":
            recs.append("Apply copper-based fungicide preventively. Improve air circulation by pruning.")
        if risks.get("root_rot") == "HIGH":
            recs.append("Improve drainage immediately. Reduce irrigation frequency. Apply Trichoderma.")
        if risks.get("cercospora") == "HIGH":
            recs.append("Apply protective fungicide. Remove infected leaves. Ensure balanced nutrition.")
        if not recs:
            recs.append("Continue current management practices. Monitor regularly.")
        return recs


# ============================================================
# CLI
# ============================================================

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="AgriTech ML Pipeline")
    parser.add_argument("action", choices=["train", "predict", "evaluate"])
    parser.add_argument("--farm-id", help="Farm UUID for prediction")
    parser.add_argument("--year", type=int, default=date.today().year)
    parser.add_argument("--model-path", default="yield_model.pkl")

    args = parser.parse_args()

    if args.action == "train":
        predictor = YieldPredictor()
        predictor.train()
        predictor.save(args.model_path)

    elif args.action == "predict":
        if not args.farm_id:
            print("--farm-id required for prediction")
            exit(1)

        from features import load_farm_features

        predictor = YieldPredictor.load(args.model_path)
        features = load_farm_features(args.farm_id, args.year)
        result = predictor.predict(features)
        print(f"\nYield Prediction for {args.farm_id} ({args.year}):")
        print(f"  Predicted: {result['predicted_yield_kg_ha']} kg/ha")
        print(f"  90% CI:    {result['confidence_interval']['lower']} - {result['confidence_interval']['upper']} kg/ha")

    elif args.action == "evaluate":
        predictor = YieldPredictor.load(args.model_path)
        print(f"Model Metrics: {predictor.metrics}")
