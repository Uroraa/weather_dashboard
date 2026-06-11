import math

import joblib
import numpy as np
import pandas as pd
import psycopg2
import torch
import torch.nn as nn

# ============================================================
# CẤU HÌNH — phải khớp với lstm_train_long.py
# ============================================================
DEVICE_ID    = 12
WINDOW_SIZE  = 48
HORIZON      = 24   # model luôn output 24 bước
INPUT_SIZE   = 7    # temperature, humidity, aqi, hour_sin, hour_cos, dow_sin, dow_cos
HIDDEN_SIZE  = 128
NUM_LAYERS   = 2
FEATURE_COLS = ["temperature", "humidity", "aqi", "hour_sin", "hour_cos", "dow_sin", "dow_cos"]

# Các mốc dự báo được hỗ trợ
HORIZON_OPTIONS = {
    "1h":  1,
    "3h":  3,
    "6h":  6,
    "12h": 12,
    "24h": 24,
}

import os
from dotenv import load_dotenv, find_dotenv
load_dotenv(find_dotenv())

DATABASE_URL = os.getenv("DATABASE_URL", "postgres://postgres:*Hs123456@localhost:5432/weather_dashboard")


# ============================================================
# Model — phải khớp kiến trúc với lúc train
# ============================================================
class LSTMModelLong(nn.Module):
    def __init__(self):
        super().__init__()
        self.lstm = nn.LSTM(
            input_size  = INPUT_SIZE,
            hidden_size = HIDDEN_SIZE,
            num_layers  = NUM_LAYERS,
            batch_first = True,
            dropout     = 0.3,
        )
        # Output chỉ temperature + humidity + aqi
        self.fc = nn.Linear(HIDDEN_SIZE, HORIZON * 3)

    def forward(self, x):
        out, _ = self.lstm(x)
        out = self.fc(out[:, -1, :])
        return out.view(-1, HORIZON, 3)


# ============================================================
# Time features — phải khớp với lúc train
# ============================================================
def add_time_features(df: pd.DataFrame) -> pd.DataFrame:
    """df phải có cột 'ts' kiểu datetime."""
    hour = df["ts"].dt.hour
    dow  = df["ts"].dt.dayofweek
    df = df.copy()
    df["hour_sin"] = np.sin(2 * math.pi * hour / 24)
    df["hour_cos"] = np.cos(2 * math.pi * hour / 24)
    df["dow_sin"]  = np.sin(2 * math.pi * dow  / 7)
    df["dow_cos"]  = np.cos(2 * math.pi * dow  / 7)
    return df


# ============================================================
# Inverse transform — scaler fit trên 6 features, output chỉ 2
# ============================================================
def inverse_transform_output(scaler, arr: np.ndarray) -> np.ndarray:
    """
    arr shape: (N, 3) — scaled temperature & humidity & aqi.
    Padding về 7 cột để dùng scaler, rồi lấy lại 3 cột đầu.
    """
    pad = np.zeros((arr.shape[0], 4))
    return scaler.inverse_transform(np.hstack([arr, pad]))[:, :3]


# ============================================================
# Load dữ liệu mới nhất từ DB
# ============================================================
def load_latest(device_id: int = DEVICE_ID) -> pd.DataFrame:
    conn = psycopg2.connect(DATABASE_URL)
    query = f"""
        SELECT
            date_trunc('hour', timestamp) AS ts,
            AVG(temperature) AS temperature,
            AVG(humidity)    AS humidity,
            AVG(aqi)         AS aqi
        FROM readings
        WHERE device_id = {device_id}
        GROUP BY date_trunc('hour', timestamp)
        ORDER BY ts DESC
        LIMIT {WINDOW_SIZE};
    """
    df = pd.read_sql(query, conn, parse_dates=["ts"])
    conn.close()

    if len(df) < WINDOW_SIZE:
        raise ValueError(
            f"Không đủ dữ liệu: cần {WINDOW_SIZE} giờ, hiện có {len(df)} giờ"
        )

    return df.iloc[::-1].reset_index(drop=True)


