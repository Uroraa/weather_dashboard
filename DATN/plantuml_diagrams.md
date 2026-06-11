# Mã Nguồn PlantUML Cho Các Sơ Đồ Hệ Thống

Tài liệu này cung cấp mã nguồn PlantUML cập nhật cho 5 sơ đồ (b, c, d, e, f) để bạn có thể sao chép và tự sinh lại các tệp hình ảnh tương ứng. Các sơ đồ này đã được sửa đổi để khớp 100% với mã nguồn thực tế của dự án.

---

## 1. Sơ đồ b: Sơ đồ Hoạt động Firmware ESP32 (`firmware_arch.jpg`)

Sơ đồ này phản ánh vòng lặp logic (chương trình đơn phẳng) thực tế của firmware [sensor.ino](file:///d:/stuff/weather_dashboard/sensor/sensor.ino). Nó không chứa các thành phần Power Manager hay Machine Learning chạy trên bo mạch.

```plantuml
@startuml
skinparam handwritten false
skinparam monochrome false
skinparam packageStyle rect
skinparam shadowing false

title Sơ đồ hoạt động của Firmware ESP32 (sensor.ino)

start

partition "Setup() - Khởi tạo" {
  :Khởi tạo cổng Serial baudrate 115200;
  :Khởi tạo cảm biến DHT11;
  :Đọc cấu hình định danh từ NVS Flash (Preferences)\n- device_id\n- api_key\n- mqtt_server;
  if (Đã có device_id và api_key?) then (Đã đăng ký)
    :Đặt cờ provisioned = true;
  else (Chưa đăng ký)
    :Đặt cờ provisioned = false;
  endif
  :WiFiManager bắt đầu autoConnect();
  note right: Tạo AP cấu hình\nnếu chưa kết nối WiFi
  :Kết nối thành công WiFi;
  :Cập nhật địa chỉ mqtt_server và lưu vào Flash;
  :Cấu hình MQTT broker server và mqttCallback;
}

partition "Loop() - Vòng lặp chính" {
  repeat
    if (WiFi kết nối?) then (Không)
      :Thực hiện WiFi.reconnect() và chờ;
    endif
    
    if (Trạng thái provisioned?) then (Chưa đăng ký)
      if (Đến chu kỳ PROVISION_RETRY (10s)?) then (Có)
        :Gửi yêu cầu đăng ký (sendProvisionRequest)\nlên topic "devices/register"\nchứa MAC address;
      endif
      :Chạy mqttClient.loop() để chờ cấu hình;
    else (Đã đăng ký)
      if (MQTT kết nối?) then (Không)
        :Chạy reconnectWithAuth()\nDùng username=device_id và password=api_key;
        :Subscribe topic "devices/{mac}/config";
      endif
      :Chạy mqttClient.loop() xử lý MQTT events;
      
      if (Đến chu kỳ SEND_INTERVAL (5s)?) then (Có)
        :Đọc Temperature và Humidity từ DHT11;
        if (Đọc thành công?) then (Có)
          :Sử dụng giá trị thực;
        else (Thất bại / Lỗi cảm biến)
          :Sinh dữ liệu giả lập (Temperature & Humidity)\nsử dụng biến ngẫu nhiên Gauss (Box-Muller);
        endif
        :Sinh dữ liệu AQI giả lập (AR(1) + Spikes);
        :Đóng gói JSON: {"temperature", "humidity", "aqi"};
        :Publish lên topic "device/{api_key}/data";
      endif
    endif
  repeat while (Hệ thống chạy)
}

@enduml
```

---

## 2. Sơ đồ c: Kiến trúc Tổng quan Hệ thống (`arch_overview.jpg`)

Sơ đồ này làm rõ cấu trúc 4 tầng, luồng đi của payload JSON có trường `aqi` và phân tách rõ 2 dịch vụ FastAPI chạy trên các cổng `:8000` (LSTM) và `:8001` (Kriging).

```plantuml
@startuml
skinparam componentStyle uml2

title Kiến trúc tổng quan hệ thống IoT Giám sát & Dự báo

package "Tầng 1: Thu thập (Edge Layer)" {
  [ESP32 + DHT11\n(sensor.ino)] as esp32
}

package "Tầng 2: Truyền dẫn (Transport Layer)" {
  [Mạng WiFi 802.11 b/g/n] as wifi
  [Aedes MQTT Broker\n(Tích hợp trong Node.js)] as broker
}

package "Tầng 3: Xử lý & Lưu trữ (Backend Layer)" {
  database "PostgreSQL" as db
  [Node.js / Express REST API] as backend
  [Socket.io WebSocket Server] as socketio
  
  package "FastAPI ML Services" {
    [Time-Series Forecast Service\n(FastAPI - Cổng 8000)] as fastapi_lstm
    [Spatial Forecast Service\n(FastAPI - Cổng 8001)] as fastapi_spatial
  }
}

package "Tầng 4: Hiển thị (Presentation Layer)" {
  [React 19 + Vite Dashboard] as dashboard
  [Chart.js\n(Biểu đồ Realtime & Dự báo)] as chart
  [Leaflet.js\n(Bản đồ nội suy Heatmap)] as leaflet
}

' Đường truyền dữ liệu
esp32 --> wifi : Gửi JSON: {temperature, humidity, aqi}
wifi --> broker : Giao thức MQTT (Cổng 1883)
broker --> backend : Event 'publish' nhận gói tin
backend --> db : Lưu dữ liệu vào bảng 'readings'
backend --> fastapi_lstm : HTTP GET /forecast?device_id=X (Cổng 8000)
backend --> fastapi_spatial : HTTP GET /spatial-forecast (Cổng 8001)

fastapi_lstm --> db : Đọc 30 bản ghi để làm dữ liệu đầu vào LSTM
fastapi_spatial --> db : Đọc dữ liệu các node hiện tại trong phòng

backend --> socketio : Phát sự kiện 'new_reading'
socketio --> dashboard : Đẩy WebSocket realtime

dashboard --> chart : Cập nhật biểu đồ đường thẳng
dashboard --> leaflet : Render lưới màu 40x50 làm bản đồ nhiệt

@enduml
```

---

## 3. Sơ đồ d: Sơ đồ Điều hướng Giao diện React (`nav_diagram.jpg`)

Sơ đồ này phản ánh chính xác luồng điều hướng của Single Page Application (React Router) trong file [App.jsx](file:///d:/stuff/weather_dashboard/frontend/src/App.jsx).

```plantuml
@startuml
title Sơ đồ điều hướng giao diện ứng dụng React

[*] --> Chưa_Đăng_Nhập

state Chưa_Đăng_Nhập {
  [*] --> Trang_Login
  Trang_Login --> Trang_Register : Bấm "Register" tab
  Trang_Register --> Trang_Login : Đăng ký thành công / Bấm "Login" tab
}

Chưa_Đăng_Nhập --> Đã_Đăng_Nhập : Xác thực thành công (Lưu JWT)

state Đã_Đăng_Nhập {
  state "Thanh điều hướng Sidebar (Layout.jsx)" as sidebar {
    state "Dashboard (route: /)" as main_dash
    state "Devices (route: /devices)" as devices_list
    state "Forecast (route: /forecast)" as forecast_page
    state "Rooms (route: /rooms)" as rooms_mgr
    state "Alerts (route: /alerts)" as alerts_page
    state "Admin Portal (route: /admin)" as admin_portal
  }
  
  [*] --> main_dash
  
  devices_list --> Màn_Hình_Device_Details : Chọn "Details" (route: /device?id=N)
  state Màn_Hình_Device_Details {
    [*] --> Tab_Live_Chart
    Tab_Live_Chart --> Tab_History_Table : Chuyển Tab
    Tab_History_Table --> Tab_History_Table : Xuất dữ liệu (Export CSV)
    Tab_History_Table --> Tab_Device_Alerts : Chuyển Tab
  }
  
  devices_list --> Modal_Cấu_Hình_Thiết_Bị : Bấm "Settings"
  note right: Cấu hình ngưỡng Temp/Hum/AQI,\nx/y trong phòng, Lat/Lng và Email alert
  
  forecast_page --> Tab_Dự_Báo_Đơn_Thiết_Bị : Tab "Single Device"
  note bottom: Biểu đồ kết hợp lịch sử\nvà dự báo LSTM
  
  forecast_page --> Tab_Dự_Báo_Không_Gian : Tab "Spatial"
  note bottom: Bản đồ nhiệt sàn phòng\n(Leaflet + Kriging Grid)
  
  rooms_mgr --> Modal_Chỉnh_Sửa_Phòng : Bấm "Edit" hoặc "Create Room"
  note right: Nhập tên phòng, mô tả,\ntọa độ tâm, chiều rộng/dài
  
  alerts_page --> alerts_page : Xác nhận cảnh báo (Acknowledge)
}

Đã_Đăng_Nhập --> Chưa_Đăng_Nhập : Đăng xuất (Xóa JWT)

@enduml
```

---

## 4. Sơ đồ e: Sơ đồ Cấu trúc Gói và Tập tin (`package_diagram.jpg`)

Sơ đồ thể hiện đúng cấu trúc thư mục thực tế của dự án.

```plantuml
@startuml
title Sơ đồ cấu trúc gói và tập tin trong dự án

package "ESP32 Firmware" as pkg_firmware {
  folder "sensor/" {
    file "sensor.ino" as ino
  }
}

package "Backend Server (Node.js)" as pkg_backend {
  file "server/index.js" as server_index
  
  folder "server/models/" {
    file "db.js" as models_db
  }
  
  folder "server/routes/" {
    file "auth.js" as r_auth
    file "devices.js" as r_dev
    file "rooms.js" as r_room
    file "data.js" as r_data
    file "alerts.js" as r_alert
    file "forecast.js" as r_forecast
    file "spatialForecast.js" as r_spatial
  }
  
  folder "server/services/" {
    file "mqttService.js" as s_mqtt
    file "alertService.js" as s_alert
    file "forecastService.js" as s_forecast
    file "email.js" as s_email
  }
}

package "Machine Learning Services (Python)" as pkg_ml {
  folder "forecast/" {
    folder "time_forecast/" {
      file "main.py (FastAPI:8000)" as py_time_main
      folder "short_forecast/" {
        file "lstm_train.py" as py_train
        file "lstm_inference.py" as py_infer
        file "lstm_model.pth" as py_model
        file "scaler.pkl" as py_scaler
      }
    }
    file "spatial_forecast.py (FastAPI:8001)" as py_spatial
  }
}

package "Frontend Web Application (React)" as pkg_frontend {
  folder "frontend/src/" {
    file "App.jsx" as fe_app
    file "index.css" as fe_css
    
    folder "pages/" {
      file "Dashboard.jsx" as p_dash
      file "Devices.jsx" as p_devs
      file "DeviceDetails.jsx" as p_details
      file "Forecast.jsx" as p_forecast
      file "Rooms.jsx" as p_rooms
      file "Alerts.jsx" as p_alerts
    }
    
    folder "context/" {
      file "AuthContext.jsx" as c_auth
      file "ConnectionContext.jsx" as c_conn
    }
  }
}

' Tương tác
ino -.> s_mqtt : Gửi dữ liệu MQTT (WiFi)
server_index --> r_auth
server_index --> r_dev
r_dev --> models_db
r_data --> models_db
r_forecast --> s_forecast
s_forecast --> py_time_main : Gọi API lấy dự báo LSTM (Cổng 8000)
r_spatial --> py_spatial : Gọi API lấy Kriging Grid (Cổng 8001)
py_time_main --> models_db : Truy vấn PostgreSQL lấy 30 readings
py_spatial --> models_db : Truy vấn PostgreSQL lấy tọa độ & trị đo
p_details --> c_conn : Lắng nghe Socket.io event 'new_reading'

@enduml
```

---

## 5. Sơ đồ f: Pipeline huấn luyện và dự báo LSTM (`lstm_pipeline.jpg`)

Sơ đồ thể hiện quy trình học máy với thông số cấu hình `dropout=0.3` chuẩn của mô hình.

```plantuml
@startuml
skinparam ParticipantPadding 10
skinparam BoxPadding 10

title Pipeline Huấn luyện (Offline) và Suy luận (Online) của mô hình LSTM

box "Giai đoạn Huấn luyện (Offline)" #LightYellow
  actor "Developer" as dev
  participant "PostgreSQL Database" as db_train
  participant "lstm_train.py (Python)" as train
  database "Tệp mô hình & Scaler" as model_files
end box

box "Giai đoạn Suy luận (Online)" #LightCyan
  participant "Backend Node.js" as node_back
  participant "FastAPI Service (Cổng 8000)" as fastapi
  participant "React Dashboard" as react
end box

' Tiến trình offline
dev -> train : Khởi chạy kịch bản huấn luyện
train -> db_train : Truy vấn toàn bộ dữ liệu readings lịch sử
db_train --> train : Trả về tập dữ liệu
train -> train : Tiền xử lý dữ liệu:\n- Loại bỏ nhiễu và bản ghi lỗi\n- Tính toán chỉ số AQI
train -> train : Khởi tạo MinMaxScaler\nChuẩn hóa dữ liệu về khoảng [0, 1]
train -> model_files : Lưu bộ chuẩn hóa -> scaler.pkl
train -> train : Xây dựng sliding window kích thước w=30,\nnhãn đầu ra h=15
train -> train : Phân chia tập dữ liệu huấn luyện/kiểm thử (80% / 20%)
train -> train : Huấn luyện mạng LSTM\n- 2 Layers, Hidden Size = 64\n- Dropout = 0.3, Adam Optimizer
train -> model_files : Lưu trọng số mô hình tối ưu -> lstm_model.pth

' Tiến trình online
react -> node_back : HTTP GET /api/forecast?device_id=N
node_back -> fastapi : Forward request tới http://localhost:8000/forecast
fastapi -> db_train : SELECT readings WHERE device_id=N ORDER BY timestamp DESC LIMIT 30
db_train --> fastapi : Trả về 30 bản ghi gần nhất (Temp, Hum, AQI)
fastapi -> model_files : Tải scaler.pkl để chuẩn hóa dữ liệu đầu vào
fastapi -> model_files : Tải cấu trúc & trọng số lstm_model.pth
fastapi -> fastapi : Tạo Input Tensor kích thước (1, 30, 3)\n(1 mẫu, window=30, 3 đặc trưng)
fastapi -> fastapi : Chạy dự báo (Model Inference ở chế độ eval)
fastapi -> fastapi : Sử dụng inverse_transform chuyển đổi ngược về giá trị thực
fastapi --> node_back : Trả về JSON chứa danh sách 15 giá trị dự báo kế tiếp
node_back --> react : Trả về dữ liệu dự báo cho client
react -> react : Cập nhật State và vẽ biểu đồ dự báo (Chart.js)

@enduml
```
