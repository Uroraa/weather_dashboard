import os
import sys
import pandas as pd
import numpy as np
import psycopg2
import torch
import torch.nn as nn
import joblib
from sklearn.model_selection import train_test_split
from dotenv import load_dotenv, find_dotenv

# Reconfigure stdout/stderr to UTF-8 for Windows console
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

load_dotenv(find_dotenv())


WINDOW_SIZE  = 30
HORIZON      = 15
HIDDEN_SIZE  = 64
NUM_LAYERS   = 2

DATABASE_URL = os.getenv("DATABASE_URL", "postgres://postgres:*Hs123456@localhost:5432/weather_dashboard")

# ============================================================
# Định nghĩa mô hình Stacked LSTM
# ============================================================
class LSTMModel(nn.Module):
    def __init__(self, input_size):
        super().__init__()
        self.input_size = input_size
        self.lstm = nn.LSTM(
            input_size  = input_size,
            hidden_size = HIDDEN_SIZE,
            num_layers  = NUM_LAYERS,
            batch_first = True,
            dropout     = 0.3,
        )
        self.fc = nn.Linear(HIDDEN_SIZE, HORIZON * input_size)

    def forward(self, x):
        out, _ = self.lstm(x)
        out = self.fc(out[:, -1, :])
        return out.view(-1, HORIZON, self.input_size)

# ============================================================
# Load dữ liệu từ PostgreSQL
# ============================================================
def load_data():
    conn = psycopg2.connect(DATABASE_URL)
    query = """
        SELECT
            date_trunc('minute', timestamp) AS ts,
            AVG(temperature) AS temperature,
            AVG(humidity)    AS humidity,
            AVG(aqi)         AS aqi
        FROM readings
        WHERE device_id = 12 AND aqi != 0
        GROUP BY date_trunc('minute', timestamp)
        ORDER BY ts ASC;
    """
    df = pd.read_sql(query, conn, parse_dates=["ts"])
    conn.close()

    df.set_index("ts", inplace=True)
    df.dropna(inplace=True)
    return df

# ============================================================
# Tạo sequence sliding window
# ============================================================
def create_sequences(data, window_size, horizon):
    X, y = [], []
    for i in range(len(data) - window_size - horizon + 1):
        X.append(data[i : i + window_size])
        y.append(data[i + window_size : i + window_size + horizon])
    return np.array(X), np.array(y)

# ============================================================
# Đánh giá cấu hình cụ thể
# ============================================================
def evaluate_config(config_name, features, df, device):
    model_path = f"ablation_lstm_{config_name}.pth"
    scaler_path = f"ablation_scaler_{config_name}.pkl"

    if not os.path.exists(model_path) or not os.path.exists(scaler_path):
        raise FileNotFoundError(f"Không tìm thấy model hoặc scaler cho cấu hình: {config_name}")

    scaler = joblib.load(scaler_path)
    scaled_data = scaler.transform(df[features])

    X, y = create_sequences(scaled_data, WINDOW_SIZE, HORIZON)
    
    # Chia train/test (80/20 chronological) - Chỉ lấy test để đánh giá
    _, X_test, _, y_test = train_test_split(
        X, y, test_size=0.2, shuffle=False
    )

    # Khởi tạo và load model
    input_size = len(features)
    model = LSTMModel(input_size=input_size).to(device)
    model.load_state_dict(torch.load(model_path, map_location=device))
    model.eval()

    # Chuyển test set sang torch tensor
    X_test_t = torch.tensor(X_test, dtype=torch.float32).to(device)

    with torch.no_grad():
        preds_scaled = model(X_test_t).cpu().numpy() # (N, HORIZON, input_size)

    # Inverse transform cho từng bước để tính MAE thực tế
    # Vì MinMaxScaler yêu cầu input (N, input_size), ta phải biến đổi từng bước thời gian
    N = preds_scaled.shape[0]
    
    preds_real = np.zeros_like(preds_scaled)
    y_test_real = np.zeros_like(y_test)

    for step in range(HORIZON):
        preds_real[:, step, :] = scaler.inverse_transform(preds_scaled[:, step, :])
        y_test_real[:, step, :] = scaler.inverse_transform(y_test[:, step, :])

    # Trích xuất MAE cho các mốc 6 phút (index 5), 10 phút (index 9), 15 phút (index 14)
    target_horizons = [6, 10, 15]
    horizon_indices = [5, 9, 14]
    
    results = {}

    for horizon_val, idx in zip(target_horizons, horizon_indices):
        results[horizon_val] = {}
        # Tính MAE cho từng feature
        for f_idx, feat in enumerate(features):
            mae = np.mean(np.abs(preds_real[:, idx, f_idx] - y_test_real[:, idx, f_idx]))
            results[horizon_val][feat] = mae

    return results

