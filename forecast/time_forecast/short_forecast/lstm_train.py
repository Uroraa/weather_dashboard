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

WINDOW_SIZE  = 30   
HORIZON      = 15
INPUT_SIZE   = 3
HIDDEN_SIZE  = 64
NUM_LAYERS   = 2
BATCH_SIZE   = 32
EPOCHS       = 100  
PATIENCE     = 10   
LR           = 1e-3

import os
from dotenv import load_dotenv, find_dotenv
load_dotenv(find_dotenv())

DATABASE_URL = os.getenv("DATABASE_URL", "postgres://postgres:*Hs123456@localhost:5432/weather_dashboard")


# ============================================================
# BƯỚC 1: Load dữ liệu từ PostgreSQL (Chỉ lấy aqi != 0)
# ============================================================
def load_data():
    conn = psycopg2.connect(DATABASE_URL)
    # Filter directly in SQL to keep only rows where aqi != 0
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
    print(f"Tổng số mẫu (chỉ aqi != 0): {len(df)}")
    print(df.head())
    return df


# ============================================================
# BƯỚC 2: Chuẩn hóa + tạo sliding window
# ============================================================
def create_sequences(data, window_size, horizon):
    X, y = [], []
    for i in range(len(data) - window_size - horizon + 1):
        X.append(data[i : i + window_size])
        y.append(data[i + window_size : i + window_size + horizon])
    return np.array(X), np.array(y)


def preprocess(df):
    scaler = MinMaxScaler()
    scaled = scaler.fit_transform(df[["temperature", "humidity", "aqi"]])

    X, y = create_sequences(scaled, WINDOW_SIZE, HORIZON)
    print(f"X shape: {X.shape}")   
    print(f"y shape: {y.shape}")   

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, shuffle=False
    )
    return X_train, X_test, y_train, y_test, scaler


# ============================================================
# BƯỚC 3: Dataset & DataLoader
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
# BƯỚC 4: Định nghĩa mô hình LSTM
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
# BƯỚC 5: Train / Evaluate (Dùng Standard MSE Loss)
# ============================================================
def train_one_epoch(model, loader, criterion, optimizer, device):
    model.train()
    total_loss = 0
    for X_batch, y_batch in loader:
        X_batch, y_batch = X_batch.to(device), y_batch.to(device)
        optimizer.zero_grad()
        pred = model(X_batch)
        loss = criterion(pred, y_batch)
        loss.backward()
        nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
        optimizer.step()
        total_loss += loss.item()
    return total_loss / len(loader)


def evaluate(model, loader, criterion, device):
    model.eval()
    total_loss = 0
    with torch.no_grad():
        for X_batch, y_batch in loader:
            X_batch, y_batch = X_batch.to(device), y_batch.to(device)
            pred = model(X_batch)
            total_loss += criterion(pred, y_batch).item()
    return total_loss / len(loader)


# ============================================================
# MAIN
# ============================================================
if __name__ == "__main__":
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Dùng: {device}")

    df = load_data()
    
    min_required = WINDOW_SIZE + HORIZON + 1
    if len(df) < min_required:
        print(f"Không đủ dữ liệu: cần {min_required} mẫu, hiện có {len(df)}.")
        exit(1)
        
    X_train, X_test, y_train, y_test, scaler = preprocess(df)

    train_loader = DataLoader(SensorDataset(X_train, y_train),
                              batch_size=BATCH_SIZE, shuffle=True)
    test_loader  = DataLoader(SensorDataset(X_test,  y_test),
                              batch_size=BATCH_SIZE, shuffle=False)

    model     = LSTMModel().to(device)
    criterion = nn.MSELoss()
    optimizer = torch.optim.Adam(model.parameters(), lr=LR)
    scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(
        optimizer, patience=5, factor=0.5
    )

    train_losses, test_losses = [], []
    best_test_loss    = float("inf")
    patience_counter  = 0
    best_epoch        = 0

    for epoch in range(1, EPOCHS + 1):
        tr = train_one_epoch(model, train_loader, criterion, optimizer, device)
        te = evaluate(model, test_loader, criterion, device)
        scheduler.step(te)

        train_losses.append(tr)
        test_losses.append(te)

        if epoch % 5 == 0:
            print(f"Epoch {epoch:3d} | Train: {tr:.6f} | Test: {te:.6f} | Best: {best_test_loss:.6f}")

        # Early stopping — lưu model tốt nhất
        if te < best_test_loss:
            best_test_loss   = te
            best_epoch       = epoch
            patience_counter = 0
            torch.save(model.state_dict(), "lstm_model.pth")
        else:
            patience_counter += 1
            if patience_counter >= PATIENCE:
                print(f"\nEarly stopping tại epoch {epoch} — best epoch: {best_epoch} (test loss: {best_test_loss:.6f})")
                break

    print(f"\nĐã lưu model tốt nhất tại epoch {best_epoch} -> lstm_model.pth")
    joblib.dump(scaler, "scaler.pkl")
    print("Đã lưu scaler.pkl")

    # Plot loss
    plt.figure(figsize=(10, 4))
    plt.plot(train_losses, label="Train loss")
    plt.plot(test_losses,  label="Test loss")
    plt.axvline(x=best_epoch - 1, color="red", linestyle="--", label=f"Best epoch ({best_epoch})")
    plt.xlabel("Epoch")
    plt.ylabel("MSE Loss")
    plt.title("Loss Curve (Chỉ aqi != 0) — LSTM Multi-Horizon (6/10/15 phút)")
    plt.legend()
    plt.tight_layout()
    plt.savefig("loss_curve.png")
    plt.show()
