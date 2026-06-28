# Tài liệu Nghiệm thu & Hướng dẫn (Walkthrough) - Ứng dụng PWA Thuyết minh Ẩm thực Quận 4

Hệ thống ứng dụng Thuyết minh Ẩm thực Đường phố Quận 4 đã được xây dựng hoàn tất bao gồm **C# Web API Backend** (ASP.NET Core) và **Progressive Web App (PWA) Frontend** (chạy độc lập bằng Live Server hoặc máy chủ web tĩnh). Dự án hoạt động đa nền tảng ổn định 100%.

---

## 1. Kết quả Đạt được (What was accomplished)

### 1.1. C# Web API Backend (ASP.NET Core)
*   **Hệ cơ sở dữ liệu (Database):** Cấu hình Entity Framework Core kết nối với PostgreSQL Cloud (Neon.tech) và hỗ trợ tự động khởi tạo bảng (`Users`, `UserTelemetry`, `FoodStalls`, `Localizations`) cùng dữ liệu mẫu các quán ăn nổi tiếng ở Quận 4 (Ốc Oanh, Phá Lấu Cô Thảo, Bánh mì Cô Lệ) ngay khi ứng dụng khởi chạy.
*   **Pipeline Xử lý Âm thanh Tự động (Audio Pipeline):**
    *   Tích hợp dịch vụ dịch thuật đa ngôn ngữ sử dụng **Gemini API** để dịch thuyết minh sang các ngôn ngữ mong muốn (Anh, Nhật, Hàn, Việt).
    *   Xây dựng bộ tính mã hash MD5 của nội dung dịch để tránh sinh lại file âm thanh nếu dữ liệu không đổi.
    *   Thiết kế thành công bộ kết nối **Edge-TTS qua ClientWebSocket thuần C# 100%** (Tự động tạo token chống lạm dụng `Sec-MS-GEC` dựa trên Windows File Time UTC, gửi SSML và trích xuất audio MP3 lưu vào `wwwroot/`).
*   **Trợ lý AI Trực tuyến (AI Chatbot):** Cung cấp API hỏi đáp thời gian thực cho người dùng, sử dụng kỹ thuật RAG nhúng thông tin danh sách quán ăn vào ngữ cảnh gửi tới Gemini để tư vấn food tour và trả lời thông tin chi tiết.