# ============================================================
# Inference — chọn horizon: "1h" | "3h" | "6h" | "12h" | "24h"
# ============================================================
def predict(device_id: int = DEVICE_ID, horizon_key: str = "6h") -> pd.DataFrame:
    if horizon_key not in HORIZON_OPTIONS:
        raise ValueError(f"horizon_key phải là một trong: {list(HORIZON_OPTIONS.keys())}")

    steps  = HORIZON_OPTIONS[horizon_key]
    device = torch.device("cpu")

    # Load model + scaler
    model = LSTMModelLong().to(device)
    model.load_state_dict(torch.load("lstm_model_long.pth", map_location=device))
    model.eval()
    scaler = joblib.load("scaler_long.pkl")

    # Lấy & xử lý dữ liệu
    df = load_latest(device_id)
    df = add_time_features(df)

    print(f"\nDữ liệu đầu vào ({WINDOW_SIZE} giờ gần nhất):")
    print(df[["ts", "temperature", "humidity"]].to_string(index=False))

    # Chuẩn hóa + inference
    scaled = scaler.transform(df[FEATURE_COLS])
    X = torch.tensor(scaled, dtype=torch.float32).unsqueeze(0).to(device)

    with torch.no_grad():
        pred_scaled = model(X).squeeze(0).cpu().numpy()  # (24, 2)

    # Inverse transform rồi slice đúng số bước cần
    pred_real = inverse_transform_output(scaler, pred_scaled)  # (24, 2)
    pred_real = pred_real[:steps]

    # Tạo timestamps
    last_ts   = df["ts"].iloc[-1]
    future_ts = [last_ts + pd.Timedelta(hours=i + 1) for i in range(steps)]

    result = pd.DataFrame({
        "thoi_gian": future_ts,
        "nhiet_do":  pred_real[:, 0].round(2),
        "do_am":     pred_real[:, 1].round(2),
        "aqi":       pred_real[:, 2].round(2),
    })

    print(f"\nDự báo {horizon_key} tiếp theo ({steps} điểm):")
    print(result.to_string(index=False))
    return result


# ============================================================
# Đánh giá sai số MAE theo từng horizon
# ============================================================
def evaluate_real_error(device_id: int = DEVICE_ID):
    conn = psycopg2.connect(DATABASE_URL)
    query = f"""
        SELECT
            date_trunc('hour', timestamp) AS ts,
            AVG(temperature) AS temperature,
            AVG(humidity)    AS humidity,
            AVG(aqi)         AS aqi
        FROM readings
        WHERE device_id = {device_id}
        GROUP BY date_trunc('hour', timestamp)
        ORDER BY ts ASC;
    """
    df = pd.read_sql(query, conn, parse_dates=["ts"])
    conn.close()
    df = df.dropna()
    df = add_time_features(df)

    scaler = joblib.load("scaler_long.pkl")
    model  = LSTMModelLong()
    model.load_state_dict(torch.load("lstm_model_long.pth", map_location="cpu"))
    model.eval()

    scaled = scaler.transform(df[FEATURE_COLS])
    preds, actuals = [], []

    for i in range(len(scaled) - WINDOW_SIZE - HORIZON + 1):
        X = torch.tensor(
            scaled[i : i + WINDOW_SIZE], dtype=torch.float32
        ).unsqueeze(0)
        y_true = scaled[i + WINDOW_SIZE : i + WINDOW_SIZE + HORIZON, :3]

        with torch.no_grad():
            y_pred = model(X).squeeze(0).numpy()

        preds.append(y_pred)
        actuals.append(y_true)

    preds   = np.array(preds)    # (N, 24, 2)
    actuals = np.array(actuals)  # (N, 24, 2)

    print(f"\n=== Sai số MAE theo từng mốc dự báo (device {device_id}) ===")
    for key, steps in HORIZON_OPTIONS.items():
        p = inverse_transform_output(scaler, preds[:, steps - 1, :])
        a = inverse_transform_output(scaler, actuals[:, steps - 1, :])
        mae_temp = np.mean(np.abs(p[:, 0] - a[:, 0]))
        mae_humi = np.mean(np.abs(p[:, 1] - a[:, 1]))
        mae_aqi  = np.mean(np.abs(p[:, 2] - a[:, 2]))
        print(f"  [{key:>3s}] MAE nhiệt độ: {mae_temp:.3f} °C | MAE độ ẩm: {mae_humi:.3f} % | MAE AQI: {mae_aqi:.3f}")


# ============================================================
# MAIN
# ============================================================
if __name__ == "__main__":
    for key in HORIZON_OPTIONS:
        predict(device_id=DEVICE_ID, horizon_key=key)

    print("\n--- Đánh giá sai số thực tế ---")
    evaluate_real_error(device_id=DEVICE_ID)