# Vĩnh Khánh Street Food Map & PWA Tour Guide

Dự án bản đồ và trợ lý tour ẩm thực đường phố tại con đường ẩm thực Vĩnh Khánh, Quận 4, TP.HCM. Ứng dụng hoạt động như một **Progressive Web App (PWA)**, hỗ trợ du khách định vị GPS, tự động phát âm thanh thuyết minh đa ngôn ngữ (TTS), chat hỏi đáp du lịch với AI Tour Guide, cùng cổng quản trị (Web Admin Dashboard) giám sát thời gian thực.

---

## 🚀 Tính Năng Chính

1. **Bản đồ Di sản Ẩm thực:** Bản đồ tương tác Leaflet.js hiển thị vị trí các quán ăn đặc trưng.
2. **Định vị & GPS Giả lập (GPS Mocking):** Tự động phát âm thuyết minh khi đi vào bán kính của quán. Cho phép chạy giả lập đi bộ ảo (Path walking simulation) để dễ dàng kiểm thử.
3. **Phát âm Thuyết minh Đa Ngôn Ngữ (TTS):** Tự động dịch thuyết minh sang tiếng Anh, Nhật, Hàn, Pháp, Trung bằng AI và chuyển thành giọng nói chuẩn bản xứ chất lượng cao.
4. **Trợ lý AI Tour Guide (RAG Chat):** Trò chuyện hỏi đáp về các quán ăn, gợi ý lịch trình đi bộ ăn uống dựa trên dữ liệu thật của các quán.
5. **Cổng thông tin Chủ quán (Owner Portal):**
   * Đăng ký tài khoản (mã hóa an toàn số định danh CCCD bằng AES-256).
   * Kéo thả ghim thay đổi vị trí quán ăn lưu động trên bản đồ.
   * Tích hợp trợ lý **AI Advisor** giúp tối ưu hóa văn bản thuyết minh thô thành nội dung hấp dẫn.
6. **Dashboard Quản trị (Admin Portal):**
   * Theo dõi trực quan biểu đồ, tổng số quán, số người dùng, số người online.
   * Bản đồ **Live User Tracking** cập nhật vị trí thời gian thực của toàn bộ du khách (30 giây/lần).
   * Duyệt đơn đăng ký của chủ quán mới và duyệt cập nhật thông tin thuyết minh quán.

---

## 🛠️ Công Nghệ Sử Dụng

