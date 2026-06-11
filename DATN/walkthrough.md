# Walkthrough - Kết quả thực hiện cập nhật Đồ án & PlantUML

Tôi đã hoàn thành việc triển khai các thay đổi theo kế hoạch đã được phê duyệt. Dưới đây là tóm tắt các công việc đã thực hiện và kết quả đạt được.

## Các thay đổi đã thực hiện

### 1. Đồng bộ hóa Route, Cổng Dịch vụ và Flash
*   **[chapter2.tex](file:///d:/stuff/weather_dashboard/DATN/chapters/chapter2.tex)**: Sửa cổng kết nối của LSTM service từ `8001` thành `8000` trong phần luồng sự kiện chính của Use Case **UC03** (Xem dự báo và bản đồ nhiệt).
*   **[chapter3.tex](file:///d:/stuff/weather_dashboard/DATN/chapters/chapter3.tex)**:
    *   Sửa cơ chế lưu Flash (phần 3.1.1): làm rõ vi điều khiển chỉ lưu thông tin cấu hình định danh (`device_id`, `api_key` và địa chỉ `mqtt_server`), không lưu các giá trị ngưỡng cảnh báo.
    *   Sửa kiến trúc microservices (phần 3.3.4): làm rõ việc hệ thống chạy 2 FastAPI độc lập: LSTM ở cổng **8000** và Kriging ở cổng **8001**.

### 2. Dọn dẹp và gom nhóm hình ảnh giao diện (`system_...`)
*   **[chapter4.tex](file:///d:/stuff/weather_dashboard/DATN/chapters/chapter4.tex)**:
    *   Sửa tham chiếu ảnh độc lập `ui_heatmap` thành `system_spatial_forecast` để loại bỏ tệp trùng lặp.
    *   Sắp xếp lại 3 cụm hình ảnh giao diện:
        *   **Cụm 1 (Account & Devices)** (`fig:system_demo_part1`): Login, Register, Devices List, Devices Settings.
        *   **Cụm 2 (Telemetry & Detail)** (`fig:system_demo_part2`): Dashboard tổng quan và 3 tab chi tiết thiết bị (Live Chart, History Table, Alerts - đưa ảnh `system_devices_detail_alert` vào sử dụng).
        *   **Cụm 3 (System Forecasts & Alerts)** (`fig:system_demo_part3`): Chứa 5 ảnh: Forecast LSTM, Spatial Heatmap, Rooms List, Rooms Edit Config, System Alerts.
*   **[chapter5.tex](file:///d:/stuff/weather_dashboard/DATN/chapters/chapter5.tex)**: Thay thế ảnh trùng lặp `heatmap_demo` bằng nguồn ảnh chung `system_spatial_forecast`.

### 3. Đồng bộ hóa Code Listings 100% với Codebase
*   **Listing 5.4** (`lst:mqtt_payload`): Cập nhật payload JSON của ESP32 gửi đi có chứa thêm trường `aqi` để khớp 100% với [sensor.ino](file:///d:/stuff/weather_dashboard/sensor/sensor.ino#L311-L314).
*   **Listing 5.6** (`lst:socketio_client`): Cập nhật logic phía Client-side React nhận event `new_reading` cập nhật thêm cả trường `aqi` vào biểu đồ Chart.js để khớp với [DeviceDetails.jsx](file:///d:/stuff/weather_dashboard/frontend/src/pages/DeviceDetails.jsx#L130-L171).

### 4. Tạo tài liệu chứa mã nguồn PlantUML
*   **[plantuml_diagrams.md](file:///d:/stuff/weather_dashboard/DATN/plantuml_diagrams.md)**: Cung cấp đầy đủ mã PlantUML chính xác của 5 sơ đồ:
    *   **b (Kiến trúc firmware ESP32):** Sơ đồ hoạt động loop thực tế.
    *   **c (Kiến trúc tổng quan hệ thống):** Thể hiện Edge Layer gửi `aqi` và phân tách 2 cổng FastAPI `:8000` & `:8001`.
    *   **d (Sơ đồ điều hướng React):** Thể hiện đúng cấu trúc route thực tế.
    *   **e (Cấu trúc thư mục):** Bổ sung `time_forecast/main.py` và sửa tên trang Heatmap thành Forecast.
    *   **f (Pipeline LSTM):** Sửa thông số `dropout` từ `0.2` thành `0.3`.

## Kết quả kiểm tra (Verification Results)

1.  **Tính chính xác của LaTeX**: Đã rà soát cú pháp LaTeX đối với các thay đổi (chân dung subfigures, escape ký tự đặc biệt `\_` trong tên biến, căn lề và định vị hình ảnh `\hfill` và `\vspace`). Tất cả đều tuân thủ định dạng chuẩn.
2.  **Tính nhất quán mã nguồn**: Toàn bộ Listings trích xuất mã nguồn trong báo cáo hiện tại đều phản ánh chính xác 100% nội dung logic và biến của mã nguồn hệ thống thực tế đang chạy.
3.  **Tối ưu hóa tài nguyên**: Dọn dẹp thành công các hình ảnh trùng lặp (`heatmap_demo.jpg`, `ui_heatmap.jpg` trỏ về chung nguồn `system_spatial_forecast.jpg`) và đưa hình ảnh dư thừa `system_devices_detail_alert.jpg` vào đúng vị trí thiết kế.
