import os
import sys
import pandas as pd
import numpy as np
import psycopg2
from sklearn.preprocessing import MinMaxScaler
from sklearn.model_selection import train_test_split
import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader
import matplotlib.pyplot as plt
import joblib
from dotenv import load_dotenv, find_dotenv

# Reconfigure stdout/stderr to UTF-8 for Windows console
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

load_dotenv(find_dotenv())


# ============================================================
# CẤU HÌNH SIÊU THAM SỐ
# ============================================================
WINDOW_SIZE  = 30   
HORIZON      = 15
HIDDEN_SIZE  = 64
NUM_LAYERS   = 2
BATCH_SIZE   = 32
EPOCHS       = 80  
PATIENCE     = 8   
LR           = 1e-3

DATABASE_URL = os.getenv("DATABASE_URL", "postgres://postgres:*Hs123456@localhost:5432/weather_dashboard")

# ============================================================
# BƯỚC 1: Load dữ liệu từ PostgreSQL
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
    print(f"Tổng số mẫu dữ liệu: {len(df)}")
    return df

# ============================================================
# BƯỚC 2: Tạo sliding window
# ============================================================
def create_sequences(data, window_size, horizon):
    X, y = [], []
    for i in range(len(data) - window_size - horizon + 1):
        X.append(data[i : i + window_size])
        y.append(data[i + window_size : i + window_size + horizon])
    return np.array(X), np.array(y)

# ============================================================
# BƯỚC 3: Dataset PyTorch
# ============================================================
class SensorDataset(Dataset):
    def __init__(self, X, y):
        self.X = torch.tensor(X, dtype=torch.float32)
        self.y = torch.tensor(y, dtype=torch.float32)

    def __len__(self):
        return len(self.X)

    def __getitem__(self, idx):
        return self.X[idx], self.y[idx]

# ============================================================
# BƯỚC 4: Định nghĩa mô hình Stacked LSTM đa năng
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
# BƯỚC 5: Huấn luyện một mô hình cụ thể
# ============================================================
def train_model(config_name, features, df, device):
    print(f"\n============================================================")
    print(f"BẮT ĐẦU HUẤN LUYỆN CẤU HÌNH: {config_name}")
    print(f"Features: {features}")
    print(f"============================================================")

    # 1. Chuẩn hóa
    scaler = MinMaxScaler()
    scaled_data = scaler.fit_transform(df[features])

    # 2. Tạo sequence
    X, y = create_sequences(scaled_data, WINDOW_SIZE, HORIZON)
    
    # Chia train/test (80/20 chronological)
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, shuffle=False
    )
    
    # Dataloaders
    train_loader = DataLoader(SensorDataset(X_train, y_train), batch_size=BATCH_SIZE, shuffle=True)
    test_loader  = DataLoader(SensorDataset(X_test, y_test), batch_size=BATCH_SIZE, shuffle=False)

    # 3. Khởi tạo mô hình
    input_size = len(features)
    model = LSTMModel(input_size=input_size).to(device)
    criterion = nn.MSELoss()
    optimizer = torch.optim.Adam(model.parameters(), lr=LR)
    scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(
        optimizer, patience=4, factor=0.5
    )

    # 4. Vòng lặp train
    train_losses, test_losses = [], []
    best_test_loss = float("inf")
    patience_counter = 0
    best_epoch = 0

    model_path = f"ablation_lstm_{config_name}.pth"
    scaler_path = f"ablation_scaler_{config_name}.pkl"

    for epoch in range(1, EPOCHS + 1):
        # Train epoch
        model.train()
        total_train_loss = 0
        for X_batch, y_batch in train_loader:
            X_batch, y_batch = X_batch.to(device), y_batch.to(device)
            optimizer.zero_grad()
            pred = model(X_batch)
            loss = criterion(pred, y_batch)
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
            optimizer.step()
            total_train_loss += loss.item()
        tr_loss = total_train_loss / len(train_loader)

        # Eval epoch
        model.eval()
        total_test_loss = 0
        with torch.no_grad():
            for X_batch, y_batch in test_loader:
                X_batch, y_batch = X_batch.to(device), y_batch.to(device)
                pred = model(X_batch)
                total_test_loss += criterion(pred, y_batch).item()
        te_loss = total_test_loss / len(test_loader)

        scheduler.step(te_loss)

        train_losses.append(tr_loss)
        test_losses.append(te_loss)

        if epoch % 5 == 0 or epoch == 1:
            print(f"Epoch {epoch:2d}/{EPOCHS} | Train Loss: {tr_loss:.6f} | Test Loss: {te_loss:.6f} | Best: {best_test_loss:.6f}")

        # Early stopping
        if te_loss < best_test_loss:
            best_test_loss = te_loss
            best_epoch = epoch
            patience_counter = 0
            torch.save(model.state_dict(), model_path)
        else:
            patience_counter += 1
            if patience_counter >= PATIENCE:
                print(f"Early stopping tại epoch {epoch}. Best epoch: {best_epoch} (test loss: {best_test_loss:.6f})")
                break

    print(f"-> Hoàn thành cấu hình: {config_name}. Model tốt nhất lưu tại epoch {best_epoch} -> {model_path}")
    joblib.dump(scaler, scaler_path)
    print(f"-> Đã lưu scaler -> {scaler_path}")

    # Vẽ loss curve
    plt.figure(figsize=(8, 3.5))
    plt.plot(train_losses, label="Train Loss")
    plt.plot(test_losses, label="Test Loss")
    plt.axvline(x=best_epoch - 1, color="red", linestyle="--", label=f"Best epoch ({best_epoch})")
    plt.xlabel("Epoch")
    plt.ylabel("MSE Loss")
    plt.title(f"Loss Curve - {config_name}")
    plt.legend()
    plt.tight_layout()
    plt.savefig(f"loss_curve_{config_name}.png")
    plt.close()

# ============================================================
# MAIN
# ============================================================
if __name__ == "__main__":
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Huấn luyện sử dụng thiết bị: {device}")

    # Chuyển về thư mục chứa file này để các output được lưu cùng nơi
    os.chdir(os.path.dirname(os.path.abspath(__file__)))

    df = load_data()
    min_required = WINDOW_SIZE + HORIZON + 1
    if len(df) < min_required:
        print(f"Không đủ dữ liệu: cần {min_required} mẫu, hiện có {len(df)}.")
        exit(1)

    # Huấn luyện các cấu hình
    train_model("univariate_temp", ["temperature"], df, device)
    train_model("univariate_humi", ["humidity"], df, device)
    train_model("multivariate_2", ["temperature", "humidity"], df, device)
    train_model("multivariate_full", ["temperature", "humidity", "aqi"], df, device)

    print("\nQuá trình huấn luyện tất cả 4 mô hình hoàn tất thành công!")
