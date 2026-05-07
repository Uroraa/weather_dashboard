import numpy as np
import pandas as pd
import psycopg2
import torch
import torch.nn as nn
import joblib

# ============================================================
# CẤU HÌNH — phải khớp với lúc train
# ============================================================
WINDOW_SIZE  = 30
HORIZON      = 15   # model luôn output 15 bước
INPUT_SIZE   = 2
HIDDEN_SIZE  = 64
NUM_LAYERS   = 2

# Các mốc dự báo được hỗ trợ
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
# Load dữ liệu mới nhất từ DB
# ============================================================
def load_latest(device_id=None) -> pd.DataFrame:
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
        raise ValueError(
            f"Không đủ dữ liệu: cần {WINDOW_SIZE} điểm, hiện có {len(df)}"
        )

    return df.iloc[::-1].reset_index(drop=True)


# ============================================================
# Inference — chọn horizon: "6min" | "10min" | "15min"
# ============================================================
def predict(device_id=None, horizon_key: str = "6min") -> pd.DataFrame:
    if horizon_key not in HORIZON_OPTIONS:
        raise ValueError(f"horizon_key phải là một trong: {list(HORIZON_OPTIONS.keys())}")

    steps  = HORIZON_OPTIONS[horizon_key]
    device = torch.device("cpu")

    # Load model + scaler
    model = LSTMModel().to(device)
    model.load_state_dict(torch.load("lstm_model.pth", map_location=device))
    model.eval()
    scaler = joblib.load("scaler.pkl")

    # Lấy dữ liệu mới nhất
    df = load_latest(device_id)
    print(f"\nDữ liệu đầu vào ({WINDOW_SIZE} điểm gần nhất):")
    print(df[["ts", "temperature", "humidity"]].to_string(index=False))

    # Chuẩn hóa + inference
    scaled = scaler.transform(df[["temperature", "humidity"]])
    X = torch.tensor(scaled, dtype=torch.float32).unsqueeze(0).to(device)

    with torch.no_grad():
        pred_scaled = model(X).squeeze(0).cpu().numpy()  # (15, 2)

    # Inverse transform toàn bộ 15 bước rồi slice
    pred_real = scaler.inverse_transform(pred_scaled)    # (15, 2)
    pred_real = pred_real[:steps]                        # lấy đúng số bước cần

    # Tạo timestamps
    last_ts   = df["ts"].iloc[-1]
    future_ts = [last_ts + pd.Timedelta(minutes=i + 1) for i in range(steps)]

    result = pd.DataFrame({
        "thoi_gian": future_ts,
        "nhiet_do":  pred_real[:, 0].round(2),
        "do_am":     pred_real[:, 1].round(2),
    })

    print(f"\nDự báo {horizon_key} tiếp theo ({steps} điểm):")
    print(result.to_string(index=False))
    return result


# ============================================================
# Đánh giá sai số MAE theo từng horizon
# ============================================================
def evaluate_real_error():
    conn = psycopg2.connect(**DB_CONFIG)
    query = """
        SELECT
            date_trunc('minute', timestamp) AS ts,
            AVG(temperature) AS temperature,
            AVG(humidity)    AS humidity
        FROM readings
        GROUP BY date_trunc('minute', timestamp)
        ORDER BY ts ASC;
    """
    df = pd.read_sql(query, conn, parse_dates=["ts"])
    conn.close()
    df = df.dropna()

    scaler = joblib.load("scaler.pkl")
    model  = LSTMModel()
    model.load_state_dict(torch.load("lstm_model.pth", map_location="cpu"))
    model.eval()

    scaled = scaler.transform(df[["temperature", "humidity"]])
    preds, actuals = [], []

    for i in range(len(scaled) - WINDOW_SIZE - HORIZON + 1):
        X = torch.tensor(
            scaled[i : i + WINDOW_SIZE], dtype=torch.float32
        ).unsqueeze(0)
        y_true = scaled[i + WINDOW_SIZE : i + WINDOW_SIZE + HORIZON]

        with torch.no_grad():
            y_pred = model(X).squeeze(0).numpy()

        preds.append(y_pred)
        actuals.append(y_true)

    preds   = np.array(preds)    # (N, 15, 2)
    actuals = np.array(actuals)  # (N, 15, 2)

    print("\n=== Sai số MAE theo từng mốc dự báo ===")
    for key, steps in HORIZON_OPTIONS.items():
        # Inverse transform từng mốc
        p = scaler.inverse_transform(preds[:, steps - 1, :])
        a = scaler.inverse_transform(actuals[:, steps - 1, :])
        mae_temp = np.mean(np.abs(p[:, 0] - a[:, 0]))
        mae_humi = np.mean(np.abs(p[:, 1] - a[:, 1]))
        print(f"  [{key}] MAE nhiệt độ: {mae_temp:.3f} °C | MAE độ ẩm: {mae_humi:.3f} %")


# ============================================================
# MAIN
# ============================================================
if __name__ == "__main__":
    # Thử cả 3 mốc
    for key in HORIZON_OPTIONS:
        predict(horizon_key=key)

    print("\n--- Đánh giá sai số thực tế ---")
    evaluate_real_error()
