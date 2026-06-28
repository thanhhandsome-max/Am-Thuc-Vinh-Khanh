using System.Security.Cryptography;
using System.Text;
using Backend.Data;
using Backend.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Backend.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class PaymentsController : ControllerBase
    {
        private readonly AppDbContext _dbContext;
        private readonly IConfiguration _configuration;
        private readonly IHostEnvironment _environment;

        public PaymentsController(AppDbContext dbContext, IConfiguration configuration, IHostEnvironment environment)
        {
            _dbContext = dbContext;
            _configuration = configuration;
            _environment = environment;
        }

        [HttpGet("status")]
        public async Task<IActionResult> Status()
        {
            var user = await GetCurrentUserAsync();
            if (user == null)
            {
                return Unauthorized("Không tìm thấy phiên đăng nhập hợp lệ.");
            }

            return Ok(new
            {
                userId = user.Id,
                username = user.Username,
                role = user.Role,
                hasPaidAccess = HasPaidAccess(user),
                requiresPayment = RequiresPayment(user),
                paymentAmountVnd = GetPaymentAmountVnd()
            });
        }

        [HttpPost("create")]
        public async Task<IActionResult> CreatePaymentUrl([FromQuery] string? returnUrl = null)
        {
            var user = await GetCurrentUserAsync();
            if (user == null)
            {
                return Unauthorized("Không tìm thấy phiên đăng nhập hợp lệ.");
            }

            if (!RequiresPayment(user))
            {
                return Ok(new
                {
                    requiresPayment = false,
                    hasPaidAccess = true,
                    paymentUrl = string.Empty,
                    paymentAmountVnd = GetPaymentAmountVnd()
                });
            }

            try
            {
                var paymentAmountVnd = GetPaymentAmountVnd();
                var paymentUrl = BuildPaymentUrl(user, paymentAmountVnd, returnUrl);
                return Ok(new
                {
                    requiresPayment = true,
                    hasPaidAccess = false,
                    paymentAmountVnd,
                    paymentUrl
                });
            }
            catch (InvalidOperationException ex)
            {
                if (_environment.IsDevelopment())
                {
                    return Ok(new
                    {
                        requiresPayment = true,
                        hasPaidAccess = false,
                        paymentAmountVnd = GetPaymentAmountVnd(),
                        paymentUrl = BuildMockPaymentUrl(user)
                    });
                }

                return StatusCode(StatusCodes.Status503ServiceUnavailable, ex.Message);
            }
        }

        [HttpGet("mock-complete")]
        public async Task<IActionResult> MockComplete([FromQuery] string token)
        {
            if (!_environment.IsDevelopment())
            {
                return NotFound();
            }

            if (string.IsNullOrWhiteSpace(token))
            {
                return BadRequest("Thiếu mã phiên thanh toán mô phỏng.");
            }

            var session = await _dbContext.UserSessions
                .FirstOrDefaultAsync(s => s.Token == token && s.ExpiresAt > DateTime.UtcNow);

            if (session == null)
            {
                return Unauthorized("Phiên đăng nhập không hợp lệ.");
            }

            var user = await _dbContext.Users.FirstOrDefaultAsync(x => x.Id == session.UserId);
            if (user == null)
            {
                return Unauthorized("Không tìm thấy người dùng.");
            }

            user.HasPaidAccess = true;
            user.PaymentActivatedAt = DateTime.UtcNow;
            await _dbContext.SaveChangesAsync();

            return Content(BuildHtmlResponse(
                "Thanh toán mô phỏng thành công. Bạn có thể quay lại ứng dụng để dùng các chức năng.",
                GetAppReturnUrl()),
                "text/html; charset=utf-8");
        }

        [HttpGet("return")]
        public async Task<IActionResult> Return([FromQuery] string? clientReturnUrl = null)
        {
            var query = Request.Query;
            var isSignatureValid = VerifySignature(query);
            if (!isSignatureValid)
            {
                return Content(BuildHtmlResponse("Xác thực giao dịch thất bại. Chữ ký không hợp lệ."), "text/html; charset=utf-8");
            }

            var responseCode = query["vnp_ResponseCode"].ToString();
            var transactionStatus = query["vnp_TransactionStatus"].ToString();
            var txnRef = query["vnp_TxnRef"].ToString();

            var userId = ExtractUserId(txnRef);
            if (userId != Guid.Empty)
            {
                var user = await _dbContext.Users.FirstOrDefaultAsync(x => x.Id == userId);
                if (user != null && responseCode == "00" && transactionStatus == "00")
                {
                    user.HasPaidAccess = true;
                    user.PaymentActivatedAt = DateTime.UtcNow;
                    await _dbContext.SaveChangesAsync();
                }
            }

            var success = responseCode == "00" && transactionStatus == "00";
            var redirectUrl = !string.IsNullOrWhiteSpace(clientReturnUrl) ? clientReturnUrl : GetAppReturnUrl();

            // Always redirect back to the frontend.
            // We append the VNPAY response code so the frontend can optionally show a toast if it wants.
            if (redirectUrl.Contains("?"))
            {
                redirectUrl += $"&vnp_ResponseCode={responseCode}";
            }
            else
            {
                redirectUrl += $"?vnp_ResponseCode={responseCode}";
            }

            return Redirect(redirectUrl);
        }

        private async Task<User?> GetCurrentUserAsync()
        {
            var token = GetAccessTokenFromRequest();
            if (string.IsNullOrWhiteSpace(token))
            {
                return null;
            }

            var session = await _dbContext.UserSessions
                .FirstOrDefaultAsync(s => s.Token == token && s.ExpiresAt > DateTime.UtcNow);

            if (session == null)
            {
                return null;
            }

            return await _dbContext.Users.FirstOrDefaultAsync(u => u.Id == session.UserId);
        }

        private string GetAccessTokenFromRequest()
        {
            var authorizationHeader = Request.Headers["Authorization"].ToString();
            if (!string.IsNullOrWhiteSpace(authorizationHeader) && authorizationHeader.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
            {
                return authorizationHeader[7..].Trim();
            }

            if (Request.Headers.TryGetValue("X-Auth-Token", out var tokenHeader))
            {
                return tokenHeader.ToString().Trim();
            }

            return string.Empty;
        }

        private bool HasPaidAccess(User user)
        {
            return user.Role == "Admin" || user.Role == "Owner" || user.HasPaidAccess;
        }

        private bool RequiresPayment(User user)
        {
            return user.Role == "Public" && !user.HasPaidAccess;
        }

        private int GetPaymentAmountVnd()
        {
            var amount = _configuration.GetValue<int?>("VNPAY_AMOUNT_VND")
                ?? _configuration.GetValue<int?>("Vnpay:AmountVnd")
                ?? 10000;

            return Math.Max(1000, amount);
        }

        private string BuildPaymentUrl(User user, int amountVnd, string? clientReturnUrl = null)
        {
            var baseUrl = GetRequiredSetting("VNPAY_URL", "Vnpay:Url");
            var tmnCode = GetRequiredSetting("VNPAY_TMN_CODE", "Vnpay:TmnCode");
            var hashSecret = GetRequiredSetting("VNPAY_HASH_SECRET", "Vnpay:HashSecret");
            var returnUrl = _configuration["VNPAY_RETURN_URL"]
                ?? _configuration["Vnpay:ReturnUrl"]
                ?? $"{Request.Scheme}://{Request.Host}/api/payments/return";

            if (!string.IsNullOrWhiteSpace(clientReturnUrl))
            {
                returnUrl = returnUrl + (returnUrl.Contains("?") ? "&" : "?") + "clientReturnUrl=" + System.Net.WebUtility.UrlEncode(clientReturnUrl);
            }

            var txnRef = $"{user.Id:N}{DateTime.UtcNow:yyyyMMddHHmmss}";
            var ipAddress = GetClientIpAddress();
            var createDate = DateTime.UtcNow.ToString("yyyyMMddHHmmss");

            var parameters = new SortedDictionary<string, string>(StringComparer.Ordinal)
            {
                ["vnp_Amount"] = (amountVnd * 100).ToString(),
                ["vnp_Command"] = "pay",
                ["vnp_CreateDate"] = createDate,
                ["vnp_CurrCode"] = "VND",
                ["vnp_IpAddr"] = ipAddress,
                ["vnp_Locale"] = "vn",
                ["vnp_OrderInfo"] = $"Mo khoa truy cap ung dung cho {user.Username}",
                ["vnp_OrderType"] = "other",
                ["vnp_ReturnUrl"] = returnUrl,
                ["vnp_TmnCode"] = tmnCode,
                ["vnp_TxnRef"] = txnRef,
                ["vnp_Version"] = "2.1.0"
            };

            var queryString = BuildQueryString(parameters);
            var secureHash = BuildSecureHash(queryString, hashSecret);
            return $"{baseUrl}?{queryString}&vnp_SecureHash={secureHash}";
        }

        private string BuildMockPaymentUrl(User user)
        {
            var token = System.Net.WebUtility.UrlEncode(GetAccessTokenFromRequest());
            return $"{Request.Scheme}://{Request.Host}/api/payments/mock-complete?token={token}";
        }

        private string GetAppReturnUrl()
        {
            var configuredUrl = _configuration["VNPAY_APP_URL"]
                ?? _configuration["Vnpay:AppUrl"];

            if (!string.IsNullOrWhiteSpace(configuredUrl))
            {
                return configuredUrl;
            }

            if (Request != null && Request.Host.HasValue)
            {
                var scheme = Request.Scheme;
                var host = Request.Host.Host;
                return $"{scheme}://{host}:3000/";
            }

            return "http://localhost:3000/";
        }

        private bool VerifySignature(IQueryCollection query)
        {
            var hashSecret = GetRequiredSetting("VNPAY_HASH_SECRET", "Vnpay:HashSecret");
            var receivedHash = query["vnp_SecureHash"].ToString();

            var filteredParameters = new SortedDictionary<string, string>(StringComparer.Ordinal);
            foreach (var item in query)
            {
                if (!item.Key.StartsWith("vnp_", StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(item.Key, "vnp_SecureHash", StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(item.Key, "vnp_SecureHashType", StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                filteredParameters[item.Key] = item.Value.ToString();
            }

            var signData = BuildQueryString(filteredParameters);
            var computedHash = BuildSecureHash(signData, hashSecret);
            return string.Equals(receivedHash, computedHash, StringComparison.OrdinalIgnoreCase);
        }

        private string BuildQueryString(IDictionary<string, string> parameters)
        {
            var parts = new List<string>();
            foreach (var item in parameters)
            {
                parts.Add($"{System.Net.WebUtility.UrlEncode(item.Key)}={System.Net.WebUtility.UrlEncode(item.Value)}");
            }

            return string.Join("&", parts);
        }

        private string BuildSecureHash(string data, string secret)
        {
            using var hmac = new HMACSHA512(Encoding.UTF8.GetBytes(secret));
            var hash = hmac.ComputeHash(Encoding.UTF8.GetBytes(data));
            return Convert.ToHexString(hash).ToLowerInvariant();
        }

        private string GetRequiredSetting(string primaryKey, string fallbackKey)
        {
            var value = _configuration[primaryKey];
            if (!string.IsNullOrWhiteSpace(value))
            {
                return value.Trim();
            }

            value = _configuration[fallbackKey];
            if (!string.IsNullOrWhiteSpace(value))
            {
                return value.Trim();
            }

            throw new InvalidOperationException($"Missing payment configuration for {primaryKey}.");
        }

        private string GetClientIpAddress()
        {
            var forwardedFor = Request.Headers["X-Forwarded-For"].ToString();
            if (!string.IsNullOrWhiteSpace(forwardedFor))
            {
                return forwardedFor.Split(',')[0].Trim();
            }

            return HttpContext.Connection.RemoteIpAddress?.ToString() ?? "127.0.0.1";
        }

        private Guid ExtractUserId(string txnRef)
        {
            if (string.IsNullOrWhiteSpace(txnRef) || txnRef.Length < 32)
            {
                return Guid.Empty;
            }

            var userIdPart = txnRef[..32];
            return Guid.TryParseExact(userIdPart, "N", out var userId) ? userId : Guid.Empty;
        }

                private string BuildHtmlResponse(string message, string redirectUrl = "")
        {
            var encodedMessage = System.Net.WebUtility.HtmlEncode(message);
                        var hasRedirect = !string.IsNullOrWhiteSpace(redirectUrl);
                        var encodedRedirectUrl = System.Net.WebUtility.HtmlEncode(redirectUrl);

                        return "<!DOCTYPE html>" +
                                     "<html lang=\"vi\">" +
                                     "<head>" +
                                     "  <meta charset=\"utf-8\">" +
                                     "  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">" +
                                     "  <title>VNPAY Payment Result</title>" +
                                     "  <style>" +
                                     "    body { font-family: Arial, sans-serif; margin: 0; min-height: 100vh; display: grid; place-items: center; background: linear-gradient(135deg, #0f172a, #111827); color: #fff; }" +
                                     "    .card { max-width: 520px; width: calc(100% - 32px); background: rgba(17, 24, 39, 0.92); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; padding: 24px; box-shadow: 0 20px 60px rgba(0,0,0,0.35); }" +
                                     "    h1 { font-size: 22px; margin: 0 0 12px; }" +
                                     "    p { margin: 0 0 8px; line-height: 1.6; color: #d1d5db; }" +
                                     "    .actions { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 18px; }" +
                                     "    .btn { display: inline-flex; align-items: center; justify-content: center; border: none; border-radius: 10px; padding: 10px 16px; font-weight: 700; cursor: pointer; text-decoration: none; }" +
                                     "    .btn-primary { background: #f59e0b; color: #111827; }" +
                                     "    .btn-secondary { background: #334155; color: #fff; }" +
                                     "    .meta { margin-top: 12px; font-size: 13px; color: #94a3b8; }" +
                                     "  </style>" +
                                     "</head>" +
                                     "<body>" +
                                     "  <div class=\"card\">" +
                                     "    <h1>Kết quả thanh toán</h1>" +
                                     $"    <p>{encodedMessage}</p>" +
                                     (hasRedirect
                                             ? "    <div class=\"actions\">" +
                                                 $"      <a class=\"btn btn-primary\" href=\"{encodedRedirectUrl}\">Quay lại ứng dụng ngay</a>" +
                                                 "      <button class=\"btn btn-secondary\" id=\"return-now\" type=\"button\">Quay lại ứng dụng sau 3 giây</button>" +
                                                 "    </div>" +
                                                 $"    <div class=\"meta\">Tự động chuyển về ứng dụng sau 3 giây: {encodedRedirectUrl}</div>" +
                                                 $"    <script>const redirectUrl = {System.Text.Json.JsonSerializer.Serialize(redirectUrl)}; let seconds = 3; const button = document.getElementById('return-now'); const tick = () => {{ if (button) {{ button.textContent = 'Quay lại ứng dụng sau ' + seconds + ' giây'; }} if (seconds <= 0) {{ window.location.href = redirectUrl; return; }} seconds -= 1; setTimeout(tick, 1000); }}; if (button) {{ button.addEventListener('click', () => window.location.href = redirectUrl); }} tick();</script>"
                                             : "    <p>Bạn có thể quay lại ứng dụng và làm mới trang để mở khóa tính năng.</p>") +
                                     "  </div>" +
                                     "</body>" +
                                     "</html>";
        }
    }
}