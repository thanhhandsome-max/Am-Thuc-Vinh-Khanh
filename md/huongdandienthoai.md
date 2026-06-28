# Hướng dẫn Chạy Thử và Định vị GPS ứng dụng PWA trên Điện Thoại

Tài liệu này hướng dẫn chi tiết các bước để mở ứng dụng Web App (PWA) trên điện thoại di động cá nhân, cho phép sử dụng đầy đủ các tính năng định vị GPS thực tế, phát âm thuyết minh, và chat với trợ lý AI.

---

## ⚠️ Vấn Đề Bảo Mật Định Vị (Insecure Origin)
Các trình duyệt di động hiện đại (Safari trên iPhone, Chrome trên Android) quy định rất nghiêm ngặt: **Chỉ cho phép gọi định vị GPS thực tế (`navigator.geolocation`) qua giao thức bảo mật HTTPS**. 
* Nếu bạn truy cập bằng địa chỉ IP thường (dạng `http://192.168.1.x:3000`), nút bật GPS sẽ **bị khóa** và trình duyệt sẽ báo lỗi.
* **Giải pháp:** Chúng ta sẽ chạy song song một đường hầm HTTPS bằng **ngrok** (cho Frontend) và **localtunnel** (cho Backend) hoàn toàn miễn phí.

---

## 🛠️ Quy Trình 4 Bước Chạy Trên Điện Thoại

### Bước 1: Khởi động Backend và Frontend trên Máy tính
Đảm bảo dự án của bạn đang được chạy trên máy tính:
1. **Backend:** Chạy lệnh tại thư mục `Backend/`:
   ```bash
   dotnet run --urls "http://0.0.0.0:5080"
   ```
2. **Frontend:** Chạy lệnh tại thư mục `Frontend/`:
   ```bash
   npx http-server -p 3000
   ```

### Bước 2: Tạo Đường Hầm HTTPS
Mở 2 cửa sổ Terminal (hoặc Command Prompt) mới trên máy tính:

1. **Terminal 1 (Frontend):** Chạy ngrok để đưa giao diện Web lên cổng HTTPS an toàn:
   ```bash
   ngrok http 3000
   ```
   *Sao chép địa chỉ HTTPS ở dòng `Forwarding` (Ví dụ:* `https://obituary-ambulance-severity.ngrok-free.dev`*).*

2. **Terminal 2 (Backend):** Chạy localtunnel để đưa API cổng 5080 lên HTTPS:
   ```bash
   npx localtunnel --port 5080
   ```
   *Sao chép địa chỉ url được cấp (Ví dụ:* `https://evil-news-leave.loca.lt`*).*

### Bước 3: Mở Khóa Kết Nối Backend trên Điện thoại (Bắt buộc)
Do localtunnel có cơ chế ngăn chặn robot/spam, bạn cần xác thực thiết bị điện thoại của mình với máy chủ localtunnel trước:
1. Mở trình duyệt trên điện thoại của bạn.
2. Truy cập trực tiếp vào đường link **Backend localtunnel** bạn vừa lấy ở Bước 2 (Ví dụ: `https://evil-news-leave.loca.lt`).
3. Một trang web cảnh báo màu xanh của localtunnel sẽ xuất hiện:
   * Nếu có yêu cầu điền IP, bạn lấy địa chỉ **IP Public** của máy tính mình (vào trang [whatsmyip.org](https://www.whatsmyip.org/) trên máy tính để lấy) dán vào ô xác nhận.
   * Bấm nút **Click to access** hoặc **Visit Site** để xác nhận.
4. Khi trình duyệt chuyển hướng và hiển thị nội dung JSON hoặc màn hình trắng (không còn hiện trang cảnh báo nữa), bạn đã mở khóa kết nối thành công.

### Bước 4: Truy Cập Ứng Dụng
Sử dụng trình duyệt trên điện thoại, truy cập đường dẫn ghép nối theo cú pháp:
```text
[Link_Frontend_Ngrok]?server=[Link_Backend_Localtunnel]
```
* **Ví dụ thực tế:**
  `https://obituary-ambulance-severity.ngrok-free.dev?server=https://evil-news-leave.loca.lt`

---

## 🧭 Hướng Dẫn Sử Dụng Bản Đồ & GPS Trên Điện Thoại

### 1. Đồng bộ dữ liệu quán ăn
Sau khi mở web trên điện thoại thành công, bạn sẽ thấy bản đồ trống:
* Nhấn nút **`Đồng Bộ` (Sync)** ở góc trên màn hình.
* Khi hệ thống báo *"Đồng bộ thành công!"*, các ghim quán ăn màu cam sẽ hiển thị trên bản đồ.

### 2. Sử dụng định vị GPS thực tế
* Bật định vị GPS trên điện thoại của bạn.
* Bật công tắc **`GPS Mocking / Real`** trên giao diện ứng dụng.
* Một chấm tròn màu xanh lam phát sóng radar sẽ xuất hiện, biểu diễn vị trí đứng hiện tại của bạn.
* Khi bạn đi bộ đến gần một quán ăn vỉa hè (bán kính dưới 20 mét), điện thoại sẽ tự động rung, hiển thị thông tin quán ăn và **tự động phát giọng nói thuyết minh** giới thiệu về quán ăn đó bằng ngôn ngữ bạn đã chọn.

### 3. Sử dụng GPS Giả lập (Khi đang ngồi một chỗ để test)
Nếu bạn không muốn di chuyển ngoài đường Vĩnh Khánh để test:
* **Cách A (Click bản đồ):** Bạn có thể chạm ngón tay vào bất cứ điểm nào trên bản đồ, chấm định vị màu xanh lam của bạn sẽ tự động nhảy đến vị trí đó và kích hoạt thuyết minh nếu điểm chạm gần quán ăn.
* **Cách B (Mô phỏng đi bộ):** Nhấn nút **`🚶 Mô phỏng đi bộ` (Simulate Walk)** ở góc dưới màn hình. Hệ thống sẽ tự động điều khiển vị trí của bạn di chuyển dọc con phố Vĩnh Khánh và tự động phát thuyết minh khi đi ngang qua các quán ăn `Bánh Mì Cô Lệ`, `Ốc Oanh`, `Phá Lấu Cô Thảo`.

---

## 📲 Cài Đặt Ứng Dụng Chạy Ngoại Tuyến (PWA)

Ứng dụng của bạn hỗ trợ cơ chế PWA chạy offline và lưu trữ ngoại tuyến dữ liệu âm thanh thông qua Service Worker. Bạn có thể cài đặt nó lên màn hình chính điện thoại như một ứng dụng gốc:

* **Trên iPhone (Safari):** Bấm vào biểu tượng **Share (Chia sẻ)** ở dưới thanh công cụ trình duyệt -> Chọn **Add to Home Screen (Thêm vào màn hình chính)**.
* **Trên Android (Chrome):** Bấm vào biểu tượng **3 chấm đứng** ở góc trên bên phải -> Chọn **Add to Home Screen (Thêm vào màn hình chính)** hoặc **Cài đặt ứng dụng**.
