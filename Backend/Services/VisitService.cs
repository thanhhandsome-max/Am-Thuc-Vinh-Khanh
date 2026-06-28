using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Backend.Data;
using Backend.Models;
using Microsoft.EntityFrameworkCore;

namespace Backend.Services
{
    public interface IVisitService
    {
        double CalculateDistance(double lat1, double lon1, double lat2, double lon2);
        Task<VisitRecordResult> RecordVisitAsync(Guid userId, VisitRecordRequest request);
        Task<List<DashboardVisitStatDto>> GetDashboardStatsAsync();
        Task<List<DashboardDailyVisitDto>> GetDailyStatsAsync(Guid foodStallId, DateTime fromDate, DateTime toDate);
    }

    public class VisitRecordRequest
    {
        public Guid FoodStallId { get; set; }
        public string ActionType { get; set; } = string.Empty;
        public double UserLat { get; set; }
        public double UserLng { get; set; }
    }

    public class VisitRecordResult
    {
        public bool Success { get; set; }
        public bool IsValidVisit { get; set; }
        public string Message { get; set; } = string.Empty;
        public double DistanceMeter { get; set; }
    }

    public class DashboardVisitStatDto
    {
        public Guid FoodStallId { get; set; }
        public string Name { get; set; } = string.Empty;
        public string Address { get; set; } = string.Empty;
        public int ValidVisitCount { get; set; }
    }

    public class DashboardDailyVisitDto
    {
        public DateTime VisitDate { get; set; }
        public int ValidVisitCount { get; set; }
    }

    public class VisitService : IVisitService
    {
        private static readonly HashSet<string> AllowedActionTypes = new(StringComparer.OrdinalIgnoreCase)
        {
            "START_AUDIO",
            "VIEW_MENU"
        };

        private readonly AppDbContext _dbContext;

        public VisitService(AppDbContext dbContext)
        {
            _dbContext = dbContext;
        }

        public double CalculateDistance(double lat1, double lon1, double lat2, double lon2)
        {
            const double earthRadiusMeters = 6371000.0;
            var dLat = ToRadians(lat2 - lat1);
            var dLon = ToRadians(lon2 - lon1);

            var a = Math.Sin(dLat / 2) * Math.Sin(dLat / 2)
                    + Math.Cos(ToRadians(lat1)) * Math.Cos(ToRadians(lat2))
                    * Math.Sin(dLon / 2) * Math.Sin(dLon / 2);

            var c = 2 * Math.Atan2(Math.Sqrt(a), Math.Sqrt(1 - a));
            return earthRadiusMeters * c;
        }

        public async Task<VisitRecordResult> RecordVisitAsync(Guid userId, VisitRecordRequest request)
        {
            if (request.FoodStallId == Guid.Empty)
            {
                return new VisitRecordResult { Success = false, Message = "FoodStallId is required." };
            }

            if (!AllowedActionTypes.Contains(request.ActionType))
            {
                return new VisitRecordResult { Success = false, Message = "ActionType is invalid." };
            }

            var foodStall = await _dbContext.FoodStalls.FirstOrDefaultAsync(s => s.Id == request.FoodStallId);
            if (foodStall == null)
            {
                return new VisitRecordResult { Success = false, Message = "Food stall not found." };
            }

            var distanceMeter = CalculateDistance(request.UserLat, request.UserLng, foodStall.Latitude, foodStall.Longitude);
            var isValidVisit = distanceMeter <= 80;

            if (!isValidVisit)
            {
                return new VisitRecordResult
                {
                    Success = true,
                    IsValidVisit = false,
                    DistanceMeter = distanceMeter,
                    Message = "User is outside the valid visit radius. Visit not recorded."
                };
            }

            var cooldownStartedAt = DateTime.UtcNow.AddHours(-2);
            var recentValidVisit = await _dbContext.StallVisits.AnyAsync(v =>
                v.UserId == userId &&
                v.FoodStallId == request.FoodStallId &&
                v.IsValidVisit &&
                v.CreatedAt >= cooldownStartedAt);

            if (recentValidVisit)
            {
                return new VisitRecordResult
                {
                    Success = true,
                    IsValidVisit = false,
                    DistanceMeter = distanceMeter,
                    Message = "Cooldown active. Duplicate valid visit was blocked."
                };
            }

            _dbContext.StallVisits.Add(new StallVisit
            {
                Id = Guid.NewGuid(),
                FoodStallId = request.FoodStallId,
                UserId = userId,
                ActionType = request.ActionType.Trim().ToUpperInvariant(),
                UserLatitude = request.UserLat,
                UserLongitude = request.UserLng,
                DistanceMeter = distanceMeter,
                IsValidVisit = true,
                CreatedAt = DateTime.UtcNow
            });

            var user = await _dbContext.Users.FirstOrDefaultAsync(u => u.Id == userId);
            if (user != null)
            {
                user.LastActive = DateTime.UtcNow;
                _dbContext.Entry(user).State = EntityState.Modified;
            }

            await _dbContext.SaveChangesAsync();

            return new VisitRecordResult
            {
                Success = true,
                IsValidVisit = true,
                DistanceMeter = distanceMeter,
                Message = "Valid visit recorded successfully."
            };
        }

        public async Task<List<DashboardVisitStatDto>> GetDashboardStatsAsync()
        {
            return await _dbContext.FoodStalls
                .GroupJoin(
                    _dbContext.StallVisits.Where(v => v.IsValidVisit),
                    stall => stall.Id,
                    visit => visit.FoodStallId,
                    (stall, visits) => new DashboardVisitStatDto
                    {
                        FoodStallId = stall.Id,
                        Name = stall.Name,
                        Address = stall.Address,
                        ValidVisitCount = visits.Count()
                    })
                .OrderByDescending(item => item.ValidVisitCount)
                .ThenBy(item => item.Name)
                .ToListAsync();
        }

        public async Task<List<DashboardDailyVisitDto>> GetDailyStatsAsync(Guid foodStallId, DateTime fromDate, DateTime toDate)
        {
            var startDate = DateTime.SpecifyKind(fromDate.Date, DateTimeKind.Utc);
            var endExclusive = DateTime.SpecifyKind(toDate.Date.AddDays(1), DateTimeKind.Utc);

            var queryResult = await _dbContext.StallVisits
                .Where(v => v.IsValidVisit
                    && v.FoodStallId == foodStallId
                    && v.CreatedAt >= startDate
                    && v.CreatedAt < endExclusive)
                .ToListAsync();

            return queryResult
                .GroupBy(v => v.CreatedAt.Date)
                .Select(group => new DashboardDailyVisitDto
                {
                    VisitDate = DateTime.SpecifyKind(group.Key, DateTimeKind.Utc),
                    ValidVisitCount = group.Count()
                })
                .OrderBy(item => item.VisitDate)
                .ToList();
        }

        private static double ToRadians(double degrees)
        {
            return degrees * Math.PI / 180.0;
        }
    }
}