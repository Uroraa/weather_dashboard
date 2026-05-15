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

# Grid nội suy theo lat/lng thực tế của phòng 7×7m
GRID_LAT = np.linspace(20.9076452751, 20.9077081569, 40)
GRID_LNG = np.linspace(105.8533152221, 105.8533825361, 50)

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
print("Model and scaler loaded successfully.")


# ============================================================
# Helper: lấy dữ liệu DB
# ============================================================
def get_conn():
    return psycopg2.connect(**DB_CONFIG)


def fetch_room(room_id: int) -> dict:
    """Lấy thông tin phòng để tính toán grid."""
    conn = get_conn()
    df = pd.read_sql(f"SELECT * FROM rooms WHERE id = {room_id}", conn)
    conn.close()
    if df.empty:
        raise HTTPException(status_code=404, detail="Room not found")
    row = df.iloc[0]
    
    # 1 độ vĩ độ ~ 111320m. 
    # 1 độ kinh độ ~ 111320m * cos(lat)
    lat_deg_per_m = 1 / 111320
    lng_deg_per_m = 1 / (111320 * np.cos(np.radians(row["center_lat"])))
    
    half_width = row["width_m"] / 2
    half_length = row["length_m"] / 2
    return {
        "min_lat": row["center_lat"] - half_length * lat_deg_per_m,
        "max_lat": row["center_lat"] + half_length * lat_deg_per_m,
        "min_lng": row["center_lng"] - half_width * lng_deg_per_m,
        "max_lng": row["center_lng"] + half_width * lng_deg_per_m,
    }


