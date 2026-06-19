import numpy as np
import pandas as pd
import psycopg2
import torch
import torch.nn as nn
import joblib
from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel
from typing import Optional, List
import uvicorn

INPUT_SIZE = 3

# Short model config (minute-level)
SHORT_WINDOW  = 30
SHORT_HORIZON = 15
SHORT_HIDDEN  = 64

# Long model config (hour-level)
LONG_WINDOW   = 48
LONG_HORIZON  = 24
LONG_HIDDEN   = 128


HORIZON_OPTIONS = {
    "6min":  {"steps": 6,  "model": "short"},
    "10min": {"steps": 10, "model": "short"},
    "15min": {"steps": 15, "model": "short"},
    "1h":    {"steps": 1,  "model": "long"},
    "3h":    {"steps": 3,  "model": "long"},
    "6h":    {"steps": 6,  "model": "long"},
    "12h":   {"steps": 12, "model": "long"},
    "24h":   {"steps": 24, "model": "long"},
}

import os
from dotenv import load_dotenv, find_dotenv
load_dotenv(find_dotenv())

DATABASE_URL = os.getenv("DATABASE_URL", "postgres://postgres:*Hs123456@localhost:5432/weather_dashboard")


# ============================================================
# Model — parametric so the same class handles both checkpoints
# ============================================================
class LSTMModel(nn.Module):
    def __init__(self, horizon, hidden_size=64, num_layers=2):
        super().__init__()
        self.horizon = horizon
        self.lstm = nn.LSTM(
            input_size  = INPUT_SIZE,
            hidden_size = hidden_size,
            num_layers  = num_layers,
            batch_first = True,
            dropout     = 0.3,
        )
        self.fc = nn.Linear(hidden_size, horizon * INPUT_SIZE)

    def forward(self, x):
        out, _ = self.lstm(x)
        out = self.fc(out[:, -1, :])
        return out.view(-1, self.horizon, INPUT_SIZE)


class LSTMModelLong(nn.Module):
    def __init__(self, horizon, hidden_size=128, num_layers=2):
        super().__init__()
        self.horizon = horizon
        self.lstm = nn.LSTM(
            input_size  = 7,
            hidden_size = hidden_size,
            num_layers  = num_layers,
            batch_first = True,
            dropout     = 0.3,
        )
        self.fc = nn.Linear(hidden_size, horizon * 3)

    def forward(self, x):
        out, _ = self.lstm(x)
        out = self.fc(out[:, -1, :])
        return out.view(-1, self.horizon, 3)



# ============================================================
# Load models at startup
# ============================================================
app = FastAPI(
    title       = "LSTM Forecast API",
    description = "Temperature & humidity forecast — short (6/10/15 min) and long (1h/3h/6h/12h/24h)",
    version     = "3.0.0",
)

model_short = LSTMModel(horizon=SHORT_HORIZON, hidden_size=SHORT_HIDDEN)
model_short.load_state_dict(torch.load("short_forecast/lstm_model.pth", map_location="cpu"))
model_short.eval()
scaler_short = joblib.load("short_forecast/scaler.pkl")
print("Short-horizon model loaded (short_forecast/lstm_model.pth).")

try:
    model_long = LSTMModelLong(horizon=LONG_HORIZON, hidden_size=LONG_HIDDEN)
    model_long.load_state_dict(torch.load("long_forecast/lstm_model_long.pth", map_location="cpu"))
    model_long.eval()
    scaler_long = joblib.load("long_forecast/scaler_long.pkl")
    long_model_ready = True
    print("Long-horizon model loaded (long_forecast/lstm_model_long.pth).")
except Exception as e:
    model_long       = None
    scaler_long      = None
    long_model_ready = False
    print(f"Long-horizon model could not be loaded: {e}")



# ============================================================
# Schema
# ============================================================
class ForecastPoint(BaseModel):
    timestamp:   str
    temperature: float
    humidity:    float
    aqi:         float

class ForecastResponse(BaseModel):
    device_id: Optional[int]
    horizon:   str
    steps:     int
    forecast:  List[ForecastPoint]


