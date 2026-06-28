using System;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Backend.Data;
using Backend.Models;
using Backend.Services;

namespace Backend.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class AdminController : ControllerBase
    {
        private readonly AppDbContext _dbContext;
        private readonly IAudioGenerationPipeline _audioPipeline;
        private readonly IServiceScopeFactory _scopeFactory;
        private static readonly string[] SupportedLanguages = { "vi", "en", "ja", "ko", "zh" };
        private static readonly string[] StallVisitActions = { "LISTENED_STALL", "VISITED_STALL" };

        public AdminController(AppDbContext dbContext, IAudioGenerationPipeline audioPipeline, IServiceScopeFactory scopeFactory)
        {
            _dbContext = dbContext;
            _audioPipeline = audioPipeline;
            _scopeFactory = scopeFactory;
        }

        // 1. GET Dashboard Metrics
        [HttpGet("metrics")]
        public async Task<IActionResult> GetMetrics()
        {
            var admin = await GetAdminUserAsync();
            if (admin == null) return Unauthorized("Admin privileges required.");

            var totalStalls = await _dbContext.FoodStalls.CountAsync();
            var totalUsers = await _dbContext.Users.CountAsync(u => u.Role == "Public");
            
            // Active users are users whose LastActive is within the last 1 minutes
            var activeThreshold = DateTime.UtcNow.AddMinutes(-1);
            var activeUsersCount = await _dbContext.Users.CountAsync(u => u.LastActive >= activeThreshold);

            return Ok(new
            {
                totalStalls,
                totalUsers,
                activeUsers = activeUsersCount
            });
        }

        // 2. GET Owner Registrations (Pending or All)
        [HttpGet("registrations")]
        public async Task<IActionResult> GetRegistrations()
        {
            var admin = await GetAdminUserAsync();
            if (admin == null) return Unauthorized("Admin privileges required.");

            var regs = await _dbContext.OwnerRegistrations
                .Include(r => r.User)
                .OrderByDescending(r => r.CreatedAt)
                .ToListAsync();

            var result = regs.Select(r => new
            {
                r.Id,
                r.UserId,
                Username = r.User?.Username,
                r.FullName,
                Cccd = EncryptionHelper.DecryptCccd(r.CccdEncrypted), // Decrypt for admin review
                r.Status,
                r.CreatedAt,
                r.AdminNote
            });

            return Ok(result);
        }

        // 3. POST Approve Registration
        [HttpPost("registrations/{id}/approve")]
        public async Task<IActionResult> ApproveRegistration(Guid id, [FromBody] string adminNote)
        {
            var admin = await GetAdminUserAsync();
            if (admin == null) return Unauthorized("Admin privileges required.");

            var reg = await _dbContext.OwnerRegistrations.Include(r => r.User).FirstOrDefaultAsync(r => r.Id == id);
            if (reg == null) return NotFound("Registration not found.");

            reg.Status = "Approved";
            reg.AdminNote = adminNote;

            if (reg.User != null)
            {
                reg.User.IsVerified = true;
                reg.User.IsPoiOwnerVerified = true;

                // Copy profile info from registration
                reg.User.FullName = reg.FullName;
                reg.User.PhoneNumber = reg.PhoneNumber;
                reg.User.Email = reg.Email;
                reg.User.CccdEncrypted = reg.CccdEncrypted;

                _dbContext.Entry(reg.User).State = EntityState.Modified;
 
                 // Send a notification to the owner
                 _dbContext.Notifications.Add(new Notification
                 {
                     Id = Guid.NewGuid(),
                     UserId = reg.UserId,
                     Message = "Tài khoản chủ quán của bạn đã được Admin phê duyệt! Bạn hiện có thể đăng nhập để quản lý.",
                     CreatedAt = DateTime.UtcNow
                 });
            }

            // Also approve their registered stall automatically so it goes live initially
            var stall = await _dbContext.FoodStalls.FirstOrDefaultAsync(s => s.OwnerId == reg.UserId);
            if (stall != null)
            {
                stall.IsVerified = true;
                _dbContext.Entry(stall).State = EntityState.Modified;
            }

            await _dbContext.SaveChangesAsync();

            if (stall != null)
            {
                _ = Task.Run(async () =>
                {
                    foreach (var lang in SupportedLanguages)
                    {
                        try
                        {
                            using (var scope = _scopeFactory.CreateScope())
                            {
                                var pipeline = scope.ServiceProvider.GetRequiredService<IAudioGenerationPipeline>();
                                await pipeline.ProcessStallLocalizationAsync(stall.Id, lang, force: true);
                            }
                        }
                        catch (Exception)
                        {
                            // Ignore to avoid crashing the background thread
                        }
                    }
                });
            }

            return Ok(new { success = true, message = "Owner registration approved successfully." });
        }

        // 4. POST Reject Registration
        [HttpPost("registrations/{id}/reject")]
        public async Task<IActionResult> RejectRegistration(Guid id, [FromBody] string adminNote)
        {
            var admin = await GetAdminUserAsync();
            if (admin == null) return Unauthorized("Admin privileges required.");

            var reg = await _dbContext.OwnerRegistrations.FirstOrDefaultAsync(r => r.Id == id);
            if (reg == null) return NotFound("Registration not found.");

            reg.Status = "Rejected";
            reg.AdminNote = adminNote;

            await _dbContext.SaveChangesAsync();
            return Ok(new { success = true, message = "Owner registration rejected successfully." });
        }

        // 5. GET Unverified Submissions (Stalls and Owner profile updates waiting for approval)
        [HttpGet("submissions")]
        public async Task<IActionResult> GetSubmissions()
        {
            var admin = await GetAdminUserAsync();
            if (admin == null) return Unauthorized("Admin privileges required.");

            // 1. Pending Stalls
            var pendingStalls = await _dbContext.FoodStalls
                .Where(s => !s.IsVerified && s.OwnerId != null)
                .Select(s => new {
                    Type = "Stall",
                    Id = s.Id,
                    Name = s.Name,
                    Address = s.Address,
                    Latitude = s.Latitude,
                    Longitude = s.Longitude,
                    OriginalHistory = s.OriginalHistory,
                    AdminNote = s.AdminNote,
                    OwnerUsername = _dbContext.Users.Where(u => u.Id == s.OwnerId).Select(u => u.Username).FirstOrDefault() ?? "Chủ quán"
                })
                .ToListAsync();

            // 2. Pending Owner Profiles
            var pendingProfiles = await _dbContext.PendingUserProfileChanges
                .Select(u => new {
                    Type = "Profile",
                    Id = u.UserId,
                    Name = _dbContext.Users.Where(usr => usr.Id == u.UserId).Select(usr => usr.Username).FirstOrDefault() ?? "Chủ quán",
                    Address = $"Yêu cầu thay đổi thông tin: Họ tên ({u.FullName}), SĐT ({u.PhoneNumber}), Email ({u.Email})",
                    Latitude = 0.0,
                    Longitude = 0.0,
                    OriginalHistory = $"Thông tin hiện tại: Họ tên ({_dbContext.Users.Where(usr => usr.Id == u.UserId).Select(usr => usr.FullName).FirstOrDefault() ?? ""}), SĐT ({_dbContext.Users.Where(usr => usr.Id == u.UserId).Select(usr => usr.PhoneNumber).FirstOrDefault() ?? ""}), Email ({_dbContext.Users.Where(usr => usr.Id == u.UserId).Select(usr => usr.Email).FirstOrDefault() ?? ""})",
                    AdminNote = string.Empty,
                    OwnerUsername = _dbContext.Users.Where(usr => usr.Id == u.UserId).Select(usr => usr.Username).FirstOrDefault() ?? "Chủ quán"
                })
                .ToListAsync();

            var combined = pendingStalls.Cast<object>().Concat(pendingProfiles.Cast<object>()).ToList();
            return Ok(combined);
        }

        // 5a. POST Approve User Profile Submission
        [HttpPost("users/{id}/approve-profile")]
        public async Task<IActionResult> ApproveUserProfile(Guid id, [FromBody] string adminNote)
        {
            var admin = await GetAdminUserAsync();
            if (admin == null) return Unauthorized("Admin privileges required.");

            var user = await _dbContext.Users.FindAsync(id);
            if (user == null) return NotFound("User not found.");

            var pendingChange = await _dbContext.PendingUserProfileChanges.FirstOrDefaultAsync(p => p.UserId == id);
            if (pendingChange == null) return BadRequest("No pending profile change found.");

            // Apply changes
            user.FullName = pendingChange.FullName;
            user.PhoneNumber = pendingChange.PhoneNumber;
            user.Email = pendingChange.Email;

            _dbContext.Entry(user).State = EntityState.Modified;

            // Delete pending record
            _dbContext.PendingUserProfileChanges.Remove(pendingChange);

            // Send notification
            _dbContext.Notifications.Add(new Notification
            {
                Id = Guid.NewGuid(),
                UserId = user.Id,
                Message = $"Thông tin cá nhân mới của bạn đã được Admin phê duyệt thành công!",
                CreatedAt = DateTime.UtcNow
            });

            await _dbContext.SaveChangesAsync();
            return Ok(new { success = true, message = "Profile changes approved." });
        }

        // 5b. POST Reject User Profile Submission
        [HttpPost("users/{id}/reject-profile")]
        public async Task<IActionResult> RejectUserProfile(Guid id, [FromBody] string adminNote)
        {
            var admin = await GetAdminUserAsync();
            if (admin == null) return Unauthorized("Admin privileges required.");

            var user = await _dbContext.Users.FindAsync(id);
            if (user == null) return NotFound("User not found.");

            var pendingChange = await _dbContext.PendingUserProfileChanges.FirstOrDefaultAsync(p => p.UserId == id);
            if (pendingChange == null) return BadRequest("No pending profile change found.");

            // Delete pending record
            _dbContext.PendingUserProfileChanges.Remove(pendingChange);

            // Send notification
            _dbContext.Notifications.Add(new Notification
            {
                Id = Guid.NewGuid(),
                UserId = user.Id,
                Message = $"Yêu cầu thay đổi thông tin cá nhân của bạn bị từ chối. Lý do: {adminNote}",
                CreatedAt = DateTime.UtcNow
            });

            await _dbContext.SaveChangesAsync();
            return Ok(new { success = true, message = "Profile changes rejected." });
        }

        // 6. POST Generate translations and audio for all stalls
        [HttpPost("localizations/generate-all")]
        public async Task<IActionResult> GenerateAllLocalizations()
        {
            var admin = await GetAdminUserAsync();
            if (admin == null) return Unauthorized("Admin privileges required.");

            var stalls = await _dbContext.FoodStalls.ToListAsync();
            if (stalls.Count == 0)
            {
                return Ok(new { success = true, message = "No stalls found to generate localizations." });
            }

            _ = Task.Run(async () =>
            {
                foreach (var stall in stalls)
                {
                    foreach (var lang in SupportedLanguages)
                    {
                        try
                        {
                            using (var scope = _scopeFactory.CreateScope())
                            {
                                var pipeline = scope.ServiceProvider.GetRequiredService<IAudioGenerationPipeline>();
                                await pipeline.ProcessStallLocalizationAsync(stall.Id, lang);
                            }
                        }
                        catch
                        {
                            // Ignore individual failures to allow batch completion.
                        }
                    }
                }
            });

            return Ok(new
            {
                success = true,
                message = "Localization generation started for all stalls.",
                stallCount = stalls.Count,
                supportedLanguages = SupportedLanguages
            });
        }

        // 7. POST Approve Stall Submission
        [HttpPost("submissions/{id}/approve")]
        public async Task<IActionResult> ApproveSubmission(Guid id, [FromBody] string adminNote)
        {
            var admin = await GetAdminUserAsync();
            if (admin == null) return Unauthorized("Admin privileges required.");

            var stall = await _dbContext.FoodStalls.FindAsync(id);
            if (stall == null) return NotFound("Stall not found.");

            stall.IsVerified = true;
            stall.AdminNote = adminNote;
            _dbContext.Entry(stall).State = EntityState.Modified;

            if (stall.OwnerId != null)
            {
                _dbContext.Notifications.Add(new Notification
                {
                    Id = Guid.NewGuid(),
                    UserId = stall.OwnerId.Value,
                    Message = $"Thuyết minh quán ăn '{stall.Name}' của bạn đã được duyệt thành công và hiển thị trên bản đồ!",
                    CreatedAt = DateTime.UtcNow
                });
            }

            await _dbContext.SaveChangesAsync();

            // Re-generate translations and TTS audio in background for all supported languages (forced to ensure all languages are recreated)
            _ = Task.Run(async () =>
            {
                foreach (var lang in SupportedLanguages)
                {
                    try
                    {
                        using (var scope = _scopeFactory.CreateScope())
                        {
                            var pipeline = scope.ServiceProvider.GetRequiredService<IAudioGenerationPipeline>();
                            await pipeline.ProcessStallLocalizationAsync(stall.Id, lang, force: true);
                        }
                    }
                    catch (Exception)
                    {
                        // Ignore thread crash
                    }
                }
            });

            return Ok(new { success = true, message = "Stall submission approved successfully." });
        }

        // 7. POST Reject Stall Submission
        [HttpPost("submissions/{id}/reject")]
        public async Task<IActionResult> RejectSubmission(Guid id, [FromBody] string adminNote)
        {
            var admin = await GetAdminUserAsync();
            if (admin == null) return Unauthorized("Admin privileges required.");

            var stall = await _dbContext.FoodStalls.FindAsync(id);
            if (stall == null) return NotFound("Stall not found.");

            stall.AdminNote = adminNote;
            _dbContext.Entry(stall).State = EntityState.Modified;

            if (stall.OwnerId != null)
            {
                _dbContext.Notifications.Add(new Notification
                {
                    Id = Guid.NewGuid(),
                    UserId = stall.OwnerId.Value,
                    Message = $"Thuyết minh quán ăn '{stall.Name}' bị từ chối phê duyệt. Lý do: {adminNote}",
                    CreatedAt = DateTime.UtcNow
                });
            }

            await _dbContext.SaveChangesAsync();
            return Ok(new { success = true, message = "Stall submission rejected." });
        }

        // 8. GET Active Users Locations
        [HttpGet("active-users")]
        public async Task<IActionResult> GetActiveUsers()
        {
            var admin = await GetAdminUserAsync();
            if (admin == null) return Unauthorized("Admin privileges required.");

            var threshold = DateTime.UtcNow.AddMinutes(-1);
            
            // Get users who were active in last 1 minutes along with their last telemetry item
            var users = await _dbContext.Users
                .Where(u => u.LastActive >= threshold && u.Role != "Admin")
                .ToListAsync();

            var result = new System.Collections.Generic.List<object>();
            foreach (var user in users)
            {
                var lastTelemetry = await _dbContext.UserTelemetries
                    .Where(t => t.UserId == user.Id)
                    .OrderByDescending(t => t.Timestamp)
                    .FirstOrDefaultAsync();

                result.Add(new
                {
                    user.Id,
                    user.Username,
                    user.Role,
                    user.LastActive,
                    Latitude = lastTelemetry?.Latitude ?? 10.760124,
                    Longitude = lastTelemetry?.Longitude ?? 106.702958,
                    LastAction = lastTelemetry?.Action ?? "Online"
                });
            }

            return Ok(result);
        }

        // 9. GET Telemetry Audit Logs
        [HttpGet("telemetry")]
        public async Task<IActionResult> GetTelemetryLogs()
        {
            var admin = await GetAdminUserAsync();
            if (admin == null) return Unauthorized("Admin privileges required.");

            var logs = await _dbContext.UserTelemetries
                .Include(t => t.User)
                .OrderByDescending(t => t.Timestamp)
                .Take(100)
                .ToListAsync();

            var stallIds = logs
                .Select(t => ExtractStallIdFromAction(t.Action))
                .Where(id => id.HasValue)
                .Select(id => id.Value)
                .Distinct()
                .ToList();

            var stallMap = await _dbContext.FoodStalls
                .Where(s => stallIds.Contains(s.Id))
                .ToDictionaryAsync(s => s.Id, s => s.Name);

            var result = logs.Select(t => new
            {
                t.Id,
                Username = t.User?.Username ?? "Public User",
                Role = t.User?.Role ?? "Public",
                t.Timestamp,
                t.Latitude,
                t.Longitude,
                Action = SimplifyAction(t.Action),
                StallId = ExtractStallIdFromAction(t.Action),
                StallName = stallMap.TryGetValue(ExtractStallIdFromAction(t.Action) ?? Guid.Empty, out var name) ? name : null
            });

            return Ok(result);
        }

        // 10. GET Stall Visit Summary
        [HttpGet("visit-summary")]
        public async Task<IActionResult> GetStallVisitSummary()
        {
            var admin = await GetAdminUserAsync();
            if (admin == null) return Unauthorized("Admin privileges required.");

            var visits = await _dbContext.UserTelemetries
                .Where(t => StallVisitActions.Any(action => t.Action.StartsWith(action + ":")))
                .ToListAsync();

            var summary = visits
                .Select(t => new
                {
                    StallId = ExtractStallIdFromAction(t.Action),
                    ActionType = SimplifyAction(t.Action),
                    t.UserId,
                    t.Timestamp
                })
                .Where(x => x.StallId.HasValue)
                .GroupBy(x => x.StallId!.Value)
                .Select(g => new
                {
                    StallId = g.Key,
                    VisitCount = g.Count(),
                    UniqueVisitors = g.Select(x => x.UserId).Distinct().Count(),
                    LastVisit = g.Max(x => x.Timestamp),
                    ActionType = g.Select(x => x.ActionType).Distinct().FirstOrDefault() ?? "LISTENED_STALL"
                })
                .OrderByDescending(x => x.VisitCount)
                .Take(20)
                .ToList();

            var stalls = await _dbContext.FoodStalls
                .Where(s => summary.Select(x => x.StallId).Contains(s.Id))
                .ToDictionaryAsync(s => s.Id, s => s.Name);

            var result = summary.Select(x => new
            {
                x.StallId,
                StallName = stalls.TryGetValue(x.StallId, out var name) ? name : "Unknown",
                x.VisitCount,
                x.UniqueVisitors,
                x.LastVisit,
                x.ActionType
            });

            return Ok(result);
        }

        // 11. POST Update PWA Client Heartbeat/Telemetry
        [HttpPost("heartbeat")]
        public async Task<IActionResult> Heartbeat([FromBody] HeartbeatRequest request)
        {
            if (string.IsNullOrEmpty(request.DeviceUniqueId))
                return BadRequest("Device ID required.");

            var user = await _dbContext.Users.FirstOrDefaultAsync(u => u.DeviceUniqueId == request.DeviceUniqueId);
            if (user == null)
            {
                user = new User
                {
                    Id = Guid.NewGuid(),
                    DeviceUniqueId = request.DeviceUniqueId,
                    Username = "user_" + Guid.NewGuid().ToString("N").Substring(0, 8),
                    Role = "Public",
                    IsVerified = true,
                    LastActive = DateTime.UtcNow
                };
                _dbContext.Users.Add(user);
            }
            else
            {
                user.LastActive = DateTime.UtcNow;
                _dbContext.Entry(user).State = EntityState.Modified;
            }

            // Create minor heartbeat telemetry log
            var telemetry = new UserTelemetry
            {
                Id = Guid.NewGuid(),
                UserId = user.Id,
                Timestamp = DateTime.UtcNow,
                Latitude = request.Latitude ?? 10.760124,
                Longitude = request.Longitude ?? 106.702958,
                Action = BuildTelemetryAction(request.Action, request.StallId)
            };
            _dbContext.UserTelemetries.Add(telemetry);

            await _dbContext.SaveChangesAsync();
            return Ok(new { success = true });
        }

        private string BuildTelemetryAction(string? action, Guid? stallId)
        {
            var normalizedAction = string.IsNullOrWhiteSpace(action) ? "HEARTBEAT" : action.Trim().ToUpperInvariant();
            if (stallId.HasValue && StallVisitActions.Contains(normalizedAction))
            {
                return $"{normalizedAction}:{stallId.Value}";
            }
            return normalizedAction;
        }

        public class HeartbeatRequest
        {
            public string DeviceUniqueId { get; set; } = string.Empty;
            public double? Latitude { get; set; }
            public double? Longitude { get; set; }
            public string? Action { get; set; }
            public Guid? StallId { get; set; }
        }

        private Guid? ExtractStallIdFromAction(string action)
        {
            if (string.IsNullOrWhiteSpace(action))
                return null;

            var parts = action.Split(':', 2);
            if (parts.Length != 2) return null;

            return Guid.TryParse(parts[1], out var stallId) ? stallId : null;
        }

        private string SimplifyAction(string action)
        {
            if (string.IsNullOrWhiteSpace(action)) return "UNKNOWN";

            foreach (var prefix in StallVisitActions)
            {
                if (action.StartsWith(prefix + ":"))
                    return prefix;
            }

            return action;
        }
        // 12. GET All Users (Exclude Admin)
        [HttpGet("users")]
        public async Task<IActionResult> GetAllUsers()
        {
            var admin = await GetAdminUserAsync();
            if (admin == null) return Unauthorized("Admin privileges required.");

            var users = await _dbContext.Users
                .Where(u => u.Role == "Owner")
                .ToListAsync();

            var userIds = users.Select(u => u.Id).ToList();
            var stallsByOwner = await _dbContext.FoodStalls
                .Where(s => s.OwnerId != null && userIds.Contains(s.OwnerId.Value))
                .ToListAsync();

            var result = users.Select(u => new
            {
                u.Id,
                u.Username,
                u.Role,
                u.FullName,
                u.PhoneNumber,
                u.Email,
                u.HasPaidAccess,
                u.IsVerified,
                u.LastActive,
                u.IsActive,
                StallNames = stallsByOwner.Where(s => s.OwnerId == u.Id).Select(s => s.Name).ToList()
            }).ToList();

            return Ok(result);
        }

        // 12a. POST Toggle User Active Status
        [HttpPost("users/{id}/toggle-active")]
        public async Task<IActionResult> ToggleUserActive(Guid id)
        {
            var admin = await GetAdminUserAsync();
            if (admin == null) return Unauthorized("Admin privileges required.");

            var user = await _dbContext.Users.FindAsync(id);
            if (user == null) return NotFound("User not found.");

            user.IsActive = !user.IsActive;
            _dbContext.Entry(user).State = EntityState.Modified;

            // If deactivating user, also deactivate all owned stalls
            if (!user.IsActive)
            {
                var stalls = await _dbContext.FoodStalls.Where(s => s.OwnerId == id).ToListAsync();
                foreach (var stall in stalls)
                {
                    stall.IsActive = false;
                    _dbContext.Entry(stall).State = EntityState.Modified;
                }
            }

            await _dbContext.SaveChangesAsync();

            return Ok(new { success = true, isActive = user.IsActive });
        }

        // 13. DELETE User (Requires Admin and check Owner Stalls first)
        [HttpDelete("users/{id}")]
        public async Task<IActionResult> DeleteUser(Guid id)
        {
            var admin = await GetAdminUserAsync();
            if (admin == null) return Unauthorized("Admin privileges required.");

            var user = await _dbContext.Users.FindAsync(id);
            if (user == null) return NotFound("User not found.");

            // Constraint check: If Owner, check if they still have stalls
            if (user.Role == "Owner")
            {
                var ownerStalls = await _dbContext.FoodStalls
                    .Where(s => s.OwnerId == id)
                    .Select(s => s.Name)
                    .ToListAsync();
                if (ownerStalls.Any())
                {
                    var stallNamesString = string.Join(", ", ownerStalls);
                    return BadRequest($"Tài khoản này là Chủ quán của các cửa hàng đang tồn tại: {stallNamesString}. Vui lòng xóa các cửa hàng này trước khi xóa tài khoản chủ quán.");
                }
            }

            // Perform Cascade delete of user related records
            var sessions = await _dbContext.UserSessions.Where(s => s.UserId == id).ToListAsync();
            _dbContext.UserSessions.RemoveRange(sessions);

            var telemetries = await _dbContext.UserTelemetries.Where(t => t.UserId == id).ToListAsync();
            _dbContext.UserTelemetries.RemoveRange(telemetries);

            var notifications = await _dbContext.Notifications.Where(n => n.UserId == id).ToListAsync();
            _dbContext.Notifications.RemoveRange(notifications);

            var usageLimits = await _dbContext.AiUsageLimits.Where(l => l.UserId == id).ToListAsync();
            _dbContext.AiUsageLimits.RemoveRange(usageLimits);

            var registrations = await _dbContext.OwnerRegistrations.Where(r => r.UserId == id).ToListAsync();
            _dbContext.OwnerRegistrations.RemoveRange(registrations);

            var visits = await _dbContext.StallVisits.Where(v => v.UserId == id).ToListAsync();
            _dbContext.StallVisits.RemoveRange(visits);

            var transactions = await _dbContext.PaymentTransactions.Where(t => t.UserId == id).ToListAsync();
            _dbContext.PaymentTransactions.RemoveRange(transactions);

            _dbContext.Users.Remove(user);
            await _dbContext.SaveChangesAsync();

            return Ok(new { success = true, message = "User deleted successfully." });
        }

        // 14. GET All Stalls (With Owner Username)
        [HttpGet("stalls")]
        public async Task<IActionResult> GetAllStalls()
        {
            var admin = await GetAdminUserAsync();
            if (admin == null) return Unauthorized("Admin privileges required.");

            var stalls = await _dbContext.FoodStalls
                .Select(s => new
                {
                    s.Id,
                    s.Name,
                    s.Address,
                    s.Latitude,
                    s.Longitude,
                    s.IsVerified,
                    s.OwnerId,
                    s.IsActive,
                    OwnerUsername = _dbContext.Users.Where(u => u.Id == s.OwnerId).Select(u => u.Username).FirstOrDefault() ?? "Hệ thống"
                })
                .ToListAsync();

            return Ok(stalls);
        }

        // 14a. POST Toggle Stall Active Status
        [HttpPost("stalls/{id}/toggle-active")]
        public async Task<IActionResult> ToggleStallActive(Guid id)
        {
            var admin = await GetAdminUserAsync();
            if (admin == null) return Unauthorized("Admin privileges required.");

            var stall = await _dbContext.FoodStalls.FindAsync(id);
            if (stall == null) return NotFound("Stall not found.");

            stall.IsActive = !stall.IsActive;
            _dbContext.Entry(stall).State = EntityState.Modified;

            // Send notification to the owner if deactivated
            if (!stall.IsActive && stall.OwnerId != null)
            {
                _dbContext.Notifications.Add(new Notification
                {
                    Id = Guid.NewGuid(),
                    UserId = stall.OwnerId.Value,
                    Message = $"Cửa hàng '{stall.Name}' của bạn đã bị ngưng hoạt động.",
                    CreatedAt = DateTime.UtcNow
                });
            }

            await _dbContext.SaveChangesAsync();

            return Ok(new { success = true, isActive = stall.IsActive });
        }

        // 15. DELETE Stall
        [HttpDelete("stalls/{id}")]
        public async Task<IActionResult> DeleteStall(Guid id)
        {
            var admin = await GetAdminUserAsync();
            if (admin == null) return Unauthorized("Admin privileges required.");

            var stall = await _dbContext.FoodStalls.FindAsync(id);
            if (stall == null) return NotFound("Stall not found.");

            // Cascade delete stall related records
            var localizations = await _dbContext.Localizations.Where(l => l.FoodStallId == id).ToListAsync();
            _dbContext.Localizations.RemoveRange(localizations);

            var menuImages = await _dbContext.StallMenuImages.Where(m => m.FoodStallId == id).ToListAsync();
            _dbContext.StallMenuImages.RemoveRange(menuImages);

            var visits = await _dbContext.StallVisits.Where(v => v.FoodStallId == id).ToListAsync();
            _dbContext.StallVisits.RemoveRange(visits);

            _dbContext.FoodStalls.Remove(stall);
            await _dbContext.SaveChangesAsync();

            return Ok(new { success = true, message = "Stall deleted successfully." });
        }

        // 16. GET User Detail (Requires Admin, decrypts CCCD and lists owned stalls)
        [HttpGet("users/{id}/detail")]
        public async Task<IActionResult> GetUserDetail(Guid id)
        {
            var admin = await GetAdminUserAsync();
            if (admin == null) return Unauthorized("Admin privileges required.");

            var user = await _dbContext.Users.FindAsync(id);
            if (user == null) return NotFound("User not found.");

            // Get registration detail if any
            var reg = await _dbContext.OwnerRegistrations
                .FirstOrDefaultAsync(r => r.UserId == id);

            string? decryptedCccd = null;
            if (reg != null && !string.IsNullOrEmpty(reg.CccdEncrypted))
            {
                try
                {
                    decryptedCccd = EncryptionHelper.DecryptCccd(reg.CccdEncrypted);
                }
                catch (Exception)
                {
                    decryptedCccd = "[Lỗi giải mã CCCD]";
                }
            }

            // Get stalls owned by this user
            var stalls = await _dbContext.FoodStalls
                .Where(s => s.OwnerId == id)
                .Select(s => new
                {
                    s.Id,
                    s.Name,
                    s.Address,
                    s.IsVerified,
                    s.IsActive
                })
                .ToListAsync();

            var pendingProfile = await _dbContext.PendingUserProfileChanges
                .FirstOrDefaultAsync(p => p.UserId == id);

            return Ok(new
            {
                user.Id,
                user.Username,
                user.Role,
                user.FullName,
                user.PhoneNumber,
                user.Email,
                user.HasPaidAccess,
                user.IsVerified,
                user.LastActive,
                user.IsActive,
                pendingFullName = pendingProfile?.FullName,
                pendingPhoneNumber = pendingProfile?.PhoneNumber,
                pendingEmail = pendingProfile?.Email,
                isProfilePendingApproval = pendingProfile != null,
                Registration = reg == null ? null : new
                {
                    reg.Id,
                    Cccd = decryptedCccd,
                    reg.Status,
                    reg.CreatedAt,
                    reg.AdminNote
                },
                Stalls = stalls
            });
        }

        // 17. GET Stall Detail (Requires Admin, shows localizations and menu images)
        [HttpGet("stalls/{id}/detail")]
        public async Task<IActionResult> GetStallDetail(Guid id)
        {
            var admin = await GetAdminUserAsync();
            if (admin == null) return Unauthorized("Admin privileges required.");

            var stall = await _dbContext.FoodStalls.FindAsync(id);
            if (stall == null) return NotFound("Stall not found.");

            var ownerUsername = await _dbContext.Users
                .Where(u => u.Id == stall.OwnerId)
                .Select(u => u.Username)
                .FirstOrDefaultAsync() ?? "Hệ thống";

            var localizations = await _dbContext.Localizations
                .Where(l => l.FoodStallId == id)
                .Select(l => new
                {
                    l.Id,
                    l.LanguageCode,
                    l.AudioUrl,
                    l.TranslatedText
                })
                .ToListAsync();

            var menuImages = await _dbContext.StallMenuImages
                .Where(m => m.FoodStallId == id)
                .Select(m => new
                {
                    m.Id,
                    m.ImageUrl,
                    m.IsMainImage
                })
                .ToListAsync();

            return Ok(new
            {
                stall.Id,
                stall.Name,
                stall.Address,
                stall.Latitude,
                stall.Longitude,
                stall.OriginalHistory,
                stall.IsVerified,
                stall.IsActive,
                stall.AdminNote,
                OwnerUsername = ownerUsername,
                Localizations = localizations,
                MenuImages = menuImages
            });
        }

        private async Task<User?> GetAdminUserAsync()
        {
            var authHeader = Request.Headers["Authorization"].ToString();
            if (string.IsNullOrEmpty(authHeader) || !authHeader.StartsWith("Bearer "))
                return null;

            var token = authHeader.Substring("Bearer ".Length).Trim();
            var session = await _dbContext.UserSessions
                .FirstOrDefaultAsync(s => s.Token == token && s.ExpiresAt > DateTime.UtcNow);

            if (session == null)
                return null;

            var user = await _dbContext.Users.FirstOrDefaultAsync(u => u.Id == session.UserId);
            if (user?.Role != "Admin")
                return null;

            return user;
        }
    }
}
