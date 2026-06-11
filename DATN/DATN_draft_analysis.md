# Đánh Giá & Phân Tích Chi Tiết Dự Thảo Đồ Án Tốt Nghiệp
**Sinh viên thực hiện**: Nguyễn Lê Hà Sơn — MSSV: 20225157  
**Đề tài**: *Hệ thống AIoT giám sát và dự báo chất lượng không khí dựa trên dữ liệu chuỗi thời gian*  

Tài liệu này đối chiếu chi tiết nội dung mô tả trong bản thảo báo cáo Đồ án tốt nghiệp (file `DATN_draft_Nguyễn Lê Hà Sơn_20225157.pdf`) với mã nguồn thực tế của dự án tại thư mục `d:\stuff\weather_dashboard`. Dưới đây là các điểm sai lệch, thiếu sót quan trọng cần được chỉnh sửa để báo cáo khớp hoàn toàn với hệ thống thực tế.

---

## 1. Sai lệch trong Firmware ESP32 & Cơ chế lưu trữ Thresholds

> [!WARNING]  
> **Điểm sai lệch nghiêm trọng nhất trong phần Firmware:** Báo cáo mô tả ESP32 tự quản lý và lưu các ngưỡng cảnh báo để so sánh, nhưng thực tế ESP32 chỉ là node thu thập dữ liệu thô.

*   **Mô tả trong báo cáo (Trang 5, 29, 32, 45, 48):**
    *   Báo cáo khẳng định ESP32 nhận các giá trị ngưỡng cảnh báo (`temp_high`, `temp_low`, `hum_high`, `hum_low`) từ topic MQTT cấu hình `devices/{mac}/config` rồi lưu vào bộ nhớ Flash qua thư viện `Preferences.h`.
    *   Báo cáo trích dẫn **Listing 4.1** (các hàm `saveConfig`, `loadConfig` lưu các biến `tempHigh`, `tempLow`...) và **Listing 4.3** (hàm `onMqttMessage` lọc lấy các ngưỡng và gọi `saveConfig`).