# ============================================================
# Helper: fetch latest N points at the given granularity
# ============================================================
def fetch_latest(device_id: Optional[int], granularity: str, window_size: int) -> pd.DataFrame:
    conn = psycopg2.connect(DATABASE_URL)
    where = f"AND device_id = {device_id}" if device_id else ""
    query = f"""
        SELECT
            date_trunc('{granularity}', timestamp) AS ts,
            AVG(temperature) AS temperature,
            AVG(humidity)    AS humidity,
            AVG(aqi)         AS aqi
        FROM readings
        WHERE aqi != 0 {where}
        GROUP BY date_trunc('{granularity}', timestamp)
        ORDER BY ts DESC
        LIMIT {window_size};
    """
    df = pd.read_sql(query, conn, parse_dates=["ts"])
    conn.close()

    if len(df) < window_size:
        raise HTTPException(
            status_code = 400,
            detail      = f"Not enough data: need {window_size} {granularity}-level points, have {len(df)}",
        )

    return df.iloc[::-1].reset_index(drop=True)


# ============================================================
# Route: GET /forecast
# ============================================================
@app.get("/forecast", response_model=ForecastResponse)
def forecast(
    device_id: Optional[int] = Query(default=None,   description="Device ID (omit for all devices)"),
    horizon:   str            = Query(default="6min", description="6min | 10min | 15min | 1h | 3h | 6h | 12h | 24h"),
):
    if horizon not in HORIZON_OPTIONS:
        raise HTTPException(
            status_code = 400,
            detail      = f"Invalid horizon. Choose one of: {list(HORIZON_OPTIONS.keys())}",
        )

    cfg        = HORIZON_OPTIONS[horizon]
    steps      = cfg["steps"]
    model_type = cfg["model"]

    if model_type == "long":
        if not long_model_ready:
            raise HTTPException(
                status_code = 503,
                detail      = "Long-horizon model not trained yet. Run lstm_train_long.py first.",
            )
        mdl         = model_long
        scl         = scaler_long
        window_size = LONG_WINDOW
        granularity = "hour"
        delta_fn    = lambda i: pd.Timedelta(hours=i + 1)
    else:
        mdl         = model_short
        scl         = scaler_short
        window_size = SHORT_WINDOW
        granularity = "minute"
        delta_fn    = lambda i: pd.Timedelta(minutes=i + 1)

    df = fetch_latest(device_id, granularity, window_size)

    if model_type == "long":
        hour = df["ts"].dt.hour
        dow  = df["ts"].dt.dayofweek
        df = df.copy()
        df["hour_sin"] = np.sin(2 * np.pi * hour / 24)
        df["hour_cos"] = np.cos(2 * np.pi * hour / 24)
        df["dow_sin"]  = np.sin(2 * np.pi * dow  / 7)
        df["dow_cos"]  = np.cos(2 * np.pi * dow  / 7)
        feature_cols = ["temperature", "humidity", "aqi", "hour_sin", "hour_cos", "dow_sin", "dow_cos"]
        scaled = scl.transform(df[feature_cols])
    else:
        scaled = scl.transform(df[["temperature", "humidity", "aqi"]])

    X = torch.tensor(scaled, dtype=torch.float32).unsqueeze(0)

    with torch.no_grad():
        pred_scaled = mdl(X).squeeze(0).numpy()

    if model_type == "long":
        pad = np.zeros((pred_scaled.shape[0], 4))
        pred_real = scl.inverse_transform(np.hstack([pred_scaled, pad]))[:steps, :3]
    else:
        pred_real = scl.inverse_transform(pred_scaled)[:steps]


    last_ts = df["ts"].iloc[-1]
    points  = [
        ForecastPoint(
            timestamp   = (last_ts + delta_fn(i)).isoformat(),
            temperature = round(float(pred_real[i, 0]), 2),
            humidity    = round(float(pred_real[i, 1]), 2),
            aqi         = round(float(pred_real[i, 2]), 2),
        )
        for i in range(steps)
    ]

    return ForecastResponse(
        device_id = device_id,
        horizon   = horizon,
        steps     = steps,
        forecast  = points,
    )


# ============================================================
# Route: GET /horizons
# ============================================================
@app.get("/horizons")
def list_horizons():
    return {
        "short": {
            "model_file": "lstm_model.pth",
            "granularity": "minute",
            "available": ["6min", "10min", "15min"],
        },
        "long": {
            "model_file": "lstm_model_long.pth",
            "granularity": "hour",
            "available": ["1h", "3h", "6h", "12h", "24h"],
            "ready": long_model_ready,
        },
    }


# ============================================================
# Route: GET /health
# ============================================================
@app.get("/health")
def health():
    return {
        "status":            "ok",
        "short_model_ready": True,
        "long_model_ready":  long_model_ready,
        "supported_horizons": list(HORIZON_OPTIONS.keys()),
    }


# ============================================================
# MAIN
# ============================================================
if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