def fetch_devices(room_id: Optional[int] = None) -> pd.DataFrame:
    """Lấy danh sách thiết bị và tọa độ từ DB."""
    conn = get_conn()
    query = "SELECT id, name, x, y, lat, lng FROM devices WHERE lat IS NOT NULL AND lng IS NOT NULL"
    if room_id is not None:
        query += f" AND room_id = {room_id}"
    df = pd.read_sql(query, conn)
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
    real_nodes: [{"lat":..,"lng":..,"x":..,"y":..,"temp":...,"humi":...}, ...]
    Thêm 2 node ảo tại 2 góc còn lại của bounding box lat/lng bằng IDW.
    """
    def idw_value(tlat, tlng, nodes, power=2):
        weights, temp_sum, humi_sum = 0, 0, 0
        for n in nodes:
            d = np.sqrt((tlat - n["lat"])**2 + (tlng - n["lng"])**2)
            d = max(d, 1e-10)
            w = 1 / d**power
            weights  += w
            temp_sum += w * n["temp"]
            humi_sum += w * n["humi"]
        return temp_sum / weights, humi_sum / weights

    lats = [n["lat"] for n in real_nodes]
    lngs = [n["lng"] for n in real_nodes]
    virtual_coords = [
        (min(lats), max(lngs)),
        (max(lats), min(lngs)),
    ]

    virtual = []
    for vlat, vlng in virtual_coords:
        t, h = idw_value(vlat, vlng, real_nodes)
        virtual.append({"lat": vlat, "lng": vlng, "temp": t, "humi": h, "virtual": True})

    return virtual


# ============================================================
# Kriging nội suy toàn grid
# ============================================================
def kriging_grid(nodes: list[dict], field: str, grid_lng: np.ndarray, grid_lat: np.ndarray) -> np.ndarray:
    """
    nodes: list dict có lat, lng, và field (temp hoặc humi)
    return: grid (len(grid_lat), len(grid_lng))
    """
    lats = np.array([n["lat"] for n in nodes])
    lngs = np.array([n["lng"] for n in nodes])
    zs   = np.array([n[field] for n in nodes])

    try:
        ok = OrdinaryKriging(
            lngs, lats, zs,
            variogram_model="gaussian",
            verbose=False,
            enable_plotting=False,
        )
        z_grid, _ = ok.execute("grid", grid_lng, grid_lat)
        return np.array(z_grid)
    except Exception:
        # Fallback về IDW nếu Kriging lỗi (ít node quá)
        points = np.column_stack([lngs, lats])
        gx, gy = np.meshgrid(grid_lng, grid_lat)
        z_grid = griddata(points, zs, (gx, gy), method="linear")
        return np.nan_to_num(z_grid, nan=float(np.nanmean(zs)))


# ============================================================
# Schema response
# ============================================================
class NodeForecast(BaseModel):
    device_id: Optional[int]
    name:      str
    x:         Optional[float]
    y:         Optional[float]
    lat:       float
    lng:       float
    virtual:   bool
    forecast:  list[dict]   # list {timestamp, temperature, humidity}

class HeatmapSlice(BaseModel):
    horizon_minute: int     # 0 = actual now, 1..15 = LSTM predictions
    temperature:    list    # 2D array (40×50) flattened to list of lists
    humidity:       list

class SpatialForecastResponse(BaseModel):
    grid_lat: list[float]
    grid_lng: list[float]
    nodes:    list[NodeForecast]
    heatmaps: list[HeatmapSlice]


# ============================================================
# Route: GET /spatial-forecast
# ============================================================
@app.get("/spatial-forecast", response_model=SpatialForecastResponse)
def spatial_forecast(room_id: int):
    # Lấy thông tin phòng và tạo grid
    bounds = fetch_room(room_id)
    grid_lat = np.linspace(bounds["min_lat"], bounds["max_lat"], 40)
    grid_lng = np.linspace(bounds["min_lng"], bounds["max_lng"], 50)

    devices = fetch_devices(room_id)
    if len(devices) < 1:
        raise HTTPException(status_code=400, detail="Không có thiết bị nào có tọa độ trong phòng này.")

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
                "x":         float(row["x"]) if row["x"] is not None else None,
                "y":         float(row["y"]) if row["y"] is not None else None,
                "lat":       float(row["lat"]),
                "lng":       float(row["lng"]),
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
        {"lat": d["lat"], "lng": d["lng"], "temp": float(d["pred"][0, 0]), "humi": float(d["pred"][0, 1])}
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
            lat=d["lat"],
            lng=d["lng"],
            virtual=False,
            forecast=fc_list,
        ))

    for vn in virtual_nodes:
        node_forecasts.append(NodeForecast(
            device_id=None,
            name=f"Virtual ({round(vn['lat'], 7)}, {round(vn['lng'], 7)})",
            x=None,
            y=None,
            lat=vn["lat"],
            lng=vn["lng"],
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
            {"lat": d["lat"], "lng": d["lng"], "temp": d["current"]["temp"], "humi": d["current"]["humi"]}
            for d in current_nodes
        ]
        virtual_curr = make_virtual_nodes(nodes_curr)
        all_curr     = nodes_curr + virtual_curr
        temp_now = kriging_grid(all_curr, "temp", grid_lng, grid_lat)
        humi_now = kriging_grid(all_curr, "humi", grid_lng, grid_lat)
        heatmaps.append(HeatmapSlice(
            horizon_minute=0,
            temperature=np.round(temp_now[::-1], 2).tolist(),
            humidity=np.round(humi_now[::-1], 2).tolist(),
        ))
        print(f"[Spatial] horizon_minute=0 (Now) heatmap built from actual readings")
    else:
        print(f"[Spatial] WARNING: not enough current readings to build 'Now' heatmap (need 2, got {len(current_nodes)})")

    # horizon_minute=1..HORIZON: LSTM predictions → sync với single-device forecast
    for h in range(HORIZON):
        nodes_h = [
            {"lat": d["lat"], "lng": d["lng"], "temp": float(d["pred"][h, 0]), "humi": float(d["pred"][h, 1])}
            for d in per_device
        ]
        virtual_h   = make_virtual_nodes(nodes_h)
        all_nodes_h = nodes_h + virtual_h
        temp_grid   = kriging_grid(all_nodes_h, "temp", grid_lng, grid_lat)
        humi_grid   = kriging_grid(all_nodes_h, "humi", grid_lng, grid_lat)
        heatmaps.append(HeatmapSlice(
            horizon_minute=h + 1,
            temperature=np.round(temp_grid[::-1], 2).tolist(),
            humidity=np.round(humi_grid[::-1], 2).tolist(),
        ))

    return SpatialForecastResponse(
        grid_lat=grid_lat.tolist(),
        grid_lng=grid_lng.tolist(),
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