* **Backend:** ASP.NET Core (C# .NET 10), Entity Framework Core.
* **Database:** PostgreSQL (Neon Serverless).
* **AI & Machine Learning:** Google Gemini 2.5 Flash / 2.0 Flash (Tối ưu hóa, RAG Chat, Dịch thuật), Edge-TTS (Chuyển văn bản thành giọng nói).
* **Frontend:** HTML5, CSS3 (Vanilla), JavaScript (ES6+), Leaflet.js Map API.
* **Bảo mật:** Băm mật khẩu PBKDF2 (SHA-256), mã hóa thông tin nhạy cảm (PII) bằng AES-256-CBC.

---

## 💻 Hướng Dẫn Chạy Dự Án (Local Development)

### 1. Yêu Cầu Hệ Thống
* Cài đặt [.NET 10.0 SDK](https://dotnet.microsoft.com/download/dotnet/10.0)
* Cài đặt [Node.js](https://nodejs.org/) (để chạy máy chủ frontend)

### 2. Thiết Lập Khóa Bảo Mật (Secrets)
Để tránh rò rỉ dữ liệu, các key thật được lưu trữ trong file `appsettings.Development.json` (tệp này được thiết lập bỏ qua bởi Git).

1. Truy cập thư mục `Backend/`
2. Tạo một file mới tên là **`appsettings.Development.json`** và sao chép nội dung cấu hình sau:

```json
{
  "ConnectionStrings": {
    "DefaultConnection": "Host=YOUR_POSTGRES_HOST; Database=YOUR_DB_NAME; Username=YOUR_DB_USER; Password=YOUR_DB_PASSWORD; SSL Mode=VerifyFull; Channel Binding=Require;"
  },
  "Gemini": {
    "ApiKey": "YOUR_GEMINI_API_KEY"
  },
  "VNPAY": {
    "Url": "YOUR_VNPAY_GATEWAY_URL",
    "TmnCode": "YOUR_VNPAY_TMN_CODE",
    "HashSecret": "YOUR_VNPAY_HASH_SECRET",
    "ReturnUrl": "http://localhost:5080/api/payments/return",
    "AmountVnd": 10000
  }
}
```

> 💡 *Thay thế `YOUR_POSTGRES_HOST`, `YOUR_DB_NAME`, `YOUR_DB_USER`, `YOUR_DB_PASSWORD` bằng thông tin database PostgreSQL của bạn, và nhập API key lấy từ [Google AI Studio](https://aistudio.google.com/) vào mục `ApiKey`.*
>
> 💡 *Chức năng thanh toán VNPAY cần các khóa `VNPAY:*` ở trên. `ReturnUrl` phải trỏ về backend, ví dụ `http://localhost:5080/api/payments/return`, để VNPAY có thể gọi lại sau khi thanh toán. Sau khi thanh toán thành công, trang kết quả sẽ có nút quay lại ứng dụng và tự động chuyển về trang chính sau vài giây. Nếu chạy local ở môi trường Development mà chưa cấu hình các khóa này, backend sẽ chuyển sang luồng thanh toán mô phỏng để bạn vẫn kiểm thử được ứng dụng; khi có cấu hình thật, hệ thống sẽ dùng VNPAY thật.*

### 3. Khởi Động Backend
Hệ thống tích hợp tính năng **Auto-Migration & Database Seeding**. Khi khởi chạy lần đầu tiên, hệ thống sẽ tự tạo cấu trúc bảng trên database PostgreSQL và nạp sẵn tài khoản quản trị mặc định:
* **Tài khoản admin mặc định:** `admin` / mật khẩu: `admin123`

Mở Terminal tại thư mục `Backend/` và chạy lệnh:
```bash
cd App_Thuyet_Minh_Am_Thuc/Backend
dotnet run --urls "http://0.0.0.0:5080"
```
*Backend sẽ lắng nghe tại cổng `http://localhost:5080`.*

### 4. Regenerate toàn bộ bản dịch và thuyết minh
Nếu bạn muốn sinh lại toàn bộ bản dịch và audio cho mọi quán, gọi endpoint admin sau:

```bash
POST http://localhost:5080/api/admin/localizations/generate-all
```

Yêu cầu header:
* `Authorization: Bearer <admin-token>`

Ví dụ sử dụng PowerShell:
```powershell
cd App_Thuyet_Minh_Am_Thuc/Backend
.\generate-all-localizations.ps1 -AdminToken "<admin-token>"
```

Hoặc dùng curl:
```bash
curl -X POST "http://localhost:5080/api/admin/localizations/generate-all" \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d "{}"
```

### 5. Khởi Động Frontend
Mở một cửa sổ Terminal mới tại thư mục `Frontend/` và chạy lệnh để mở server static:
```bash
cd App_Thuyet_Minh_Am_Thuc/Frontend
npx http-server -p 3000
```
*Frontend sẽ chạy tại cổng `http://localhost:3000`.*

---

## 📂 Cấu Trúc Dự Án Chính

```text
Doan/
├── Backend/                    # Mã nguồn C# ASP.NET Core API
│   ├── Controllers/            # API Endpoints (Admin, Owner, AI, Chat, Auth)
│   ├── Data/                   # Cấu hình EF Core DbContext & Migrations
│   ├── Models/                 # Các thực thể cơ sở dữ liệu (Entities)
│   ├── Services/               # Tiện ích mã hóa, dịch thuật, tạo audio thuyết minh
│   ├── appsettings.json        # File cấu hình chung (mẫu)
│   └── appsettings.Development.json  # File cấu hình local (Đã bị ẩn khỏi Git)
│
├── Frontend/                   # Mã nguồn tĩnh ứng dụng khách (PWA)
│   ├── index.html / app.js     # Trang chủ tương tác bản đồ, GPS giả lập, chat AI cho du khách
│   ├── owner.html / owner.js   # Cổng quản lý thông tin & tối ưu mô tả bằng AI cho Chủ quán
│   ├── admin.html / admin.js   # Dashboard phân tích, duyệt đơn & bản đồ Live tracking cho Admin
│   ├── login.html / register-owner.html # Trang định danh, đăng ký
│   └── sw.js                   # Service Worker phục vụ chế độ chạy ngoại tuyến (Offline)
│
└── .gitignore                  # Chỉ định các file/thư mục không đưa lên GitHub
```

---

## 🔒 Lưu Ý Bảo Mật & Đóng Góp

* **Bảo mật Git:** Tuyệt đối không xóa `.gitignore` hoặc cố ý chỉnh sửa file `appsettings.json` gốc để ghi đè mật khẩu/API Key thật lên GitHub.
* **Cấu hình môi trường Production:** Khi đưa dự án lên server hosting (như Docker, Render, Heroku, Azure), khuyến khích thay thế file config bằng cách truyền trực tiếp các biến môi trường (Environment Variables) tương ứng:
  * `ConnectionStrings__DefaultConnection`
  * `Gemini__ApiKey`
