using System;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
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
    public class OwnerController : ControllerBase
    {
        private readonly AppDbContext _dbContext;
        private readonly IAudioGenerationPipeline _audioPipeline;
        private readonly IServiceScopeFactory _scopeFactory;

        public OwnerController(AppDbContext dbContext, IAudioGenerationPipeline audioPipeline, IServiceScopeFactory scopeFactory)
        {
            _dbContext = dbContext;
            _audioPipeline = audioPipeline;
            _scopeFactory = scopeFactory;
        }

        // 1. GET Owner's Food Stalls
        [HttpGet("pois")]
        public async Task<IActionResult> GetMyStalls()
        {
            var owner = await GetOwnerUserAsync();
            if (owner == null) return Unauthorized("Stall Owner authorization required.");

            var stalls = await _dbContext.FoodStalls
                .Include(s => s.MenuImages)
                .Where(s => s.OwnerId == owner.Id)
                .Select(s => new
                {
                    s.Id,
                    s.Name,
                    s.Address,
                    s.Latitude,
                    s.Longitude,
                    s.OriginalHistory,
                    s.IsVerified,
                    s.AdminNote,
                    s.OwnerId,
                    MenuImages = s.MenuImages.Select(m => new { m.Id, m.ImageUrl }).ToList()
                })
                .ToListAsync();

            return Ok(stalls);
        }

        // 2. PUT Update Owner's Stall (Requires Admin approval before showing on public PWA)
        [HttpPut("pois/{id}")]
        public async Task<IActionResult> UpdateStall(Guid id, [FromBody] FoodStall update)
        {
            var owner = await GetOwnerUserAsync();
            if (owner == null) return Unauthorized("Stall Owner authorization required.");

            var stall = await _dbContext.FoodStalls.FindAsync(id);
            if (stall == null) return NotFound("Stall not found.");

            // Verification check: owner owns this stall
            if (stall.OwnerId != owner.Id) return Unauthorized("Access denied. You do not own this stall.");

            stall.Name = update.Name;
            stall.Address = update.Address;
            stall.Latitude = update.Latitude;
            stall.Longitude = update.Longitude;
            stall.OriginalHistory = update.OriginalHistory;
            
            // Mark as unverified so admin must approve the new details/audio changes
            stall.IsVerified = false;
            stall.AdminNote = "Chờ Admin duyệt thuyết minh mới.";

            _dbContext.Entry(stall).State = EntityState.Modified;
            await _dbContext.SaveChangesAsync();

            // Log action in Telemetry for Audit
            _dbContext.UserTelemetries.Add(new UserTelemetry
            {
                Id = Guid.NewGuid(),
                UserId = owner.Id,
                Timestamp = DateTime.UtcNow,
                Latitude = update.Latitude,
                Longitude = update.Longitude,
                Action = $"UPDATE_POI_SUBMISSION: {update.Name}"
            });
            await _dbContext.SaveChangesAsync();

            // Auto-generate translations and TTS audio in background for all supported languages
            // so that Admin can listen and review them immediately
            _ = Task.Run(async () =>
            {
                var supportedLanguages = new[] { "vi", "en", "ko", "ja", "zh" };
                foreach (var lang in supportedLanguages)
                {
                    try
                    {
                        using (var scope = _scopeFactory.CreateScope())
                        {
                            var pipeline = scope.ServiceProvider.GetRequiredService<IAudioGenerationPipeline>();
                            await pipeline.ProcessStallLocalizationAsync(stall.Id, lang);
                        }
                    }
                    catch (Exception)
                    {
                        // Ignore thread crash
                    }
                }
            });

            return Ok(new { success = true, message = "Cập nhật thành công. Đang chờ Admin phê duyệt để hiển thị lên bản đồ.", stall });
        }

        // 3. GET Owner's Notifications
        [HttpGet("notifications")]
        public async Task<IActionResult> GetNotifications()
        {
            var owner = await GetOwnerUserAsync();
            if (owner == null) return Unauthorized("Stall Owner authorization required.");

            var list = await _dbContext.Notifications
                .Where(n => n.UserId == owner.Id)
                .OrderByDescending(n => n.CreatedAt)
                .ToListAsync();

            // Mark notifications as read after fetching
            if (list.Any(n => !n.IsRead))
            {
                foreach (var item in list.Where(n => !n.IsRead))
                {
                    item.IsRead = true;
                    _dbContext.Entry(item).State = EntityState.Modified;
                }
                await _dbContext.SaveChangesAsync();
            }

            return Ok(list);
        }

        // 4. POST Owner's Stall Menu Image
        [HttpPost("pois/{id}/menu")]
        public async Task<IActionResult> UploadMenuImage(Guid id, IFormFile file)
        {
            var owner = await GetOwnerUserAsync();
            if (owner == null) return Unauthorized("Stall Owner authorization required.");

            var stall = await _dbContext.FoodStalls.FindAsync(id);
            if (stall == null) return NotFound("Stall not found.");

            if (stall.OwnerId != owner.Id) return Unauthorized("Access denied. You do not own this stall.");

            if (file == null || file.Length == 0) return BadRequest("No file uploaded.");

            // Basic validation
            var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
            if (ext != ".jpg" && ext != ".jpeg" && ext != ".png" && ext != ".webp")
            {
                return BadRequest("Invalid file type. Only JPG, PNG, WEBP are allowed.");
            }

            // Save file
            var directoryPath = Path.Combine(Directory.GetCurrentDirectory(), "wwwroot", "images", "menus");
            if (!Directory.Exists(directoryPath))
            {
                Directory.CreateDirectory(directoryPath);
            }

            var fileName = $"{Guid.NewGuid()}{ext}";
            var filePath = Path.Combine(directoryPath, fileName);

            using (var stream = new FileStream(filePath, FileMode.Create))
            {
                await file.CopyToAsync(stream);
            }

            // Save to DB
            var menuImage = new StallMenuImage
            {
                FoodStallId = stall.Id,
                ImageUrl = $"/menus/{fileName}", // Save relative to /images/
                CreatedAt = DateTime.UtcNow
            };

            _dbContext.StallMenuImages.Add(menuImage);
            await _dbContext.SaveChangesAsync();

            return Ok(new { 
                success = true, 
                menuImage = new { Id = menuImage.Id, ImageUrl = menuImage.ImageUrl } 
            });
        }

        // 5. DELETE Owner's Stall Menu Image
        [HttpDelete("pois/{id}/menu/{imageId}")]
        public async Task<IActionResult> DeleteMenuImage(Guid id, Guid imageId)
        {
            var owner = await GetOwnerUserAsync();
            if (owner == null) return Unauthorized("Stall Owner authorization required.");

            var stall = await _dbContext.FoodStalls.FindAsync(id);
            if (stall == null) return NotFound("Stall not found.");

            if (stall.OwnerId != owner.Id) return Unauthorized("Access denied. You do not own this stall.");

            var menuImage = await _dbContext.StallMenuImages.FirstOrDefaultAsync(m => m.Id == imageId && m.FoodStallId == id);
            if (menuImage == null) return NotFound("Menu image not found.");

            // Remove from DB
            _dbContext.StallMenuImages.Remove(menuImage);
            await _dbContext.SaveChangesAsync();

            // Try to remove the actual file
            try
            {
                var relativePath = menuImage.ImageUrl.TrimStart('/');
                // In MenuController, it adds /images/ before it if it doesn't start with http
                // Actually MenuController does: trimmed = trimmed.TrimStart('/', '\\'); return $"{baseUrl}/images/{trimmed}";
                // So ImageUrl is "menus/xxx.jpg" or "/menus/xxx.jpg"
                
                if (relativePath.StartsWith("menus/"))
                {
                    var filePath = Path.Combine(Directory.GetCurrentDirectory(), "wwwroot", "images", relativePath);
                    if (System.IO.File.Exists(filePath))
                    {
                        System.IO.File.Delete(filePath);
                    }
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error deleting image file: {ex.Message}");
            }

            return Ok(new { success = true, message = "Image deleted successfully." });
        }

        public class UpdateProfileRequest
        {
            public string FullName { get; set; } = string.Empty;
            public string PhoneNumber { get; set; } = string.Empty;
            public string Email { get; set; } = string.Empty;
        }

        // 6. PUT Update Owner Profile (Requires Admin approval)
        [HttpPut("profile")]
        public async Task<IActionResult> UpdateProfile([FromBody] UpdateProfileRequest request)
        {
            var owner = await GetOwnerUserAsync();
            if (owner == null) return Unauthorized("Stall Owner authorization required.");

            var pendingChange = await _dbContext.PendingUserProfileChanges.FirstOrDefaultAsync(p => p.UserId == owner.Id);
            if (pendingChange == null)
            {
                pendingChange = new PendingUserProfileChange
                {
                    Id = Guid.NewGuid(),
                    UserId = owner.Id,
                    FullName = request.FullName,
                    PhoneNumber = request.PhoneNumber,
                    Email = request.Email,
                    CreatedAt = DateTime.UtcNow
                };
                _dbContext.PendingUserProfileChanges.Add(pendingChange);
            }
            else
            {
                pendingChange.FullName = request.FullName;
                pendingChange.PhoneNumber = request.PhoneNumber;
                pendingChange.Email = request.Email;
                pendingChange.CreatedAt = DateTime.UtcNow;
                _dbContext.Entry(pendingChange).State = EntityState.Modified;
            }

            _dbContext.UserTelemetries.Add(new UserTelemetry
            {
                Id = Guid.NewGuid(),
                UserId = owner.Id,
                Timestamp = DateTime.UtcNow,
                Latitude = 10.760124,
                Longitude = 106.702958,
                Action = $"UPDATE_PROFILE_SUBMISSION: {request.FullName}"
            });

            await _dbContext.SaveChangesAsync();
            return Ok(new { success = true, message = "Cập nhật thông tin cá nhân thành công. Đang chờ Admin phê duyệt." });
        }

        private async Task<User?> GetOwnerUserAsync()
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
            if (user?.Role != "Owner")
                return null;

            return user;
        }
    }
}
