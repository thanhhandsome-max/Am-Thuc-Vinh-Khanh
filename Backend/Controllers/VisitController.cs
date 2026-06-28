using System;
using System.Linq;
using System.Threading.Tasks;
using Backend.Data;
using Backend.Models;
using Backend.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Backend.Controllers
{
    [ApiController]
    [Route("api/visits")]
    public class VisitController : ControllerBase
    {
        private readonly AppDbContext _dbContext;
        private readonly IVisitService _visitService;

        public VisitController(AppDbContext dbContext, IVisitService visitService)
        {
            _dbContext = dbContext;
            _visitService = visitService;
        }

        [HttpPost("record")]
        public async Task<IActionResult> Record([FromBody] VisitRecordRequest request)
        {
            var user = await GetAuthorizedUserAsync();
            if (user == null)
            {
                return Unauthorized("Sign in required.");
            }

            var result = await _visitService.RecordVisitAsync(user.Id, request);
            if (!result.Success)
            {
                return BadRequest(result.Message);
            }

            return Ok(result);
        }

        [HttpGet("dashboard")]
        public async Task<IActionResult> GetDashboard()
        {
            var admin = await GetAdminUserAsync();
            if (admin == null)
            {
                return Unauthorized("Admin privileges required.");
            }

            var stats = await _visitService.GetDashboardStatsAsync();
            return Ok(stats);
        }

        // ĐÃ SỬA LỖI Ở API NÀY: Mở quyền cho cả Admin và Owner
        [HttpGet("stalls/{foodStallId}/daily")]
        public async Task<IActionResult> GetDailyStats(Guid foodStallId, [FromQuery] DateTime? fromDate, [FromQuery] DateTime? toDate)
        {
            // 1. Lấy thông tin user hiện tại (bất kể role là gì)
            var user = await GetAuthorizedUserAsync();
            if (user == null)
            {
                return Unauthorized("Sign in required.");
            }

            // 2. Kiểm tra quyền: Chỉ cho phép Admin HOẶC Owner đi tiếp
            if (!string.Equals(user.Role, "Admin", StringComparison.OrdinalIgnoreCase) && 
                !string.Equals(user.Role, "Owner", StringComparison.OrdinalIgnoreCase))
            {
                return Unauthorized("Admin or Owner privileges required.");
            }

            var stallExists = await _dbContext.FoodStalls.AnyAsync(s => s.Id == foodStallId);
            if (!stallExists)
            {
                return NotFound("Food stall not found.");
            }

            var end = ToUtcDateOnly(toDate ?? DateTime.UtcNow);
            var start = ToUtcDateOnly(fromDate ?? end.AddDays(-9));

            if (start > end)
            {
                return BadRequest("fromDate must be less than or equal to toDate.");
            }

            var stats = await _visitService.GetDailyStatsAsync(foodStallId, start, end);
            return Ok(stats);
        }

        private static DateTime ToUtcDateOnly(DateTime value)
        {
            return DateTime.SpecifyKind(value.Date, DateTimeKind.Utc);
        }

        private async Task<User?> GetAuthorizedUserAsync()
        {
            var authHeader = Request.Headers["Authorization"].ToString();
            if (string.IsNullOrEmpty(authHeader) || !authHeader.StartsWith("Bearer "))
                return null;

            var token = authHeader.Substring("Bearer ".Length).Trim();
            var session = await _dbContext.UserSessions
                .Include(s => s.User)
                .FirstOrDefaultAsync(s => s.Token == token && s.ExpiresAt > DateTime.UtcNow);

            return session?.User;
        }

        private async Task<User?> GetAdminUserAsync()
        {
            var user = await GetAuthorizedUserAsync();
            if (user == null || !string.Equals(user.Role, "Admin", StringComparison.OrdinalIgnoreCase))
                return null;

            return user;
        }
    }
}