*   **Mã nguồn thực tế ([sensor.ino](file:///d:/stuff/weather_dashboard/sensor/sensor.ino)):**
    *   Trong file [sensor.ino](file:///d:/stuff/weather_dashboard/sensor/sensor.ino), **không hề tồn tại** các hàm `saveConfig`, `loadConfig` hay callback `onMqttMessage`.
    *   Callback nhận tin nhắn MQTT thực tế là [mqttCallback](file:///d:/stuff/weather_dashboard/sensor/sensor.ino#L55-L95). Hàm này chỉ kiểm tra và lưu `device_id` và `api_key` phục vụ cho quá trình Provisioning (đăng ký thiết bị tự động), hoàn toàn không nhận hay lưu trữ bất kỳ ngưỡng cảnh báo nhiệt độ hay độ ẩm nào.
    *   Việc kiểm tra ngưỡng cảnh báo thực tế được xử lý tập trung ở phía Backend Node.js thông qua `alertService.js`.
*   **Hướng chỉnh sửa:** 
    *   Xóa bỏ các hàm giả lập `saveConfig`, `loadConfig` và logic parse ngưỡng cảnh báo trong báo cáo.
    *   Cập nhật mô tả: Khẳng định ESP32 chỉ lưu thông tin cấu hình định danh (`device_id`, `api_key` và địa chỉ `mqtt_server` để kết nối). Mọi logic so sánh ngưỡng và kích hoạt cảnh báo đều được thực hiện ở server-side để giảm tải cho vi điều khiển.

---

## 2. Thiếu sót trường dữ liệu AQI trong ESP32 Payload & Feature Mô hình LSTM

> [!IMPORTANT]  
> Báo cáo trích dẫn code ESP32 thiếu trường dữ liệu `aqi` khiến các đoạn code phía sau (nhận dữ liệu aqi ở Backend và ML) trở nên không nhất quán.

*   **Mô tả trong báo cáo (Trang 41, 47, 54):**
    *   **Listing 4.2** (Trang 47) trích dẫn hàm `publishData(float temp, float hum)` của ESP32 chỉ đóng gói và gửi lên MQTT payload chứa `temperature` và `humidity`.
    *   Trang 54 (mục 4.2.5.a.4) viết: *"X_t là ma trận 30 x 2 (30 bước quá khứ, 2 features)..."*.
*   **Mã nguồn thực tế ([sensor.ino](file:///d:/stuff/weather_dashboard/sensor/sensor.ino) & [lstm_train.py](file:///d:/stuff/weather_dashboard/forecast/time_forecast/short_forecast/lstm_train.py)):**
    *   Trong file [sensor.ino](file:///d:/stuff/weather_dashboard/sensor/sensor.ino#L311-L314), hàm loop gửi payload thực tế chứa cả 3 trường:
        ```cpp
        String payload = "{\"temperature\":" + String(temperature, 1) +
                         ",\"humidity\":"    + String(humidity, 1)    + 
                         ",\"aqi\":"         + String(aqi, 1)         + "}";
        ```
    *   Trong mã nguồn huấn luyện mô hình LSTM [lstm_train.py](file:///d:/stuff/weather_dashboard/forecast/time_forecast/short_forecast/lstm_train.py#L12-L21) và API FastAPI [main.py](file:///d:/stuff/weather_dashboard/forecast/time_forecast/main.py#L12), biến `INPUT_SIZE` được đặt bằng **3** (đầu vào mô hình gồm 3 đặc trưng: `temperature`, `humidity`, `aqi`).
    *   Bản thân mã giả huấn luyện trong báo cáo ở **Listing 5.1** (Trang 68) cũng để: `# X shape: (N, window=30, features=3)` và `input_size=3`.
*   **Hướng chỉnh sửa:**
    *   Chỉnh sửa **Listing 4.2** trong báo cáo để bổ sung gửi thêm trường `"aqi"` trong JSON payload tương tự như mã nguồn thực tế.
    *   Sửa lại dòng mô tả ở trang 54 thành 3 features thay vì 2 features để thống nhất với bảng cấu trúc LSTM và mã nguồn PyTorch.

---

## 3. Sai lệch về Kiến trúc Cổng (Port) của FastAPI Microservices

> [!NOTE]  
> Báo cáo ghi hệ thống chỉ chạy một service FastAPI duy nhất ở cổng 8001, trong khi thực tế hệ thống chạy hai service độc lập ở cổng 8000 và 8001.

*   **Mô tả trong báo cáo (Trang 27, 31, 36, 52):**
    *   Báo cáo viết FastAPI là một microservice độc lập chạy trên cổng `8001` chịu trách nhiệm cho cả hai chức năng: Dự báo LSTM và tính toán nội suy Kriging/IDW.
    *   Trang 52 hướng dẫn khởi động: `uvicorn spatial_forecast:app --port 8001 --reload` và không nhắc tới file chạy dự báo thời gian.
*   **Mã nguồn thực tế:**
    *   Hệ thống chạy **2 microservices Python độc lập**:
        1.  **Time Series Forecast** ([main.py](file:///d:/stuff/weather_dashboard/forecast/time_forecast/main.py#L280-L281)): Chạy model LSTM trên cổng **8000**.
        2.  **Spatial Forecast** ([spatial_forecast.py](file:///d:/stuff/weather_dashboard/forecast/spatial_forecast.py#L514-L515)): Chạy Kriging/IDW kết hợp LSTM trên cổng **8001**.
    *   Phía Node.js Backend gọi sang Python qua các file:
        *   [forecastService.js](file:///d:/stuff/weather_dashboard/server/services/forecastService.js#L3) gọi tới `http://localhost:8000` (để lấy dự báo chuỗi thời gian).
        *   [spatialForecast.js](file:///d:/stuff/weather_dashboard/server/routes/spatialForecast.js#L6) gọi tới `http://localhost:8001` (để lấy bản đồ nhiệt).
*   **Hướng chỉnh sửa:**
    *   Làm rõ trong báo cáo rằng hệ thống ML/Spatial được chia làm 2 microservices riêng biệt để phân tách luồng tính toán (một service tối ưu cho truy vấn chuỗi thời gian nhanh qua cổng 8000, một service chuyên tính toán lưới Kriging 40x50 nặng qua cổng 8001).
    *   Bổ sung hướng dẫn khởi chạy cả 2 service Python trong phần hướng dẫn chạy hệ thống ở Chương 4.

---

## 4. Lỗi thiếu trường cơ sở dữ liệu trong file khởi tạo `db.js`

> [!CAUTION]  
> Đây là một lỗi logic/bug thực tế trong codebase của bạn, khiến hệ thống sẽ crash khi chạy lần đầu nếu cài đặt từ đầu theo file `db.js`. Bạn nên cập nhật lại file code này.

*   **Mô tả trong báo cáo (Trang 36, 49, 50 - Bảng ERD & Schema):**
    *   Báo cáo chỉ ra bảng `devices` có đầy đủ các cột vị trí: `x`, `y`, `lat`, `lng` cùng thông tin phần cứng `mac_address`, `firmware_version`, `chip_model`.
    *   Code backend thực tế trong [devices.js](file:///d:/stuff/weather_dashboard/server/routes/devices.js) thực hiện ghi và đọc các cột này (ví dụ dòng 84 và 128).
*   **Mã nguồn thực tế ([db.js](file:///d:/stuff/weather_dashboard/server/models/db.js)):**
    *   Trong file khởi tạo database [db.js](file:///d:/stuff/weather_dashboard/server/models/db.js#L50-L73), câu lệnh `CREATE TABLE devices` và các câu lệnh `ALTER TABLE` **hoàn toàn thiếu** việc tạo các cột: `mac_address`, `x`, `y`, `lat`, `lng`, `firmware_version`, và `chip_model`.
    *   Nếu triển khai ứng dụng từ đầu, việc tạo thiết bị hoặc cập nhật vị trí thiết bị sẽ phát sinh lỗi cơ sở dữ liệu `column "mac_address" does not exist`.
*   **Hướng chỉnh sửa (trong Codebase):**
    *   Bạn nên sửa file [db.js](file:///d:/stuff/weather_dashboard/server/models/db.js) để tự động thêm các cột này nếu chúng chưa tồn tại, tránh lỗi khi chạy setup dự án. Ví dụ thêm đoạn migration sau vào `initializeDb()`:
        ```javascript
        await pool.query(`
            ALTER TABLE devices 
            ADD COLUMN IF NOT EXISTS mac_address VARCHAR(17) UNIQUE,
            ADD COLUMN IF NOT EXISTS x DOUBLE PRECISION,
            ADD COLUMN IF NOT EXISTS y DOUBLE PRECISION,
            ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION,
            ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION,
            ADD COLUMN IF NOT EXISTS firmware_version VARCHAR(50),
            ADD COLUMN IF NOT EXISTS chip_model VARCHAR(50);
        `);
        ```

---

## 5. Cấu trúc Điều hướng Giao diện: Trang Heatmap độc lập vs Tab hiển thị

*   **Mô tả trong báo cáo (Trang 43, 56):**
    *   Báo cáo liệt kê `"Trang heatmap"` là một trang riêng biệt điều hướng từ Sidebar (mục 4.2.6.a).
    *   Sơ đồ điều hướng hình 4.6 vẽ route `Heatmap` song song độc lập với `Devices`.
*   **Mã nguồn thực tế ([App.jsx](file:///d:/stuff/weather_dashboard/frontend/src/App.jsx) & [Forecast.jsx](file:///d:/stuff/weather_dashboard/frontend/src/pages/Forecast.jsx)):**
    *   Không có file `Heatmap.jsx` nào trong thư mục [pages](file:///d:/stuff/weather_dashboard/frontend/src/pages).
    *   Tính năng vẽ Heatmap không gian thực tế nằm chung bên trong trang Dự báo [Forecast.jsx](file:///d:/stuff/weather_dashboard/frontend/src/pages/Forecast.jsx). Người dùng chuyển đổi giữa hai chế độ xem bằng các tab `"Single Device"` và `"Spatial"`.
*   **Hướng chỉnh sửa:**
    *   Chỉnh sửa sơ đồ điều hướng hình 4.6 để gộp màn hình Heatmap vào chung trang **Forecast** (Dự báo).
    *   Đổi tên gọi từ *"Trang heatmap"* thành *"Màn hình dự báo không gian (Spatial Forecast) thuộc trang Dự báo"*.

---

## 6. Phân tích chi tiết các Listing Code trong Báo cáo

| Listing | Tên trong báo cáo | Trạng thái đối chiếu với Codebase | Đánh giá & Gợi ý chỉnh sửa |
| :--- | :--- | :--- | :--- |
| **Listing 4.1** | *Lưu và đọc cấu hình từ Flash ESP32* | **Sai lệch lớn** | Code này hoàn toàn không có trong [sensor.ino](file:///d:/stuff/weather_dashboard/sensor/sensor.ino). Nó định nghĩa các hàm giả lập thresholds. Cần viết lại theo logic lưu `device_id` và `api_key` thực tế của [sensor.ino](file:///d:/stuff/weather_dashboard/sensor/sensor.ino#L81-L89). |
| **Listing 4.2** | *Luồng chính firmware ESP32* | **Thiếu trường** | Code gần khớp, nhưng hàm `publishData` bị thiếu việc gửi trường `"aqi"`. Cần bổ sung trường `"aqi"` vào payload gửi đi để khớp với ML pipeline và backend. |
| **Listing 4.3** | *Callback xử lý message cấu hình MQTT* | **Sai lệch lớn** | Tên hàm thực tế là `mqttCallback` và logic thực tế chỉ parse `device_id`, `api_key`. Code trong báo cáo giả định parse các ngưỡng nhiệt ẩm. Cần cập nhật lại. |
| **Listing 4.4** | *Schema cơ sở dữ liệu PostgreSQL* | **Thiếu trường (trong code)** | Schema mô tả rất đầy đủ và đúng đắn, nhưng file setup database thực tế [db.js](file:///d:/stuff/weather_dashboard/server/models/db.js) lại thiếu các trường vị trí và MAC address. Cần cập nhật code [db.js](file:///d:/stuff/weather_dashboard/server/models/db.js) để khớp schema này. |
| **Listing 4.5** | *Middleware xác thực JWT* | **Khớp 100%** | Khớp hoàn toàn với [auth.js](file:///d:/stuff/weather_dashboard/server/middleware/auth.js). |
| **Listing 4.6** | *Logic kiểm tra ngưỡng cảnh báo* | **Khớp 95%** | Gần trùng khớp với logic của `alertService.js` (chỉ khác biệt nhỏ về cách format câu SQL insert). |
| **Listing 4.7** | *Script mô phỏng node ESP32 bằng Node.js* | **Khớp 90%** | Khớp với file `scripts/simulate_esp32.js` (chỉ thiếu trường `aqi` trong payload fake ở báo cáo, thực tế nên bổ sung). |
| **Listing 5.1** | *Mã giả huấn luyện LSTM* | **Khớp 100%** | Khớp với logic xây dựng model và huấn luyện trong [lstm_train.py](file:///d:/stuff/weather_dashboard/forecast/time_forecast/short_forecast/lstm_train.py). |
| **Listing 5.2** | *Mã giả inference tại FastAPI service* | **Khớp 95%** | Khớp với logic trong [main.py](file:///d:/stuff/weather_dashboard/forecast/time_forecast/main.py#L165-L241). |
| **Listing 5.3** | *Mã giả nội suy không gian (Kriging/IDW)* | **Khớp 95%** | Trùng khớp với logic xử lý toán học trong [spatial_forecast.py](file:///d:/stuff/weather_dashboard/forecast/spatial_forecast.py#L326-L500). |
| **Listing 5.5** | *MQTT message handling in Aedes broker* | **Khớp 90%** | Khớp với phần xử lý sự kiện `publish` trong [mqttService.js](file:///d:/stuff/weather_dashboard/server/services/mqttService.js#L186-L253). |
| **Listing 5.6** | *Client-side Socket.io in React dashboard* | **Khớp 90%** | Thể hiện đúng luồng bắt Socket và cập nhật biểu đồ ở Frontend. |

---

## 7. Các điểm bảo mật & Thực hành lập trình tốt (Security Best Practices) cần lưu ý thêm

Trong chương 5 hoặc chương 6 (Hạn chế & Hướng phát triển), sinh viên có thể đưa thêm các nhận xét mang tính phản biện cao để tăng điểm chất lượng đồ án:
1.  **Lộ bí mật thông tin (Hardcoded Credentials)**: Trong các file Python microservices ([main.py](file:///d:/stuff/weather_dashboard/forecast/time_forecast/main.py#L36-L41) và [spatial_forecast.py](file:///d:/stuff/weather_dashboard/forecast/spatial_forecast.py#L31-L36)), thông tin đăng nhập PostgreSQL (`password: "*Hs123456"`) đang bị hardcode. Cần đề xuất chuyển sang dùng biến môi trường `.env` sử dụng thư viện `python-dotenv` giống như Backend Node.js để nâng cao tính bảo mật.
2.  **Mã hóa kênh truyền**: Mặc dù báo cáo đã tự nhận diện hạn chế *"chưa mã hóa kênh truyền MQTT (MQTT over TLS)"*, đây là điểm tự đánh giá rất khách quan và chính xác, cần giữ nguyên trong mục 6.1.3 (Hạn chế).
3.  **Hiện trạng trong Codebase**: Vấn đề lộ thông tin cơ sở dữ liệu đã được khắc phục hoàn toàn trong mã nguồn thực tế bằng cách sử dụng biến môi trường `.env` và thư viện `python-dotenv`. Sinh viên nên cập nhật nội dung chương này để phản ánh đúng thiết kế bảo mật thực tế thay vì viết là hệ thống đang hardcode credentials.

---

## 8. Sai lệch trong các sơ đồ và hình ảnh minh họa (Diagram & Image Discrepancies)

> [!WARNING]
> Nhiều sơ đồ kiến trúc và hình ảnh kỹ thuật trong báo cáo đang sử dụng hình vẽ không khớp với mã nguồn thực tế (một số là hình vẽ của các linh kiện/hệ thống khác, hoặc sơ đồ thiết kế cũ chưa cập nhật).

### a. Sơ đồ Nguyên lý Phần cứng (`hardware_schematic.jpg`)
*   **Sai lệch:** Hình ảnh minh họa vi điều khiển sử dụng bo mạch **ESP8266 NodeMCU** (có chữ *ESP8266MOD* và sơ đồ chân của NodeMCU V3), trong khi toàn bộ báo cáo và thiết kế hệ thống khẳng định sử dụng **ESP32**. ESP8266 và ESP32 là hai dòng chip hoàn toàn khác nhau về cấu hình phần cứng, số lượng chân GPIO và hiệu năng.
*   **Đường dây kết nối:** Sơ đồ vẽ chân `DATA` của DHT11 kết nối vào chân `D4` của ESP8266 (tương ứng GPIO2). Tuy nhiên, trong code firmware thực tế [sensor.ino](file:///d:/stuff/weather_dashboard/sensor/sensor.ino#L19), chân kết nối cảm biến được định nghĩa là `#define DHTPIN 4` (GPIO4 trên chip ESP32).
*   **Hướng chỉnh sửa:** Thay thế hình ảnh bo mạch ESP8266 bằng hình ảnh sơ đồ chân của **ESP32 DevKit V1** và vẽ lại đường nối DHT11 DATA vào chân GPIO4 (D4) của ESP32 để đồng nhất với thực tế.

### b. Sơ đồ Kiến trúc Firmware (`firmware_arch.jpg`)
*   **Sai lệch:** Sơ đồ vẽ kiến trúc firmware ESP32 bao gồm các module thành phần phức tạp như: `power_manager`, `data_buffer` và đặc biệt là **`ml_model`** (mô hình học máy chạy local trên chip).
*   **Thực tế:** Mã nguồn firmware [sensor.ino](file:///d:/stuff/weather_dashboard/sensor/sensor.ino) là một chương trình đơn phẳng (flat structure), không chia cấu trúc thư mục/thành phần như vậy. Quan trọng hơn, **ESP32 không hề chạy bất kỳ mô hình học máy (`ml_model`) nào**. Mô hình dự báo LSTM chạy tập trung ở FastAPI service trên máy chủ.
*   **Hướng chỉnh sửa:** Vẽ lại sơ đồ kiến trúc firmware đơn giản, chỉ gồm các khối logic thực tế: Khởi tạo (WiFiManager, MQTT, DHT), Vòng lặp đọc dữ liệu cảm biến, và Gửi dữ liệu qua MQTT.

### c. Sơ đồ Kiến trúc Tổng quan (`arch_overview.jpg`)
*   **Sai lệch 1 (Edge Layer):** Sơ đồ ghi payload gửi đi từ ESP32 là `publish JSON {temp, hum}`. Thực tế, payload được gửi đi bao gồm cả trường dữ liệu AQI: `{temperature, humidity, aqi}`.
*   **Sai lệch 2 (Backend Layer):** Sơ đồ vẽ một khối duy nhất `FastAPI ML Service :8001` đảm nhiệm cả `LSTM (PyTorch) + Kriging/IDW`. Thực tế hệ thống chạy hai service độc lập ở hai cổng khác nhau: LSTM Time-series ở cổng **8000** và Spatial Heatmap ở cổng **8001**.
*   **Hướng chỉnh sửa:** Cập nhật sơ đồ: bổ sung trường `aqi` vào payload ở Edge Layer và tách service FastAPI thành hai cổng `:8000` (LSTM) và `:8001` (Nội suy không gian).

### d. Sơ đồ Điều hướng Giao diện (`nav_diagram.jpg`)
*   **Sai lệch:** Sơ đồ vẽ màn hình `Heatmap` và `Alerts` là các trang độc lập, song song với `Devices` và `Rooms` từ Sidebar. Đồng thời vẽ `Devices` chứa chức năng "Dự báo LSTM".
*   **Thực tế:**
    *   Hệ thống không có trang `Heatmap` riêng. Cả hai chức năng dự báo chuỗi thời gian (LSTM Single Device) và nội suy không gian (Spatial Heatmap) đều nằm chung trong trang **Forecast** (Dự báo, route `/forecast`).
    *   Trang `Devices` chỉ hiển thị danh sách thiết bị. Khi bấm vào một thiết bị mới dẫn đến trang chi tiết `Device Details` (chứa biểu đồ realtime, bảng lịch sử và danh sách cảnh báo của thiết bị đó).
*   **Hướng chỉnh sửa:** Vẽ lại sơ đồ điều hướng khớp với cấu trúc route thực tế trong [App.jsx](file:///d:/stuff/weather_dashboard/frontend/src/App.jsx) và sidebar trong [Layout.jsx](file:///d:/stuff/weather_dashboard/frontend/src/components/Layout.jsx).

### e. Sơ đồ Gói & Cấu trúc Thư mục (`package_diagram.jpg`)
*   **Sai lệch 1 (Mất file):** Trong gói `forecast/` ở backend, sơ đồ hoàn toàn thiếu file dịch vụ dự báo chuỗi thời gian `time_forecast/main.py` chạy trên cổng 8000.
*   **Sai lệch 2 (Sai tên màn hình):** Trong gói `frontend/src/pages/`, sơ đồ vẽ màn hình `Heatmap` thay vì màn hình `Forecast` thực tế.
*   **Hướng chỉnh sửa:** Bổ sung `time_forecast/main.py` vào gói `forecast/` và sửa tên màn hình `Heatmap` thành `Forecast` trong gói frontend.

### f. Sơ đồ Luồng Huấn luyện LSTM (`lstm_pipeline.jpg`)
*   **Sai lệch:** Sơ đồ ghi thông số huấn luyện mô hình là `dropout=0.2`. Tuy nhiên, trong mã nguồn huấn luyện thực tế [lstm_train.py](file:///d:/stuff/weather_dashboard/forecast/time_forecast/short_forecast/lstm_train.py#L107), thông số dropout được cấu hình là `0.3` để tăng cường khả năng chống quá khớp (overfitting).
*   **Hướng chỉnh sửa:** Sửa giá trị dropout trên sơ đồ từ `0.2` thành `0.3`.

### g. Tệp ảnh trùng lặp và ảnh dư thừa không sử dụng
*   **Ảnh trùng lặp:** Ba tệp ảnh `heatmap_demo.jpg`, `ui_heatmap.jpg` và `system_spatial_forecast.jpg` thực chất là ba bản sao hoàn toàn giống nhau của cùng một ảnh chụp giao diện bản đồ nội suy. Nên dọn dẹp và chỉ tham chiếu đến một tệp duy nhất để tránh lãng phí dung lượng báo cáo.
*   **Ảnh không sử dụng:** Tệp ảnh `system_devices_detail_alert.jpg` (chụp tab Alerts trong trang chi tiết thiết bị) được copy vào thư mục `images/` nhưng hoàn toàn không được tham chiếu hay sử dụng ở bất kỳ dòng mã nào trong các file `.tex`.

