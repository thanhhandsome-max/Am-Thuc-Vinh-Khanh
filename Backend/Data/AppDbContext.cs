using Microsoft.EntityFrameworkCore;
using Backend.Models;

namespace Backend.Data
{
    public class AppDbContext : DbContext
    {
        public AppDbContext(DbContextOptions<AppDbContext> options) : base(options)
        {
        }

        public DbSet<User> Users => Set<User>();
        public DbSet<UserTelemetry> UserTelemetries => Set<UserTelemetry>();
        public DbSet<FoodStall> FoodStalls => Set<FoodStall>();
        public DbSet<Localization> Localizations => Set<Localization>();
        public DbSet<OwnerRegistration> OwnerRegistrations => Set<OwnerRegistration>();
        public DbSet<UserSession> UserSessions => Set<UserSession>();
        public DbSet<AiUsageLimit> AiUsageLimits => Set<AiUsageLimit>();
        public DbSet<Notification> Notifications => Set<Notification>();
        public DbSet<PaymentTransaction> PaymentTransactions => Set<PaymentTransaction>();
        public DbSet<StallVisit> StallVisits => Set<StallVisit>();
        public DbSet<StallMenuImage> StallMenuImages => Set<StallMenuImage>();
        public DbSet<PendingUserProfileChange> PendingUserProfileChanges => Set<PendingUserProfileChange>();

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            base.OnModelCreating(modelBuilder);

            // Configure unique index on DeviceUniqueId for User
            modelBuilder.Entity<User>()
                .HasIndex(u => u.DeviceUniqueId)
                .IsUnique();

            // Configure unique composite index on FoodStallId and LanguageCode
            modelBuilder.Entity<Localization>()
                .HasIndex(l => new { l.FoodStallId, l.LanguageCode })
                .IsUnique();

            modelBuilder.Entity<StallVisit>()
                .HasIndex(v => new { v.UserId, v.FoodStallId, v.CreatedAt });
        }
    }
}
