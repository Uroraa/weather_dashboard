# Implementation Plan - Cập nhật nội dung đồ án & cung cấp code PlantUML

Bản kế hoạch này mô tả các thay đổi chi tiết đối với tài liệu báo cáo Đồ án tốt nghiệp bằng LaTeX (thư mục `DATN/`) để đồng bộ hoàn toàn với mã nguồn thực tế (Codebase), sắp xếp lại các hình ảnh giao diện theo mức độ liên quan, loại bỏ các tệp trùng lặp và cung cấp mã nguồn PlantUML để vẽ lại các sơ đồ kiến trúc chính xác.

## User Review Required

> [!IMPORTANT]
> - Các thay đổi trên file `.tex` chỉ cập nhật nội dung văn bản và code listings để khớp 100% với codebase thực tế.
> - Toàn bộ 13 tệp ảnh chụp giao diện (`system_...`) sẽ được gom nhóm thành 3 cụm hình ảnh có tính liên kết chặt chẽ (Xác thực, Giám sát chi tiết, Dự báo & Phòng).
> - Tệp ảnh trùng lặp (`heatmap_demo.jpg` và `ui_heatmap.jpg`) sẽ được chuyển sang sử dụng chung nguồn ảnh `system_spatial_forecast.jpg` và cập nhật trong mã LaTeX.
> - Mã PlantUML sẽ được cung cấp dưới dạng một tệp tài liệu riêng biệt trong thư mục `DATN/` để người dùng dễ dàng sao chép và sinh lại ảnh.

## Proposed Changes

---

### LaTeX Documentation

#### [MODIFY] [chapter2.tex](file:///d:/stuff/weather_dashboard/DATN/chapters/chapter2.tex)
*   Sửa lỗi cổng của FastAPI service tại luồng chính của Use Case **UC03** (Xem dự báo và bản đồ nhiệt) tại dòng 443: thay thế cổng `8001` bằng cổng `8000` (đối với LSTM Time Series Forecast).

#### [MODIFY] [chapter3.tex](file:///d:/stuff/weather_dashboard/DATN/chapters/chapter3.tex)
*   Sửa thông tin bộ nhớ Flash (dòng 40-42): ESP32 chỉ lưu cấu hình định danh (`device_id`, `api_key` và địa chỉ `mqtt_server`), không lưu ngưỡng cảnh báo.
*   Sửa thông tin các cổng FastAPI (dòng 187-197): làm rõ hệ thống chạy 2 dịch vụ FastAPI độc lập ở cổng `8000` (LSTM) và `8001` (Nội suy Kriging).

#### [MODIFY] [chapter4.tex](file:///d:/stuff/weather_dashboard/DATN/chapters/chapter4.tex)
*   Thay thế hình ảnh `ui_heatmap` bằng `system_spatial_forecast` ở dòng 650 và cập nhật caption cho đúng bản chất tab Dự báo không gian.
*   Sắp xếp lại cấu trúc 3 cụm hình ảnh giao diện (`system_...`):
    *   **Cụm 1 (Account & Devices):** Đăng nhập (`system_login`), Đăng ký (`system_register`), Danh sách thiết bị (`system_devices`), Cấu hình thiết bị (`system_devices_setting`).
    *   **Cụm 2 (Telemetry & Detail):** Dashboard tổng quan (`system_dashboard`), Biểu đồ chi tiết (`system_devices_detail_chart`), Bảng lịch sử (`system_devices_detail_history`), Cảnh báo thiết bị (`system_devices_detail_alert` - ảnh trước đây bị thừa).
    *   **Cụm 3 (System Forecasts & Alerts):** Dự báo thời gian (`system_forecast`), Dự báo không gian (`system_spatial_forecast`), Danh sách phòng (`system_rooms`), Cấu hình phòng (`system_rooms_config`), Cảnh báo hệ thống (`system_alerts` - cụm này có 5 hình và được căn chỉnh bố cục hợp lý).

#### [MODIFY] [chapter5.tex](file:///d:/stuff/weather_dashboard/DATN/chapters/chapter5.tex)
*   Thay thế hình ảnh `heatmap_demo` bằng `system_spatial_forecast` ở dòng 355.
*   Cập nhật **Listing 5.4** (`lst:mqtt_payload`): bổ sung trường dữ liệu `aqi` vào JSON payload gửi đi của ESP32.
*   Cập nhật **Listing 5.6** (`lst:socketio_client`): bổ sung xử lý trường `aqi` trong sự kiện `new_reading` và cập nhật State của React.

---

### PlantUML Diagram Specifications

#### [NEW] [plantuml_diagrams.md](file:///d:/stuff/weather_dashboard/DATN/plantuml_diagrams.md)
*   Tạo tài liệu chứa mã nguồn PlantUML cập nhật, sửa đổi toàn bộ các sai lệch của các biểu đồ:
    *   **Sơ đồ b (Kiến trúc firmware ESP32):** Thể hiện đúng cấu trúc loop đơn giản, không chứa ML model hay các module power manager phức tạp.
    *   **Sơ đồ c (Kiến trúc hệ thống):** Thể hiện Edge Layer gửi `aqi` và phân tách rõ hai cổng FastAPI `:8000` (LSTM) và `:8001` (Kriging).
    *   **Sơ đồ d (Sơ đồ điều ứng UI):** Khớp hoàn toàn với cấu trúc route và sidebar thực tế.
    *   **Sơ đồ e (Sơ đồ cấu trúc thư mục):** Bổ sung `time_forecast/main.py` (:8000) và đổi tên Heatmap page thành Forecast page.
    *   **Sơ đồ f (Sơ đồ luồng LSTM):** Đổi thông số `dropout` từ `0.2` thành `0.3`.

## Verification Plan

### Manual Verification
*   Biên dịch thử nghiệm các file `.tex` để đảm bảo không xảy ra lỗi cú pháp LaTeX.
*   Kiểm tra các liên kết ảnh xem đã đúng nguồn ảnh chưa.
*   Xác nhận mã PlantUML render chính xác thông qua bộ kiểm tra cú pháp.
