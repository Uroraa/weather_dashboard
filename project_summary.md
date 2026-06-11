# Project Summary: IoT Weather Dashboard

## 1. FIRMWARE (ESP32)
- **Pipeline đăng ký thiết bị**:
  1. Khi cấp nguồn, nếu chưa có cấu hình Wifi/MQTT, thiết bị phát AP có tên `Sensor-Setup-[MAC]`.
  2. Người dùng kết nối AP để điền thông tin Wifi.
  3. Sau khi có Wifi, thiết bị kết nối tới Broker MQTT với Client ID `provision-[MAC]` (được phép kết nối không cần xác thực).
  4. Gửi bản tin JSON chứa MAC và version lên topic `devices/register`.
  5. Thiết bị subscribe topic `devices/[MAC]/config` để đợi cấp phát `device_id` và `api_key` từ Backend.
  6. Lưu `device_id` và `api_key` vào bộ nhớ flash (Preferences). Các lần sau thiết bị sẽ dùng thông tin này làm username/password để kết nối MQTT chính thức.
- **Liệt kê sensor và thư viện**:
  - **Cảm biến nhiệt ẩm**: DHT11. Thư viện: `DHT sensor library` (DHT.h).
  - **Cảm biến AQI**: Sinh ngẫu nhiên (Mock data theo hàm Box-Muller phân phối chuẩn kết hợp chu kỳ ngày đêm).
- **Cách đọc dữ liệu**: DHT11 đọc qua chân Digital (`#define DHTPIN 4`).
- **Tần suất lấy mẫu**: `SEND_INTERVAL = 5000` (5 giây gửi một lần).
- **Cấu trúc MQTT payload**:
  ```json
  {"temperature":26.5,"humidity":55.0,"aqi":42.1}
  ```
- **MQTT topic structure**: `device/{api_key}/data`
- **Danh sách thư viện sử dụng**: `WiFi`, `PubSubClient`, `ArduinoJson`, `DHT.h` (Adafruit), `Preferences`, `WiFiManager`.

## 2. BACKEND (Node.js/Express)
- **Liệt kê các API endpoints chính**:
  - **Auth**: `POST /api/auth/login`, `POST /api/auth/register`, `GET /api/auth/me`, `PUT /api/auth/me`, `PUT /api/auth/password`
  - **Devices**: `GET /api/devices`, `POST /api/devices`, `GET /api/devices/:id`, `PUT /api/devices/:id`, `DELETE /api/devices/:id`, `GET /api/devices/pending`, `POST /api/devices/provision`
  - **Data**: `GET /api/devices/:id/readings`, `GET /api/devices/:id/summary`
  - **Khác**: Các endpoints tương tự cho `users`, `rooms`, `alerts`, `forecast`, `spatial-forecast`.
- **MQTT subscriber**: Backend khởi chạy một MQTT Broker nội bộ (dùng thư viện `Aedes`). Bắt sự kiện `publish` của client. Khi topic khớp dạng `device/{api_key}/data`, hệ thống lấy `api_key` truy vấn DB để xác thực, xử lý payload JSON, lưu vào bảng `readings`, gọi `alertService` kiểm tra ngưỡng và phát qua Socket.io.
- **Socket.io**:
  - **Emit event**: `new_reading` với data `{device_id, temperature, humidity, aqi, timestamp, source}`.
  - **Trigger khi nào**: Ngay khi broker MQTT nhận được bản tin data mới từ cảm biến.
  - **Listen event**: `authenticate` (client gửi JWT để join room `user_{userId}`), `subscribe_device` (client join room `device_{deviceId}`).
- **Các thư viện npm chính**: `express`, `aedes`, `socket.io`, `pg`, `bcrypt`, `jsonwebtoken`, `cors`, `dotenv`.
- **Python service riêng**: Có. Hệ thống có module Python chạy bằng FastAPI đảm nhiệm việc nhận request, query dữ liệu từ PostgreSQL và chạy inference cho Model LSTM và thuật toán Kriging nội suy không gian.

## 3. FRONTEND/DASHBOARD
- **Framework và thư viện UI**: React 19 (xây dựng qua Vite), Vanilla CSS cho styling.
- **Danh sách màn hình chính**: Dashboard, Devices, DeviceDetails, Forecast (dự báo trạm), Spatial Forecast (heatmap), Rooms, Alerts.
- **Thư viện chart**: `chart.js` và `react-chartjs-2`.
- **Heatmap/spatial visualization**: Sử dụng thư viện `leaflet` và `react-leaflet`.
- **Socket.io client**:
  - **Listen event**: `new_reading`.
  - **Cập nhật UI**: Component `ConnectionContext` lắng nghe event, kiểm tra xem data có thuộc device đang được xem (`selectedDevice`) hay không. Nếu đúng, đẩy data điểm mới vào mảng `chartData` (giới hạn 30 điểm), dịch mảng để tạo hiệu ứng real-time chart. Đồng thời cập nhật trạng thái `liveTemp`, `liveHumidity`, `liveAqi` bằng text.