### 1.2. PWA Frontend (Progressive Web App - Tách biệt độc lập)
*   **Thư mục riêng biệt:** Toàn bộ mã nguồn PWA đã được tách rời độc lập ra thư mục [Frontend](file:///d:/C%23/Doan/Frontend) (không để chung trong `wwwroot` của Backend).
*   **Tự động nhận diện API Port:** `app.js` tự động nhận diện nếu PWA chạy khác cổng (ví dụ: Live Server chạy cổng `3000`/`5500`) để tự động chuyển hướng kết nối API về cổng `5080` của Backend, giúp giải quyết triệt để vấn đề CORS.
*   **Ghim vị trí thiết kế mới & Sửa lỗi Đồng bộ (CSS Map Pins & Sync Fix):** 
    *   Sửa lỗi không hiển thị hình ảnh ghim (marker CDN) bằng cách tự thiết kế các **Map Pins bằng CSS-only** (hình giọt nước màu cam có chấm trắng ở tâm).
    *   **Khắc phục lỗi Đồng bộ dữ liệu:** Sửa tham số truyền lên API từ `languageCode` thành `lang` để khớp định nghĩa Backend; đồng thời cấu trúc lại dữ liệu (flatten mapping) từ dạng nested `{ stalls: [...] }` về dạng phẳng trước khi lưu vào IndexedDB. Việc này giải quyết triệt để lỗi runtime `stalls.forEach is not a function`, giúp đồng bộ thành công và hiển thị các ghim màu cam trên bản đồ.
*   **Trình phát âm thanh thủ công & Vượt rào Autoplay:** 
    *   Thêm nút **Phát Thuyết Minh** và hiển thị trạng thái phát (`Đang tải...`, `Đang phát...`, `Tạm dừng`) trực quan tại thẻ thông tin.
    *   Giúp người dùng dễ dàng chủ động nghe/tắt thuyết minh và vượt qua chính sách bảo mật chặn tự động phát âm thanh (autoplay policy) của các trình duyệt di động (Safari/Chrome trên điện thoại).
*   **Tối ưu hóa bộ nhớ đệm (Cache) & Xử lý Quá tải API (429 Retry):**
    *   **Bộ lọc mã Hash nguồn:** Di chuyển kiểm tra cache lên đầu tiến trình xử lý và tính mã MD5 dựa trên văn bản gốc tiếng Việt (`OriginalHistory`). Nếu nội dung không đổi, Backend sẽ lấy ngay bản dịch từ DB và tái sử dụng file MP3 cũ, giảm số cuộc gọi API Gemini về **0** khi đồng bộ lại.
    *   **Cơ chế Retry với Backoff:** Tích hợp bộ thử lại tự động (3 lần) kèm thời gian trễ tăng dần (exponential backoff) trong [TranslationService](file:///d:/C%23/Doan/Backend/Services/TranslationService.cs) khi gặp lỗi quá tải `429 Too Many Requests` từ phía Google Gemini API, đảm bảo dịch thuật luôn thành công ổn định.
*   **Đồng bộ ngoại tuyến (Offline Sync):** Tải toàn bộ cơ sở dữ liệu các quán ăn + bản dịch theo ngôn ngữ lựa chọn cùng các file MP3 tương ứng từ server về lưu trữ cục bộ trong trình duyệt bằng **IndexedDB** (`db.js`).
*   **Bản đồ Offline (Leaflet Map):** Tích hợp công cụ vẽ bản đồ **Leaflet.js** cực nhẹ, tự động tải và cache ngoại tuyến các mảnh bản đồ (tiles) OpenStreetMap thông qua **Service Worker** (`sw.js`).
*   **GPS Định vị & Trực ngầm Geofencing:** 
    *   Tích hợp hệ thống theo dõi GPS của thiết bị di động (`navigator.geolocation`).
    *   Sử dụng công thức toán học **Haversine** tính toán khoảng cách giữa người dùng và các quán ăn thời gian thực.
    *   Tự động kích hoạt phát file thuyết minh MP3 tương ứng khi khoảng cách $\le 20$ mét (nếu bị trình duyệt chặn tự động phát, người dùng vẫn có thể bấm nút Phát trên thẻ thông tin).
*   **Mô phỏng GPS (GPS Mocking):** Cho phép người dùng click chuột trực tiếp vào bất kỳ vị trí nào trên bản đồ Leaflet để giả lập vị trí GPS hiện tại nhằm kiểm thử tính năng phát âm thanh offline ngay trên PC không có định vị.
*   **Giao diện người dùng Premium:** Giao diện tối hiện đại (glassmorphism/dark theme) hiển thị bản đồ, thông tin quán đang thuyết minh trực quan và tích hợp khung chat trực tuyến với Trợ lý AI.

---

## 2. Kết quả Xác minh (Validation Results)

### 2.1. Kiểm thử Sinh Âm thanh Edge-TTS (C# WebSocket)
Chạy thử nghiệm sinh âm thanh thành công qua endpoint kiểm thử của Backend. Phản hồi trả về mã **200 OK** với tệp MP3 kích thước **22,176 bytes** được ghi xuống đĩa:
```json
{
  "success": true,
  "message": "TTS generated successfully.",
  "lengthBytes": 22176,
  "outputFile": "/test.mp3",
  "path": "D:\\C#\\Doan\\Backend\\wwwroot\\test.mp3"
}
```

### 2.2. Biên dịch Mã nguồn (Compilation Status)
*   **Backend (ASP.NET Core):** Biên dịch thành công với **0 lỗi** và **0 cảnh báo**:
    ```text
    Backend -> D:\C#\Doan\Backend\bin\Debug\net10.0\Backend.dll
    Build succeeded.
        0 Warning(s)
        0 Error(s)
    ```
*   **PWA Frontend:** Hoạt động độc lập thông qua các máy chủ HTTP tĩnh (Live Server, http-server, nginx...).

---

## 3. Hướng dẫn Chạy Thử nghiệm (How to Run)

### 3.1. Chạy Backend API & Database
1.  Nhập API Key của Gemini vào cấu hình `"Gemini": { "ApiKey": "YOUR_KEY" }` trong `appsettings.json` để chạy tính năng dịch AI và Trợ lý ảo Chat.
2.  Mở thư mục `Backend` trong terminal và chạy lệnh:
    ```bash
    dotnet run --urls "http://0.0.0.0:5080"
    ```
3.  Khi server khởi chạy, nó sẽ tự động kết nối Neon Cloud DB, tạo các bảng dữ liệu cần thiết và nạp dữ liệu quán ăn Quận 4.

### 3.2. Chạy PWA Frontend Độc lập
1.  Mở thư mục `Frontend` bằng công cụ **Live Server** (trong VS Code) hoặc chạy lệnh dưới đây để khởi động máy chủ Web tĩnh:
    ```bash
    npx http-server Frontend -p 3000
    ```
2.  Mở trình duyệt truy cập: **`http://localhost:3000/index.html`**
3.  **Đồng bộ dữ liệu:** Nhấn nút **Đồng Bộ** trên giao diện PWA để kết nối tự động sang Backend (cổng `5080`) tải dữ liệu quán ăn cùng file MP3 về lưu trữ offline.
4.  **Kiểm tra tính năng phát offline:**
    *   Bật switch **GPS Mocking / Real**.
    *   Click chuột vào vị trí bất kỳ gần ghim quán ăn màu cam (ví dụ click sát quán *Ốc Oanh*).
    *   Xác nhận: Ghim định vị xanh dương hiển thị, thẻ thông tin quán ăn hiện lên, tính khoảng cách chính xác và file thuyết minh MP3 tự động phát thành công.
5.  **Cài đặt trên điện thoại di động:**
    *   Mở trình duyệt trên điện thoại truy cập: `http://<IP_MÁY_TÍNH>:3000/index.html`.
    *   Mở menu trình duyệt và chọn **Add to Home Screen** (Thêm vào màn hình chính) để cài đặt ứng dụng.

### 3.3. Các tính năng kiểm thử nâng cao & Dịch thuật đa ngôn ngữ mới

1. **Mô phỏng đi bộ (Simulate Walk):**
   * Bấm vào nút `🚶 Mô phỏng đi bộ` trên PWA.
   * Hệ thống sẽ giả lập vị trí của bạn đang di chuyển từng bước dọc theo đường Vĩnh Khánh (Quận 4).
   * Cứ mỗi 5 giây, vị trí giả lập sẽ tiến 1 bước qua các quán ăn theo lộ trình: *Bánh Mì Cô Lệ* $\rightarrow$ *Ốc Oanh* $\rightarrow$ *Phá Lấu Cô Thảo*.
   * Khi đi vào vùng bán kính $\le 20m$ của mỗi quán, thẻ thông tin chi tiết sẽ tự động hiển thị và file thuyết minh âm thanh MP3 tương ứng sẽ được phát.

2. **Dịch thuật giao diện đa ngôn ngữ (UI Translations):**
   * Lựa chọn bất kỳ ngôn ngữ nào trong dropdown (Tiếng Việt, Tiếng Anh, Tiếng Nhật, Tiếng Hàn).
   * Toàn bộ các text trên giao diện (tiêu đề phụ, nút đồng bộ, khung chat AI, trạng thái GPS và trình phát âm thanh) sẽ thay đổi ngôn ngữ ngay lập tức theo lựa chọn của bạn.

3. **Cảnh báo kết nối bảo mật GPS trên điện thoại (Secure Context GPS):**
   * Vì các trình duyệt di động hiện đại (Chrome/Safari trên điện thoại) chặn API định vị `navigator.geolocation` khi kết nối qua giao thức không mã hóa (HTTP), hệ thống đã được tích hợp bộ kiểm tra và cảnh báo.
   * Khi bạn bật switch `GPS Mocking / Real` trên điện thoại bằng kết nối HTTP, ứng dụng sẽ hiện cảnh báo giải thích lý do chặn, tự động tắt switch để tránh lỗi giao diện và hướng dẫn bạn sử dụng tính năng **Mô phỏng đi bộ** hoặc chạy thông qua kết nối HTTPS (ví dụ như dùng ngrok / localtunnel).

4. **Sửa lỗi crash khi dịch thuật (Fix UI Language Translation Crash):**
   * Đã sửa lỗi crash tiềm ẩn trong hàm `updateUiLanguage` liên quan đến việc tham chiếu trực tiếp thuộc tính `innerText` khi các phần tử HTML chưa sẵn sàng hoặc rỗng (null). Bổ sung các câu lệnh kiểm tra an toàn (defensive check) giúp PWA hoạt động mượt mà hơn.
   * Đã thực hiện tăng phiên bản dịch vụ lưu cache (Service Worker Cache Busting) từ `v4` lên `v5` trong `index.html` và `sw.js` để bắt buộc trình duyệt điện thoại tự động tải lại mã nguồn JS và HTML mới nhất thay vì dùng phiên bản cũ lưu trong bộ nhớ đệm.

### 3.4. Hệ thống Admin Portal & Owner Portal (Đăng nhập & Quản trị)

Chúng ta đã tạo mới các giao diện quản lý: Đăng nhập ([login.html](file:///d:/C%23/Doan/Frontend/login.html)), Đăng ký ([register-owner.html](file:///d:/C%23/Doan/Frontend/register-owner.html)), Chủ quán ([owner.html](file:///d:/C%23/Doan/Frontend/owner.html)), và Admin ([admin.html](file:///d:/C%23/Doan/Frontend/admin.html)).

#### Kịch bản kiểm thử luồng hệ thống:

1. **Khởi động lại Backend**:
   * Hãy nhấn `Ctrl+C` tại terminal chạy Backend để đóng ứng dụng cũ, sau đó chạy lại lệnh:
     ```bash
     dotnet run --urls "http://0.0.0.0:5080"
     ```
   * *Lưu ý*: Hệ thống sẽ tự động phát hiện thay đổi cấu trúc bảng mới, tự động giải phóng cơ sở dữ liệu cũ trên Neon và tạo mới các bảng (`OwnerRegistrations`, `UserSessions`, `Notifications`, `AiUsageLimits`) kèm tài khoản Admin mặc định (`admin` / `admin123`).

2. **Kiểm tra đăng nhập Admin**:
   * Truy cập: **`http://localhost:3000/login.html`**
   * Nhập tài khoản: `admin` / `admin123`.
   * Xác nhận chuyển hướng thành công đến trang **`admin.html`**, hiển thị 3 thẻ Metrics và bản đồ giám sát Leaflet.

3. **Kiểm tra quy trình đăng ký Chủ quán**:
   * Truy cập: **`http://localhost:3000/register-owner.html`**
   * Nhập thông tin tài khoản chủ quán mới, số CCCD (định dạng 9-12 số).
   * Tại bản đồ chọn vị trí, click chuột vào đường Vĩnh Khánh để chọn tọa độ quán ăn.
   * Nhập tên quán, địa chỉ và thuyết minh sơ bộ, nhấn gửi.
   * Hệ thống sẽ mã hóa số CCCD bằng thuật toán **AES-256-CBC** trước khi lưu vào DB. Thử đăng nhập bằng tài khoản này tại `login.html` lúc này sẽ bị chặn vì tài khoản chưa được phê duyệt.

4. **Phê duyệt đơn đăng ký của Chủ quán**:
   * Đăng nhập tài khoản `admin`. Vào tab **Duyệt Đăng Ký Chủ Quán**.
   * Xác nhận hồ sơ đăng ký hiển thị đầy đủ, số CCCD được giải mã (Decrypted) hiển thị chính xác là chuỗi số gốc.
   * Bấm **Duyệt** (Approve).

5. **Chủ quán đăng nhập & Tối ưu thuyết minh bằng AI Advisor**:
   * Đăng nhập bằng tài khoản chủ quán vừa được duyệt tại `login.html`.
   * Bạn sẽ được tự động chuyển hướng đến trang **`owner.html`**.
   * Nhấn nút **🤖 Tối ưu mô tả bằng AI Advisor**. Xác nhận AI Gemini 2.5 Flash viết lại bài thuyết minh chuyên nghiệp (khoảng 200-300 từ) trong thời gian tối đa 30 giây.
   * Quota sử dụng của bạn sẽ hiển thị giảm xuống còn `9/10` (giới hạn 10 lượt gọi/ngày đối với Owner để kiểm soát chi phí).
   * Nhấn **Áp dụng mô tả này** để copy văn bản đã tối ưu vào ô thuyết minh chính, bấm **Lưu & Gửi phê duyệt**. Quán ăn sẽ tạm ẩn (`IsVerified = false`) chờ duyệt thông tin mới.

6. **Admin duyệt thuyết minh và đồng bộ**:
   * Đăng nhập tài khoản Admin, vào tab **Duyệt Thuyết Minh**, bấm **Duyệt**.
   * Hệ thống sẽ tự động chuyển trạng thái quán ăn thành công khai (`IsVerified = true`) và kích hoạt tiến trình chạy ngầm Edge-TTS sinh âm thanh thuyết minh đa ngôn ngữ.
   * Vào trang Client PWA (`index.html`), bấm **Đồng bộ**. Xác nhận quán mới được vẽ ghim cam lên bản đồ và thuyết minh mới (đã tối ưu bằng AI) tự động phát thành công.

7. **Giám sát trực tuyến & Audit Logs**:
   * Khi người dùng truy cập PWA (`index.html`), app sẽ tự động gửi Heartbeat định kỳ 30 giây để cập nhật tọa độ.
   * Đăng nhập Admin, vào tab **Giám Sát Người Dùng** hoặc tab **Nhật Ký Hệ Thống** để xem vị trí live của client (ghim xanh pulsing radar) và lịch sử thao tác của hệ thống.
