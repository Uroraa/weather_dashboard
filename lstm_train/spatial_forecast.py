import numpy as np
import pandas as pd
import psycopg2
from pykrige.ok import OrdinaryKriging
from scipy.interpolate import griddata
import joblib
import torch
import torch.nn as nn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional
import uvicorn

# ============================================================
# Cấu hình — phải khớp với lstm_train.py
# ============================================================
WINDOW_SIZE  = 30   # match training config
HORIZON      = 15
INPUT_SIZE   = 2
HIDDEN_SIZE  = 64
NUM_LAYERS   = 2

# Grid nội suy 10×8m, 50×40 điểm
GRID_X = np.linspace(0, 10, 50)
GRID_Y = np.linspace(0, 8,  40)

DB_CONFIG = {
    "host":     "localhost",
    "database": "weather_dashboard",
    "user":     "postgres",
    "password": "*Hs123456",
}

# ============================================================
# LSTM Model
# ============================================================
class LSTMModel(nn.Module):
    def __init__(self):
        super().__init__()
        self.lstm = nn.LSTM(
            input_size=INPUT_SIZE,
            hidden_size=HIDDEN_SIZE,
            num_layers=NUM_LAYERS,
            batch_first=True,
            dropout=0.2
        )
        self.fc = nn.Linear(HIDDEN_SIZE, HORIZON * INPUT_SIZE)

    def forward(self, x):
        out, _ = self.lstm(x)
        out = self.fc(out[:, -1, :])
        return out.view(-1, HORIZON, INPUT_SIZE)


# ============================================================
# Load model + scaler 1 lần khi khởi động
# ============================================================
app    = FastAPI(title="LSTM + Kriging Forecast API")
model  = LSTMModel()
model.load_state_dict(torch.load("lstm_model.pth", map_location="cpu"))
model.eval()
scaler = joblib.load("scaler.pkl")
print("Model và scaler đã load xong.")


# ============================================================
# Helper: lấy dữ liệu DB
# ============================================================
def get_conn():
    return psycopg2.connect(**DB_CONFIG)


def fetch_devices() -> pd.DataFrame:
    """Lấy danh sách thiết bị và tọa độ từ DB."""
    conn = get_conn()
    df = pd.read_sql(
        "SELECT id, name, x, y FROM devices WHERE x IS NOT NULL AND y IS NOT NULL",
        conn
    )
    conn.close()
    return df


def fetch_latest_for_device(device_id: int) -> np.ndarray:
    """Lấy WINDOW_SIZE điểm gần nhất (theo phút) của 1 device, trả về array (WINDOW_SIZE, 2)."""
    conn = get_conn()
    query = f"""
        SELECT
            date_trunc('minute', timestamp) AS ts,
            AVG(temperature) AS temperature,
            AVG(humidity)    AS humidity
        FROM readings
        WHERE device_id = {device_id}
        GROUP BY date_trunc('minute', timestamp)
        ORDER BY ts DESC
        LIMIT {WINDOW_SIZE};
    """
    df = pd.read_sql(query, conn, parse_dates=["ts"])
    conn.close()
    df = df.iloc[::-1].reset_index(drop=True)
    return df[["temperature", "humidity"]].values  # (WINDOW_SIZE, 2)


def fetch_current_reading_for_device(device_id: int) -> Optional[dict]:
    """Lấy reading thực tế mới nhất của device (không groupby)."""
    conn = get_conn()
    df = pd.read_sql(
        f"SELECT temperature, humidity FROM readings WHERE device_id = {device_id} ORDER BY timestamp DESC LIMIT 1",
        conn
    )
    conn.close()
    if df.empty:
        return None
    return {"temp": float(df.iloc[0]["temperature"]), "humi": float(df.iloc[0]["humidity"])}


# ============================================================
# LSTM inference cho 1 device
# ============================================================
def lstm_forecast(data: np.ndarray) -> np.ndarray:
    """
    data: (WINDOW_SIZE, 2)
    return: (HORIZON, 2) — giá trị thực sau inverse_transform
    """
    scaled = scaler.transform(data)
    X = torch.tensor(scaled, dtype=torch.float32).unsqueeze(0)
    with torch.no_grad():
        pred = model(X).squeeze(0).numpy()
    return scaler.inverse_transform(pred)  # (HORIZON, 2)