## 4. ML PIPELINE
- **LSTM (Đã implement)**:
  - **Input features**: `temperature`, `humidity`, `aqi`.
  - **Window size (lookback)**: 30 phút (cho short horizon).
  - **Forecast horizon**: 15 phút.
  - **Framework**: `PyTorch`.
  - **Model đã train**: Đã có file trọng số `lstm_model.pth`. Scaler lưu trong `scaler.pkl`.
  - **Inference chạy ở đâu**: Chạy trên Python FastAPI service (`forecast/main.py` cổng 8000). Backend Node.js gọi sang Python qua HTTP REST API.
- **IDW và Kriging**:
  - **Implement ở đâu**: Chạy trên Python FastAPI service (`forecast/spatial_forecast.py` cổng 8001), sử dụng thư viện `pykrige` và `scipy.interpolate`.
  - **Input**: Tọa độ `lat, lng` thực tế của các cảm biến trong phòng, cùng với giá trị hiện tại (temp, humi, aqi) hoặc mảng dự báo từ LSTM sinh ra.
  - **Output**: Một lưới grid (40x50 điểm nội suy tọa độ lat/lng) mang giá trị nhiệt độ, độ ẩm, AQI cho từng phút (từ Hiện tại đến +15 phút tương lai). Dữ liệu này trả về frontend vẽ heatmap.

## 5. CẤU TRÚC DỰ ÁN
```text
.
├── .env
├── .gitignore
├── README.md
├── frontend
│   ├── .gitignore
│   ├── README.md
│   ├── dist
│   ├── eslint.config.js
│   ├── index.html
│   ├── package-lock.json
│   ├── package.json
│   ├── public
│   ├── src
│   └── vite.config.js
├── forecast
│   ├── loss_curve.png
│   ├── loss_curve_long.png
│   ├── lstm_inference.py
│   ├── lstm_inference_long.py
│   ├── lstm_model.pth
│   ├── lstm_model_long.pth
│   ├── lstm_train.py
│   ├── lstm_train_long.py
│   ├── main.py
│   ├── scaler.pkl
│   ├── scaler_long.pkl
│   └── spatial_forecast.py
├── package-lock.json
├── package.json
├── scripts
│   ├── simulate_esp32.js
│   └── test_mqtt_publish.js
├── sensor
│   └── sensor.ino
├── server
│   ├── controllers
│   ├── index.js
│   ├── middleware
│   ├── models
│   ├── routes
│   ├── services
│   └── utils
└── tree_output.txt
```

## 6. SƠ ĐỒ LUỒNG DỮ LIỆU
1. **Thu thập dữ liệu**: ESP32 đọc giá trị từ DHT11 (Nhiệt, Ẩm) và giả lập AQI mỗi 5 giây.
2. **Gửi lên Server**: ESP32 đóng gói payload thành JSON và gọi MQTT Publish vào topic `device/{api_key}/data`.
3. **Backend xử lý**: Broker nội bộ Aedes (chạy trong Node.js) nhận bản tin. Node.js parse JSON, đối chiếu `api_key` với PostgreSQL DB, và lưu kết quả vào bảng `readings`.
4. **Cảnh báo & Real-time UI**: Node.js check các rule cảnh báo (alertService), đồng thời gọi Socket.io emit (`new_reading`) tới những Frontend đang connect và xem trạm này. Giao diện React cập nhật số biểu đồ tức thời.
5. **Dự báo Machine Learning**: Khi user chuyển sang tab Dự báo hoặc Bản đồ Không gian, Frontend gửi API Call (GET) tới Node.js. Node.js chuyển tiếp request sang Python Service.
6. **ML Inference Pipeline**:
   - Python query `readings` lịch sử 30 phút gần nhất từ PostgreSQL.
   - Scale data, đưa vào Pytorch LSTM dự báo 15 phút tới.
   - Để vẽ bản đồ, thuật toán IDW sẽ tạo thêm các trạm ảo ở rìa phòng để tránh nhiễu Kriging. Sau đó Kriging chạy nội suy mảng (40x50) cho mỗi phút.
   - Kết quả là mảng tọa độ và giá trị được gửi ngược về Frontend để Leaflet vẽ Heatmap trực quan hóa không gian.
