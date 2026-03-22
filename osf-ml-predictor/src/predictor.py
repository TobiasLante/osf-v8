"""
ML Predictor — AutoGluon TimeSeriesPredictor + TabularPredictor.
Pattern adapted from Flexware ProveIT ml-predictor (MIT License).
"""

import tempfile
import pandas as pd
import numpy as np
from typing import Optional
from .config import TRAINING_TIME_LIMIT, MIN_DATA_POINTS

# ── Time Series Prediction ────────────────────────────────────────

async def predict_time_series(
    df: pd.DataFrame,
    prediction_length: int = 24,
    field_name: str = "value",
) -> dict:
    """
    Train AutoGluon TimeSeriesPredictor and generate forecast.
    df must have 'timestamp' and 'value' columns.
    Returns: { predictions, historical, metrics }
    """
    if len(df) < MIN_DATA_POINTS:
        raise ValueError(f"Need at least {MIN_DATA_POINTS} data points, got {len(df)}")

    from autogluon.timeseries import TimeSeriesDataFrame, TimeSeriesPredictor

    # Prepare data for AutoGluon
    df = df.copy()
    df["item_id"] = field_name
    df = df.rename(columns={"value": "target"})

    ts_df = TimeSeriesDataFrame.from_data_frame(
        df[["item_id", "timestamp", "target"]],
        id_column="item_id",
        timestamp_column="timestamp",
    )

    # Train
    with tempfile.TemporaryDirectory() as tmp:
        predictor = TimeSeriesPredictor(
            prediction_length=prediction_length,
            path=tmp,
            target="target",
            eval_metric="MAPE",
            freq="h",  # hourly
        )
        predictor.fit(ts_df, time_limit=TRAINING_TIME_LIMIT, presets="medium_quality")

        # Predict
        predictions = predictor.predict(ts_df)

        # Extract results
        pred_df = predictions.reset_index()
        results = []
        for _, row in pred_df.iterrows():
            results.append({
                "date": str(row["timestamp"]),
                "value": round(float(row["mean"]), 4),
                "lower": round(float(row.get("0.1", row["mean"] * 0.8)), 4),
                "upper": round(float(row.get("0.9", row["mean"] * 1.2)), 4),
            })

        # Metrics from leaderboard
        leaderboard = predictor.leaderboard(ts_df)
        best_score = float(leaderboard.iloc[0]["score_val"]) if len(leaderboard) > 0 else None

        # Historical (last 30 points for chart)
        historical = []
        for _, row in df.tail(30).iterrows():
            historical.append({
                "date": str(row["timestamp"]),
                "value": round(float(row["target"]), 4),
            })

    return {
        "predictions": results,
        "historical": historical,
        "metrics": {"mape": best_score, "dataPoints": len(df)},
        "predictionLength": prediction_length,
    }


# ── Regression Analysis ───────────────────────────────────────────

async def regression_analysis(
    df: pd.DataFrame,
    target_col: str,
    feature_cols: list[str],
) -> dict:
    """
    AutoGluon TabularPredictor regression — find which features drive the target.
    Returns: { features, rSquared, intercept }
    """
    if len(df) < MIN_DATA_POINTS:
        raise ValueError(f"Need at least {MIN_DATA_POINTS} data points, got {len(df)}")

    from autogluon.tabular import TabularPredictor

    # Clean data
    cols = [target_col] + feature_cols
    clean_df = df[cols].dropna()

    if len(clean_df) < MIN_DATA_POINTS:
        raise ValueError(f"After dropping NaN: {len(clean_df)} rows, need {MIN_DATA_POINTS}")

    with tempfile.TemporaryDirectory() as tmp:
        predictor = TabularPredictor(
            label=target_col,
            problem_type="regression",
            eval_metric="r2",
            path=tmp,
            verbosity=0,
        )
        predictor.fit(clean_df, time_limit=TRAINING_TIME_LIMIT, presets="medium_quality")

        # Feature importance
        importance = predictor.feature_importance(clean_df)
        r2 = predictor.evaluate(clean_df).get("r2", None)

        features = []
        for feat_name in importance.index:
            features.append({
                "name": feat_name,
                "importance": round(float(importance.loc[feat_name, "importance"]), 4),
                "pValue": round(float(importance.loc[feat_name, "p_value"]), 4) if "p_value" in importance.columns else None,
            })

        # Sort by importance descending
        features.sort(key=lambda f: abs(f["importance"]), reverse=True)

    # Correlation matrix
    corr = clean_df.corr().round(4).to_dict()

    return {
        "target": target_col,
        "features": features,
        "rSquared": round(float(r2), 4) if r2 else None,
        "correlationMatrix": corr,
        "dataPoints": len(clean_df),
    }