# ============================================================
# Tạo virtual nodes từ 2 node thật
# ============================================================
def make_virtual_nodes(real_nodes: list[dict]) -> list[dict]:
    """
    real_nodes: [{"x":1,"y":1,"temp":...,"humi":...}, {"x":9,"y":7,...}]
    Thêm 2 node ảo ở (1,7) và (9,1) bằng trung bình có trọng số IDW.
    """
    def idw_value(target_x, target_y, nodes, power=2):
        weights, temp_sum, humi_sum = 0, 0, 0
        for n in nodes:
            d = np.sqrt((target_x - n["x"])**2 + (target_y - n["y"])**2)
            d = max(d, 1e-6)
            w = 1 / d**power
            weights  += w
            temp_sum += w * n["temp"]
            humi_sum += w * n["humi"]
        return temp_sum / weights, humi_sum / weights

    virtual_coords = [
        (real_nodes[0]["x"], real_nodes[1]["y"]),   # (1, 7)
        (real_nodes[1]["x"], real_nodes[0]["y"]),   # (9, 1)
    ]

    virtual = []
    for vx, vy in virtual_coords:
        t, h = idw_value(vx, vy, real_nodes)
        virtual.append({"x": vx, "y": vy, "temp": t, "humi": h, "virtual": True})

    return virtual


# ============================================================
# Kriging nội suy toàn grid
# ============================================================
def kriging_grid(nodes: list[dict], field: str) -> np.ndarray:
    """
    nodes: list dict có x, y, và field (temp hoặc humi)
    return: grid (len(GRID_Y), len(GRID_X))
    """
    xs = np.array([n["x"] for n in nodes])
    ys = np.array([n["y"] for n in nodes])
    zs = np.array([n[field] for n in nodes])

    try:
        ok = OrdinaryKriging(
            xs, ys, zs,
            variogram_model="gaussian",
            verbose=False,
            enable_plotting=False,
        )
        z_grid, _ = ok.execute("grid", GRID_X, GRID_Y)
        return np.array(z_grid)  # (40, 50)
    except Exception:
        # Fallback về IDW nếu Kriging lỗi (ít node quá)
        points = np.column_stack([xs, ys])
        gx, gy = np.meshgrid(GRID_X, GRID_Y)
        z_grid = griddata(points, zs, (gx, gy), method="linear")
        return np.nan_to_num(z_grid, nan=float(np.nanmean(zs)))


# ============================================================
# Schema response
# ============================================================
class NodeForecast(BaseModel):
    device_id: Optional[int]
    name:      str
    x:         float
    y:         float
    virtual:   bool
    forecast:  list[dict]   # list {timestamp, temperature, humidity}

class HeatmapSlice(BaseModel):
    horizon_minute: int     # 0 = actual now, 1..15 = LSTM predictions
    temperature:    list    # 2D array (40×50) flattened to list of lists
    humidity:       list

class SpatialForecastResponse(BaseModel):
    grid_x:   list[float]
    grid_y:   list[float]
    nodes:    list[NodeForecast]
    heatmaps: list[HeatmapSlice]


