using System;
using System.Linq;
using System.Security.Cryptography;
using System.Threading.Tasks;
using System.IO;
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
    public class AuthController : ControllerBase
    {
        private readonly AppDbContext _dbContext;
        private readonly IAudioGenerationPipeline _audioPipeline;
        private readonly IServiceScopeFactory _scopeFactory;

        public AuthController(AppDbContext dbContext, IAudioGenerationPipeline audioPipeline, IServiceScopeFactory scopeFactory)
        {
            _dbContext = dbContext;
            _audioPipeline = audioPipeline;
            _scopeFactory = scopeFactory;
        }

        public class RegisterOwnerRequest
        {
            public string Username { get; set; } = string.Empty;
            public string Password { get; set; } = string.Empty;
            public string FullName { get; set; } = string.Empty;
            public string Cccd { get; set; } = string.Empty; // Identity Card (PII)
            public string PhoneNumber { get; set; } = string.Empty;
            public string Email { get; set; } = string.Empty;
            public string StallName { get; set; } = string.Empty;
            public string StallAddress { get; set; } = string.Empty;
            public double Latitude { get; set; }
            public double Longitude { get; set; }
            public string Description { get; set; } = string.Empty;
            public List<IFormFile>? MenuImages { get; set; }
        }

        public class RegisterPublicRequest
        {
            public string Username { get; set; } = string.Empty;
            public string Password { get; set; } = string.Empty;
            public string FullName { get; set; } = string.Empty;
            public string PhoneNumber { get; set; } = string.Empty;
            public string Email { get; set; } = string.Empty;
        }

        [HttpPost("register-owner")]
        public async Task<IActionResult> RegisterOwner([FromForm] RegisterOwnerRequest request)
        {
            if (string.IsNullOrWhiteSpace(request.Username) || string.IsNullOrWhiteSpace(request.Password))
                return BadRequest("Username and Password are required.");

            if (string.IsNullOrWhiteSpace(request.Cccd) || request.Cccd.Length < 9)
                return BadRequest("Valid CCCD (Identity Card) is required.");

            // Check if username already exists
            if (await _dbContext.Users.AnyAsync(u => u.Username.ToLower() == request.Username.ToLower()))
                return BadRequest("Username is already taken.");

            using (var transaction = await _dbContext.Database.BeginTransactionAsync())
            {
                try
                {
                    // 1. Create Owner User (unverified)
                    EncryptionHelper.HashPassword(request.Password, out string hash, out string salt);
                    var user = new User
                    {
                        Id = Guid.NewGuid(),
                        Username = request.Username,
                        PasswordHash = hash,
                        PasswordSalt = salt,
                        Role = "Owner",
                        IsVerified = false, // Must be approved by Admin
                        DeviceUniqueId = "owner_" + Guid.NewGuid().ToString("N").Substring(0, 12),
                        LastActive = DateTime.UtcNow
                    };
                    _dbContext.Users.Add(user);

                    // 2. Create Owner Registration Record (cccd encrypted)
                    var cccdEncrypted = EncryptionHelper.EncryptCccd(request.Cccd);
                    var registration = new OwnerRegistration
                    {
                        Id = Guid.NewGuid(),
                        UserId = user.Id,
                        FullName = request.FullName,
                        PhoneNumber = request.PhoneNumber,
                        Email = request.Email,
                        CccdEncrypted = cccdEncrypted,
                        Status = "Pending",
                        CreatedAt = DateTime.UtcNow
                    };
                    _dbContext.OwnerRegistrations.Add(registration);

                    // 3. Create FoodStall (associated to owner, unverified)
                    var stall = new FoodStall
                    {
                        Id = Guid.NewGuid(),
                        Name = request.StallName,
                        Address = request.StallAddress,
                        Latitude = request.Latitude,
                        Longitude = request.Longitude,
                        OriginalHistory = request.Description,
                        OwnerId = user.Id,
                        IsVerified = false // Must be approved by Admin
                    };
                    _dbContext.FoodStalls.Add(stall);

                    // 4. Save Menu Images if provided
                    if (request.MenuImages != null && request.MenuImages.Count > 0)
                    {
                        var directoryPath = Path.Combine(Directory.GetCurrentDirectory(), "wwwroot", "images", "menus");
                        if (!Directory.Exists(directoryPath))
                        {
                            Directory.CreateDirectory(directoryPath);
                        }

                        foreach (var file in request.MenuImages)
                        {
                            if (file.Length > 0)
                            {
                                var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
                                if (ext == ".jpg" || ext == ".jpeg" || ext == ".png" || ext == ".webp")
                                {
                                    var fileName = $"{Guid.NewGuid()}{ext}";
                                    var filePath = Path.Combine(directoryPath, fileName);

                                    using (var stream = new FileStream(filePath, FileMode.Create))
                                    {
                                        await file.CopyToAsync(stream);
                                    }

                                    var menuImage = new StallMenuImage
                                    {
                                        FoodStallId = stall.Id,
                                        ImageUrl = $"/menus/{fileName}",
                                        CreatedAt = DateTime.UtcNow
                                    };
                                    _dbContext.StallMenuImages.Add(menuImage);
                                }
                            }
                        }
                    }

                    await _dbContext.SaveChangesAsync();
                    await transaction.CommitAsync();

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

                    return Ok(new { success = true, message = "Owner registration submitted successfully. Pending Admin approval." });
                }
                catch (Exception ex)
                {
                    await transaction.RollbackAsync();
                    return StatusCode(500, $"Internal server error: {ex.Message}");
                }
            }
        }

        [HttpPost("register-public")]
        public async Task<IActionResult> RegisterPublic([FromBody] RegisterPublicRequest request)
        {
            if (string.IsNullOrWhiteSpace(request.Username) || string.IsNullOrWhiteSpace(request.Password))
                return BadRequest("Username and Password are required.");

            if (await _dbContext.Users.AnyAsync(u => u.Username.ToLower() == request.Username.ToLower()))
                return BadRequest("Username is already taken.");

            EncryptionHelper.HashPassword(request.Password, out string hash, out string salt);

            var user = new User
            {
                Id = Guid.NewGuid(),
                Username = request.Username.Trim(),
                PasswordHash = hash,
                PasswordSalt = salt,
                Role = "Public",
                FullName = request.FullName.Trim(),
                PhoneNumber = request.PhoneNumber.Trim(),
                Email = request.Email.Trim(),
                IsVerified = true,
                IsPoiOwnerVerified = false,
                DeviceUniqueId = "public_" + Guid.NewGuid().ToString("N").Substring(0, 12),
                LastActive = DateTime.UtcNow
            };

            _dbContext.Users.Add(user);
            await _dbContext.SaveChangesAsync();

            return Ok(new { success = true, message = "Public user registered successfully." });
        }

        public class DeviceLoginRequest
        {
            public string DeviceId { get; set; } = string.Empty;
        }

        [HttpPost("device-login")]
        public async Task<IActionResult> DeviceLogin([FromBody] DeviceLoginRequest request)
        {
            if (string.IsNullOrWhiteSpace(request.DeviceId))
                return BadRequest("DeviceId is required.");

            // Avoid too long deviceIds
            var deviceId = request.DeviceId.Trim();
            if (deviceId.Length > 100)
                deviceId = deviceId.Substring(0, 100);

            var user = await _dbContext.Users.FirstOrDefaultAsync(u => u.DeviceUniqueId == deviceId);

            if (user == null)
            {
                // Auto create the user for this device
                user = new User
                {
                    Id = Guid.NewGuid(),
                    Username = "Device_" + Guid.NewGuid().ToString("N").Substring(0, 8),
                    DeviceUniqueId = deviceId,
                    Role = "Public",
                    IsVerified = true,
                    HasPaidAccess = false,
                    LastActive = DateTime.UtcNow
                };

                _dbContext.Users.Add(user);
                await _dbContext.SaveChangesAsync();
            }
            else
            {
                if (!user.IsActive)
                    return StatusCode(403, "Tài khoản của bạn đã bị ngưng hoạt động.");

                user.LastActive = DateTime.UtcNow;
                await _dbContext.SaveChangesAsync();
            }

            // Generate clean secure token session (24h validity)
            var tokenBytes = new byte[32];
            using (var rng = RandomNumberGenerator.Create())
            {
                rng.GetBytes(tokenBytes);
            }
            var token = Convert.ToHexString(tokenBytes);

            var session = new UserSession
            {
                Id = Guid.NewGuid(),
                UserId = user.Id,
                Token = token,
                ExpiresAt = DateTime.UtcNow.AddDays(1),
                CreatedAt = DateTime.UtcNow
            };

            _dbContext.UserSessions.Add(session);
            await _dbContext.SaveChangesAsync();

            return Ok(new
            {
                success = true,
                token = token,
                user = new
                {
                    user.Id,
                    user.Username,
                    user.Role,
                    user.FullName,
                    user.HasPaidAccess
                }
            });
        }

        public class LoginRequest
        {
            public string Username { get; set; } = string.Empty;
            public string Password { get; set; } = string.Empty;
        }

        [HttpPost("login")]
        public async Task<IActionResult> Login([FromBody] LoginRequest request)
        {
            var user = await _dbContext.Users.FirstOrDefaultAsync(u => u.Username.ToLower() == request.Username.ToLower());
            if (user == null)
                return Unauthorized("Invalid username or password.");

            if (!user.IsActive)
                return StatusCode(403, "Tài khoản của bạn đã bị ngưng hoạt động.");

            if (!EncryptionHelper.VerifyPassword(request.Password, user.PasswordHash, user.PasswordSalt))
                return Unauthorized("Invalid username or password.");

            if (!user.IsVerified)
                return Unauthorized("Your account is pending admin approval.");

            // Generate clean secure token session (24h validity)
            var tokenBytes = new byte[32];
            using (var rng = RandomNumberGenerator.Create())
            {
                rng.GetBytes(tokenBytes);
            }
            var token = Convert.ToHexString(tokenBytes);

            var session = new UserSession
            {
                Id = Guid.NewGuid(),
                UserId = user.Id,
                Token = token,
                ExpiresAt = DateTime.UtcNow.AddDays(1),
                CreatedAt = DateTime.UtcNow
            };

            _dbContext.UserSessions.Add(session);
            await _dbContext.SaveChangesAsync();

            return Ok(new
            {
                success = true,
                token = token,
                user = new
                {
                    user.Id,
                    user.Username,
                    user.Role,
                    user.DeviceUniqueId,
                    user.HasPaid
                }
            });
        }

        [HttpGet("me")]
        public async Task<IActionResult> GetMe()
        {
            var user = await GetCurrentUserAsync();
            if (user == null)
                return Unauthorized("Invalid or expired session token.");

            var pendingProfile = await _dbContext.PendingUserProfileChanges
                .FirstOrDefaultAsync(p => p.UserId == user.Id);

            return Ok(new
            {
                id = user.Id,
                username = user.Username,
                role = user.Role,
                deviceUniqueId = user.DeviceUniqueId,
                isPoiOwnerVerified = user.IsPoiOwnerVerified,
                hasPaid = user.HasPaid,
                fullName = user.FullName,
                email = user.Email,
                phoneNumber = user.PhoneNumber,
                avatarUrl = user.AvatarUrl,
                isActive = user.IsActive,
                pendingProfile = pendingProfile == null ? null : new
                {
                    fullName = pendingProfile.FullName,
                    phoneNumber = pendingProfile.PhoneNumber,
                    email = pendingProfile.Email
                }
            });
        }

        [HttpPost("upload-avatar")]
        public async Task<IActionResult> UploadAvatar()
        {
            try {
                var user = await GetCurrentUserAsync();
                if (user == null) return Unauthorized("Invalid session token.");

                if (!Request.HasFormContentType)
                    return BadRequest("Invalid form upload. HasFormContentType is false.");

                var form = await Request.ReadFormAsync();
                var file = form.Files.FirstOrDefault();
                if (file == null) return BadRequest("No file uploaded. form.Files.Count = " + form.Files.Count);

                var ext = Path.GetExtension(file.FileName);
                var allowed = new[] { ".jpg", ".jpeg", ".png", ".gif", ".webp" };
                if (!allowed.Contains(ext.ToLower())) return BadRequest("Unsupported file type: " + ext);

            var avatarsFolder = Path.Combine(Directory.GetCurrentDirectory(), "wwwroot", "avatars");
            Directory.CreateDirectory(avatarsFolder);

            var fileName = user.Id.ToString() + ext;
            var filePath = Path.Combine(avatarsFolder, fileName);

            await using (var stream = System.IO.File.Create(filePath))
            {
                await file.CopyToAsync(stream);
            }

            user.AvatarUrl = $"/avatars/{fileName}";
            _dbContext.Entry(user).State = EntityState.Modified;
            await _dbContext.SaveChangesAsync();

            return Ok(new { avatarUrl = user.AvatarUrl });
            } catch (Exception ex) {
                return BadRequest("Exception: " + ex.Message);
            }
        }

        public class ChangePasswordRequest
        {
            public string OldPassword { get; set; } = string.Empty;
            public string NewPassword { get; set; } = string.Empty;
        }

        [HttpPost("change-password")]
        public async Task<IActionResult> ChangePassword([FromBody] ChangePasswordRequest request)
        {
            var user = await GetCurrentUserAsync();
            if (user == null)
                return Unauthorized("Invalid session token.");

            if (!EncryptionHelper.VerifyPassword(request.OldPassword, user.PasswordHash, user.PasswordSalt))
                return BadRequest("Incorrect old password.");

            EncryptionHelper.HashPassword(request.NewPassword, out string hash, out string salt);
            user.PasswordHash = hash;
            user.PasswordSalt = salt;

            _dbContext.Entry(user).State = EntityState.Modified;
            await _dbContext.SaveChangesAsync();

            return Ok(new { success = true, message = "Password updated successfully." });
        }

        private async Task<User?> GetCurrentUserAsync()
        {
            var authHeader = Request.Headers["Authorization"].ToString();
            if (string.IsNullOrEmpty(authHeader) || !authHeader.StartsWith("Bearer "))
                return null;

            var token = authHeader.Substring("Bearer ".Length).Trim();
            var session = await _dbContext.UserSessions
                .FirstOrDefaultAsync(s => s.Token == token && s.ExpiresAt > DateTime.UtcNow);

            if (session == null)
                return null;

            return await _dbContext.Users.FirstOrDefaultAsync(u => u.Id == session.UserId);
        }
    }
}