# ============================================================
# MAIN
# ============================================================
if __name__ == "__main__":
    device = torch.device("cpu") # Dùng CPU cho inference
    os.chdir(os.path.dirname(os.path.abspath(__file__)))

    print("Đang tải dữ liệu thực nghiệm...")
    df = load_data()
    print(f"Tổng số mẫu dữ liệu nạp: {len(df)}")

    # Đánh giá các cấu hình
    print("\n--- Đang đánh giá các mô hình... ---")
    
    res_uni_temp = evaluate_config("univariate_temp", ["temperature"], df, device)
    res_uni_humi = evaluate_config("univariate_humi", ["humidity"], df, device)
    res_multi_2  = evaluate_config("multivariate_2", ["temperature", "humidity"], df, device)
    res_multi_3  = evaluate_config("multivariate_full", ["temperature", "humidity", "aqi"], df, device)

    # Tạo bảng kết quả so sánh
    # Mốc dự báo | Mô hình | MAE Nhiệt độ | MAE Độ ẩm
    
    horizons = [6, 10, 15]
    
    print("\n" + "="*80)
    print("BẢNG KẾT QUẢ SO SÁNH MAE THỰC TẾ (ABLATION STUDY)")
    print("="*80)
    print(f"{'Cấu hình mô hình':<40} | {'Mốc':<8} | {'MAE Nhiệt độ (°C)':<18} | {'MAE Độ ẩm (%)':<15}")
    print("-" * 87)
    
    rows = []
    
    # Cấu hình 1: Đơn biến
    for h in horizons:
        mae_t = res_uni_temp[h]["temperature"]
        mae_h = res_uni_humi[h]["humidity"]
        rows.append(("Stacked LSTM Đơn biến (Temp/Hum)", h, mae_t, mae_h))
        
    # Cấu hình 2: Đa biến 2 đặc trưng
    for h in horizons:
        mae_t = res_multi_2[h]["temperature"]
        mae_h = res_multi_2[h]["humidity"]
        rows.append(("Stacked LSTM Đa biến (2 đặc trưng)", h, mae_t, mae_h))
        
    # Cấu hình 3: Đa biến đầy đủ (Đề xuất)
    for h in horizons:
        mae_t = res_multi_3[h]["temperature"]
        mae_h = res_multi_3[h]["humidity"]
        rows.append(("Stacked LSTM Đa biến đầy đủ (Đề xuất)", h, mae_t, mae_h))

    for config, h, mae_t, mae_h in rows:
        print(f"{config:<40} | {h:<3} phút | {mae_t:<18.3f} | {mae_h:<15.3f}")

    # Xuất ra Markdown
    print("\n" + "="*80)
    print("ĐỊNH DẠNG BẢNG MARKDOWN")
    print("="*80)
    print("| Cấu hình mô hình | Mốc dự báo | MAE nhiệt độ (°C) | MAE độ ẩm (%) |")
    print("| :--- | :---: | :---: | :---: |")
    
    # Nhóm theo cấu hình
    configs_list = [
        ("Stacked LSTM Đơn biến (Temp/Hum)", [
            (6, res_uni_temp[6]["temperature"], res_uni_humi[6]["humidity"]),
            (10, res_uni_temp[10]["temperature"], res_uni_humi[10]["humidity"]),
            (15, res_uni_temp[15]["temperature"], res_uni_humi[15]["humidity"]),
        ]),
        ("Stacked LSTM Đa biến (2 đặc trưng)", [
            (6, res_multi_2[6]["temperature"], res_multi_2[6]["humidity"]),
            (10, res_multi_2[10]["temperature"], res_multi_2[10]["humidity"]),
            (15, res_multi_2[15]["temperature"], res_multi_2[15]["humidity"]),
        ]),
        ("**Stacked LSTM Đa biến đầy đủ (Đề xuất)**", [
            (6, res_multi_3[6]["temperature"], res_multi_3[6]["humidity"]),
            (10, res_multi_3[10]["temperature"], res_multi_3[10]["humidity"]),
            (15, res_multi_3[15]["temperature"], res_multi_3[15]["humidity"]),
        ])
    ]
    
    for cfg_title, vals in configs_list:
        for idx, (h, mae_t, mae_h) in enumerate(vals):
            # Dùng in đậm cho Đề xuất
            t_str = f"**{mae_t:.3f}**" if "Đề xuất" in cfg_title else f"{mae_t:.3f}"
            h_str = f"**{mae_h:.3f}**" if "Đề xuất" in cfg_title else f"{mae_h:.3f}"
            print(f"| {cfg_title if idx == 0 else ''} | {h} phút | {t_str} | {h_str} |")
            
    # Xuất ra LaTeX code
    print("\n" + "="*80)
    print("ĐỊNH DẠNG BẢNG LATEX")
    print("="*80)
    latex_code = r"""\begin{table}[H]
  \centering
  \small
  \caption{Bảng so sánh sai số dự báo MAE giữa các cấu hình đặc trưng đầu vào khác nhau}
  \label{tab:ablation_study}
  \begin{tabularx}{\textwidth}{>{\raggedright\arraybackslash}X l c c}
    \toprule
    \textbf{Cấu hình mô hình} & \textbf{Mốc dự báo} & \textbf{MAE nhiệt độ ($^\circ$C)} & \textbf{MAE độ ẩm (\%)} \\
    \midrule
"""
    
    # 1. Đơn biến
    latex_code += f"    Stacked LSTM Đơn biến (Temp/Hum)\n"
    latex_code += f"      & 6 phút  & {res_uni_temp[6]['temperature']:.3f} & {res_uni_humi[6]['humidity']:.3f} \\\\\n"
    latex_code += f"      & 10 phút & {res_uni_temp[10]['temperature']:.3f} & {res_uni_humi[10]['humidity']:.3f} \\\\\n"
    latex_code += f"      & 15 phút & {res_uni_temp[15]['temperature']:.3f} & {res_uni_humi[15]['humidity']:.3f} \\\\\n"
    latex_code += "    \\midrule\n"
    
    # 2. Đa biến 2 đặc trưng
    latex_code += f"    Stacked LSTM Đa biến (2 đặc trưng)\n"
    latex_code += f"      & 6 phút  & {res_multi_2[6]['temperature']:.3f} & {res_multi_2[6]['humidity']:.3f} \\\\\n"
    latex_code += f"      & 10 phút & {res_multi_2[10]['temperature']:.3f} & {res_multi_2[10]['humidity']:.3f} \\\\\n"
    latex_code += f"      & 15 phút & {res_multi_2[15]['temperature']:.3f} & {res_multi_2[15]['humidity']:.3f} \\\\\n"
    latex_code += "    \\midrule\n"
    
    # 3. Đề xuất
    latex_code += f"    \\textbf{{Stacked LSTM Đa biến đầy đủ (Đề xuất)}}\n"
    latex_code += f"      & \\textbf{{6 phút}}  & \\textbf{{{res_multi_3[6]['temperature']:.3f}}} & \\textbf{{{res_multi_3[6]['humidity']:.3f}}} \\\\\n"
    latex_code += f"      & \\textbf{{10 phút}} & \\textbf{{{res_multi_3[10]['temperature']:.3f}}} & \\textbf{{{res_multi_3[10]['humidity']:.3f}}} \\\\\n"
    latex_code += f"      & \\textbf{{15 phút}} & \\textbf{{{res_multi_3[15]['temperature']:.3f}}} & \\textbf{{{res_multi_3[15]['humidity']:.3f}}} \\\\\n"
    
    latex_code += r"""    \bottomrule
  \end{tabularx}
\end{table}"""
    print(latex_code)
