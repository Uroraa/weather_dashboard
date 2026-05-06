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

# ============================================================
# CẤU HÌNH — phải khớp với lúc train
# ============================================================
WINDOW_SIZE  = 30
HORIZON      = 15
INPUT_SIZE   = 2
HIDDEN_SIZE  = 64
NUM_LAYERS   = 2

HORIZON_OPTIONS = {
    "6min":  6,
    "10min": 10,
    "15min": 15,
}

DB_CONFIG = {
    "host":     "localhost",
    "database": "weather_dashboard",
    "user":     "postgres",
    "password": "*Hs123456",
}


# ============================================================
# Model
# ============================================================
class LSTMModel(nn.Module):
    def __init__(self):
        super().__init__()
        self.lstm = nn.LSTM(
            input_size  = INPUT_SIZE,
            hidden_size = HIDDEN_SIZE,
            num_layers  = NUM_LAYERS,
            batch_first = True,
            dropout     = 0.3,
        )
        self.fc = nn.Linear(HIDDEN_SIZE, HORIZON * INPUT_SIZE)

    def forward(self, x):
        out, _ = self.lstm(x)
        out = self.fc(out[:, -1, :])
        return out.view(-1, HORIZON, INPUT_SIZE)


# ============================================================
# Load model + scaler 1 lần khi khởi động server
# ============================================================
app    = FastAPI(
    title       = "LSTM Forecast API",
    description = "Dự báo nhiệt độ & độ ẩm theo mốc 6 / 10 / 15 phút",
    version     = "2.0.0",
)

model = LSTMModel()
model.load_state_dict(torch.load("lstm_model.pth", map_location="cpu"))
model.eval()
scaler = joblib.load("scaler.pkl")
print("Model và scaler đã load xong.")


# ============================================================
# Schema
# ============================================================
class ForecastPoint(BaseModel):
    timestamp:   str
    temperature: float
    humidity:    float

class ForecastResponse(BaseModel):
    device_id:   Optional[int]
    horizon:     str
    steps:       int
    forecast:    List[ForecastPoint]


# ============================================================
# Helper: lấy dữ liệu mới nhất từ DB
# ============================================================
def fetch_latest(device_id: Optional[int] = None) -> pd.DataFrame:
    conn = psycopg2.connect(**DB_CONFIG)
    where = f"WHERE device_id = {device_id}" if device_id else ""
    query = f"""
        SELECT
            date_trunc('minute', timestamp) AS ts,
            AVG(temperature) AS temperature,
            AVG(humidity)    AS humidity
        FROM readings
        {where}
        GROUP BY date_trunc('minute', timestamp)
        ORDER BY ts DESC
        LIMIT {WINDOW_SIZE};
    """
    df = pd.read_sql(query, conn, parse_dates=["ts"])
    conn.close()

    if len(df) < WINDOW_SIZE:
        raise HTTPException(
            status_code = 400,
            detail      = f"Không đủ dữ liệu: cần {WINDOW_SIZE} điểm, hiện có {len(df)}",
        )

    return df.iloc[::-1].reset_index(drop=True)


# ============================================================
# Route: GET /forecast
# ============================================================
@app.get("/forecast", response_model=ForecastResponse)
def forecast(
    device_id: Optional[int] = Query(default=None,  description="ID thiết bị (bỏ trống = tất cả)"),
    horizon:   str            = Query(default="6min", description="Mốc dự báo: 6min | 10min | 15min"),
):
    if horizon not in HORIZON_OPTIONS:
        raise HTTPException(
            status_code = 400,
            detail      = f"horizon không hợp lệ. Chọn một trong: {list(HORIZON_OPTIONS.keys())}",
        )

    steps = HORIZON_OPTIONS[horizon]
    df    = fetch_latest(device_id)

    # Chuẩn hóa + inference
    scaled = scaler.transform(df[["temperature", "humidity"]])
    X = torch.tensor(scaled, dtype=torch.float32).unsqueeze(0)

    with torch.no_grad():
        pred_scaled = model(X).squeeze(0).numpy()   # (15, 2)

    # Inverse transform rồi slice
    pred_real = scaler.inverse_transform(pred_scaled)[:steps]  # (steps, 2)

    # Tạo timestamps
    last_ts = df["ts"].iloc[-1]
    points  = [
        ForecastPoint(
            timestamp   = (last_ts + pd.Timedelta(minutes=i + 1)).isoformat(),
            temperature = round(float(pred_real[i, 0]), 2),
            humidity    = round(float(pred_real[i, 1]), 2),
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
# Route: GET /horizons — liệt kê các mốc được hỗ trợ
# ============================================================
@app.get("/horizons")
def list_horizons():
    return {
        "available_horizons": list(HORIZON_OPTIONS.keys()),
        "description": {
            "6min":  "Dự báo 6 phút tiếp theo",
            "10min": "Dự báo 10 phút tiếp theo",
            "15min": "Dự báo 15 phút tiếp theo",
        }
    }


# ============================================================
# Route: GET /health
# ============================================================
@app.get("/health")
def health():
    return {
        "status":  "ok",
        "model":   "LSTM v2",
        "window":  WINDOW_SIZE,
        "horizon": HORIZON,
        "supported_horizons": list(HORIZON_OPTIONS.keys()),
    }


# ============================================================
# MAIN
# ============================================================
if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