# ============================================================
# Route: GET /spatial-forecast
# ============================================================
@app.get("/spatial-forecast", response_model=SpatialForecastResponse)
def spatial_forecast():
    devices = fetch_devices()
    if len(devices) < 1:
        raise HTTPException(status_code=400, detail="Không có thiết bị nào có tọa độ.")

    # --- Bước 1: Chạy LSTM một lần cho mỗi device, đồng thời lấy reading hiện tại ---
    per_device = []   # {device_id, name, x, y, current, pred}

    for _, row in devices.iterrows():
        device_id = int(row["id"])
        try:
            data = fetch_latest_for_device(device_id)
            if len(data) < WINDOW_SIZE:
                continue
            pred    = lstm_forecast(data)                        # (HORIZON, 2)
            current = fetch_current_reading_for_device(device_id)  # latest actual reading
            per_device.append({
                "device_id": device_id,
                "name":      str(row["name"]),
                "x":         float(row["x"]),
                "y":         float(row["y"]),
                "current":   current,
                "pred":      pred,
            })
        except Exception as e:
            print(f"Lỗi device {row['id']}: {e}")
            continue

    if len(per_device) < 2:
        raise HTTPException(status_code=400, detail="Cần ít nhất 2 node thật có đủ dữ liệu.")

    # --- Bước 2: Build NodeForecast list ---
    # Representative values for virtual node IDW: use step +1 (nearest prediction)
    real_nodes_repr = [
        {"x": d["x"], "y": d["y"], "temp": float(d["pred"][0, 0]), "humi": float(d["pred"][0, 1])}
        for d in per_device
    ]
    virtual_nodes = make_virtual_nodes(real_nodes_repr)

    node_forecasts = []
    for d in per_device:
        last_ts = pd.Timestamp.now(tz="UTC").floor("min")
        fc_list = [
            {
                "timestamp":   (last_ts + pd.Timedelta(minutes=i + 1)).isoformat(),
                "temperature": round(float(d["pred"][i, 0]), 2),
                "humidity":    round(float(d["pred"][i, 1]), 2),
            }
            for i in range(HORIZON)
        ]
        node_forecasts.append(NodeForecast(
            device_id=d["device_id"],
            name=d["name"],
            x=d["x"],
            y=d["y"],
            virtual=False,
            forecast=fc_list,
        ))

    for vn in virtual_nodes:
        node_forecasts.append(NodeForecast(
            device_id=None,
            name=f"Virtual ({vn['x']}, {vn['y']})",
            x=vn["x"],
            y=vn["y"],
            virtual=True,
            forecast=[],
        ))

    # --- Bước 3: Build heatmaps ---
    heatmaps = []

    # horizon_minute=0: actual current readings → sync với "Now" của single-device
    current_nodes = [d for d in per_device if d["current"] is not None]
    print(f"[Spatial] current readings available: {len(current_nodes)}/{len(per_device)} devices")
    if len(current_nodes) >= 2:
        nodes_curr = [
            {"x": d["x"], "y": d["y"], "temp": d["current"]["temp"], "humi": d["current"]["humi"]}
            for d in current_nodes
        ]
        virtual_curr = make_virtual_nodes(nodes_curr)
        all_curr     = nodes_curr + virtual_curr
        temp_now = kriging_grid(all_curr, "temp")
        humi_now = kriging_grid(all_curr, "humi")
        heatmaps.append(HeatmapSlice(
            horizon_minute=0,
            temperature=np.round(temp_now, 2).tolist(),
            humidity=np.round(humi_now, 2).tolist(),
        ))
        print(f"[Spatial] horizon_minute=0 (Now) heatmap built from actual readings")
    else:
        print(f"[Spatial] WARNING: not enough current readings to build 'Now' heatmap (need 2, got {len(current_nodes)})")

    # horizon_minute=1..HORIZON: LSTM predictions → sync với single-device forecast
    for h in range(HORIZON):
        nodes_h = [
            {"x": d["x"], "y": d["y"], "temp": float(d["pred"][h, 0]), "humi": float(d["pred"][h, 1])}
            for d in per_device
        ]
        virtual_h   = make_virtual_nodes(nodes_h)
        all_nodes_h = nodes_h + virtual_h
        temp_grid   = kriging_grid(all_nodes_h, "temp")
        humi_grid   = kriging_grid(all_nodes_h, "humi")
        heatmaps.append(HeatmapSlice(
            horizon_minute=h + 1,
            temperature=np.round(temp_grid, 2).tolist(),
            humidity=np.round(humi_grid, 2).tolist(),
        ))

    return SpatialForecastResponse(
        grid_x=GRID_X.tolist(),
        grid_y=GRID_Y.tolist(),
        nodes=node_forecasts,
        heatmaps=heatmaps,
    )


# ============================================================
# Route: GET /health
# ============================================================
@app.get("/health")
def health():
    return {"status": "ok", "model": "LSTM+Kriging", "window": WINDOW_SIZE, "nodes": len(fetch_devices())}


# ============================================================
# MAIN
# ============================================================
if __name__ == "__main__":
    uvicorn.run("spatial_forecast:app", host="0.0.0.0", port=8001, reload=False)
