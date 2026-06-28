# Nhật Ký Ngữ Cảnh & Yêu Cầu Phát Triển Dự Án

Tài liệu này tổng hợp toàn bộ các ngữ cảnh, yêu cầu nghiệp vụ và lỗi kỹ thuật đã được cung cấp và xử lý trong suốt quá trình phát triển ứng dụng Bản đồ ẩm thực Vĩnh Khánh (PWA & Backend .NET).

---

## 1. Yêu Cầu Giao Diện Bản Đồ PWA & Trình Chọn Ngôn Ngữ
* **Bối cảnh:** Điều chỉnh giao diện người dùng trên trang du khách.
* **Yêu cầu cụ thể:**
  * Giữ nguyên trình chọn ngôn ngữ mặc định là tiếng Việt.
  * Ẩn hoặc tùy biến ô nhập URL máy chủ để tối ưu giao diện nhưng vẫn giữ khả năng kết nối linh hoạt.

## 2. Tính Năng Định Vị GPS & Giả Lập Đi Bộ (GPS Simulation)
* **Bối cảnh:** Việc kiểm thử định vị GPS thực tế gặp khó khăn khi lập trình viên ngồi một chỗ.
* **Yêu cầu cụ thể:**
  * Thiết lập chấm tròn radar màu xanh biểu diễn vị trí của người dùng trên bản đồ Leaflet.
  * Phát triển tính năng **Mô phỏng đi bộ (Simulated Walk)**: Tự động chạy một lộ trình di chuyển ảo dọc theo tuyến phố ẩm thực Vĩnh Khánh qua các tọa độ định sẵn (Cô Lệ -> Ốc Oanh -> Cô Thảo) để kiểm tra tính năng tự phát âm thuyết minh khi đi vào bán kính gần (< 20m) của các quán ăn mà không cần ra thực địa.

## 3. Hệ Thống Admin Dashboard & Cổng Định Danh Chủ Quán (Owner Portal)
* **Bối cảnh:** Quản lý và vận hành hệ thống bản đồ ẩm thực.
* **Yêu cầu cụ thể:**
  * Tạo trang Đăng nhập / Đăng ký phân quyền (`Admin` và `Owner`).
  * **Chức năng Admin:**
    * Xem các số liệu thống kê (Tổng số quán ăn, số người dùng đăng ký, số người dùng đang online thời gian thực).
    * Thiết kế bản đồ **Live User Tracking** để giám sát tọa độ thời gian thực của du khách trên đường Vĩnh Khánh dựa vào tín hiệu GPS Heartbeat 30 giây một lần từ client.
    * Duyệt hồ sơ đăng ký chủ quán (có chức năng mã hóa và giải mã số căn cước công dân - CCCD để bảo mật PII).
    * Phê duyệt các bài thuyết minh quán ăn mới được cập nhật.
    * Xem toàn bộ nhật ký hệ thống (Audit Telemetry Logs).
  * **Chức năng Chủ quán (Owner):**
    * Chỉnh sửa thông tin quán ăn, kéo thả ghim trên bản đồ để xác định vị trí của quán ăn di động.
    * Xem thông báo đẩy trực tiếp khi đơn duyệt được Admin xử lý.
    * Gọi trợ lý **AI Advisor** để tối ưu hóa văn bản thuyết minh thô.

## 4. Các Lỗi Kỹ Thuật Đã Xảy Ra & Cách Xử Lý

### A. Lỗi Múi Giờ PostgreSQL (Npgsql DateTime Kind)
* **Thông báo lỗi:** `Cannot write DateTime with Kind=Local to PostgreSQL type 'timestamp with time zone', only UTC is supported.`
* **Nguyên nhân:** Thư viện Npgsql từ chối lưu dữ liệu `DateTime.Today` (múi giờ Local) vào cột `timestamp with time zone` trên Neon.
* **Xử lý:** Thay thế toàn bộ các hàm lấy ngày hiện tại thành `DateTime.SpecifyKind(DateTime.UtcNow.Date, DateTimeKind.Utc)` trong `Entities.cs` và `AiController.cs`.

### B. Lỗi Quá Tải & Hạn Mức API Gemini (Lỗi 503 / 429)
* **Thông báo lỗi:** `Response status code does not indicate success: 503 (Service Unavailable)` và `429 (Too Many Requests)`.
* **Nguyên nhân:** Khóa API Key của Google Gemini bị quá tải hạn mức gọi hoặc dịch vụ tạm thời không khả dụng.
* **Xử lý:**
  * Triển khai cơ chế **Tự động thử lại (Retry with Exponential Backoff)** tối đa 3 lần.
  * Triển khai cơ chế **Chuyển đổi dự phòng (Model Fallback):** Tự động chuyển đổi giữa `gemini-2.5-flash` và `gemini-2.0-flash`.
  * Triển khai **Bộ tối ưu hóa thuyết minh cục bộ (Local Mock Fallback)** và **Mô tả danh sách dự phòng (Chat Fallback)**: Nếu API Google lỗi hoàn toàn, hệ thống tự động sinh văn bản tối ưu hóa bằng thuật toán nội bộ chất lượng cao để tiến trình của người dùng không bị lỗi 500 hay gián đoạn.

## 5. Tài Liệu Hóa Hệ Thống & Bảo Mật Mã Nguồn
* **Bối cảnh:** Chuẩn bị đẩy mã nguồn lên GitHub chia sẻ cho thành viên khác clone về hoạt động tốt.
* **Yêu cầu cụ thể:**
  * **Sơ đồ hóa:** Viết tài liệu [architecture_documentation.md](architecture_documentation.md) mô tả toàn bộ cấu trúc bảng database, mối quan hệ (ERD), luồng sự kiện (Sequence Diagrams) bằng cú pháp Mermaid.js chuẩn.
  * **Bảo mật thông tin (Secrets):** Tách biệt cấu hình khóa thật sang file `appsettings.Development.json` và thay thế `appsettings.json` gốc bằng các chuỗi giữ chỗ mẫu.
  * **Bỏ qua thư mục rác:** Tạo file `.gitignore` để bỏ qua các thư mục build cache chứa đường dẫn cứng máy cá nhân (`bin/`, `obj/`), thư mục cấu hình `.vscode/`, `node_modules/` và tệp chứa key nhạy cảm `appsettings.Development.json`.
  * **Hướng dẫn dự án:** Tạo file [README.md](README.md) để hướng dẫn cấu trúc dự án và cách chạy môi trường phát triển local.

## 6. Chạy Thử GPS Trên Điện Thoại Di Động
* **Bối cảnh:** Điện thoại chặn gọi GPS trên kết nối HTTP không bảo mật.
* **Yêu cầu cụ thể:**
  * Hướng dẫn chi tiết cách chạy song song đường hầm HTTPS bằng **ngrok** (cho Frontend) và **localtunnel** (cho Backend) để kiểm thử thực tế trên điện thoại.
  * Xử lý lỗi bypass trang cảnh báo chống spam của localtunnel.
  * Viết tài liệu hướng dẫn hoàn chỉnh tại [huongdandienthoai.md](huongdandienthoai.md).
  * Làm rõ nguyên lý chạy **Offline-First** (PWA có thể chạy hoàn toàn ngoại tuyến nhờ Service Worker cache file tĩnh & file audio thuyết minh kết hợp cơ sở dữ liệu ngoại tuyến IndexedDB).
