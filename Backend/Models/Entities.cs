using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Backend.Models
{
    public class User
    {
        [Key]
        public Guid Id { get; set; } = Guid.NewGuid();

        [Required]
        public string DeviceUniqueId { get; set; } = string.Empty;

        public string Username { get; set; } = string.Empty;

        public string PasswordHash { get; set; } = string.Empty;

        public string PasswordSalt { get; set; } = string.Empty;

        [Required]
        public string Role { get; set; } = "Public"; // "Public", "Owner", "Admin"

        public string FullName { get; set; } = string.Empty;

        public string PhoneNumber { get; set; } = string.Empty;

        public string Email { get; set; } = string.Empty;
        public string AvatarUrl { get; set; } = string.Empty;

        public bool HasPaidAccess { get; set; } = false;

        public DateTime? PaymentActivatedAt { get; set; }

        public bool IsVerified { get; set; } = true; // Owner starts as false until approved

        public bool IsPoiOwnerVerified { get; set; } = false;
        public bool HasPaid { get; set; } = false;

        public DateTime LastActive { get; set; } = DateTime.UtcNow;

        [Column("is_Active")]
        public bool IsActive { get; set; } = true;

        [Column("cccdEncrypted")]
        public string? CccdEncrypted { get; set; }
    }

    public class UserTelemetry
    {
        [Key]
        public Guid Id { get; set; } = Guid.NewGuid();

        [Required]
        public Guid UserId { get; set; }

        [ForeignKey(nameof(UserId))]
        public User? User { get; set; }

        public DateTime Timestamp { get; set; } = DateTime.UtcNow;

        public double Latitude { get; set; }

        public double Longitude { get; set; }

        [Required]
        public string Action { get; set; } = string.Empty; // e.g., "LISTENED_STALL", "CHAT_AI"
    }

    public class FoodStall
    {
        [Key]
        public Guid Id { get; set; } = Guid.NewGuid();

        [Required]
        public string Name { get; set; } = string.Empty;

        [Required]
        public string Address { get; set; } = string.Empty;

        public double Latitude { get; set; }

        public double Longitude { get; set; }

        public ICollection<StallMenuImage> MenuImages { get; set; } = new List<StallMenuImage>();

        [Required]
        public string OriginalHistory { get; set; } = string.Empty; // Vietnamese source description

        public Guid? OwnerId { get; set; } // Nullable for public/unowned seed stalls

        public bool IsVerified { get; set; } = true; // True for seeded stalls, False for new owner submissions

        public string AdminNote { get; set; } = string.Empty;

        [Column("is_Active")]
        public bool IsActive { get; set; } = true;
    }

    public class Localization
    {
        [Key]
        public Guid Id { get; set; } = Guid.NewGuid();

        [Required]
        public Guid FoodStallId { get; set; }

        [ForeignKey(nameof(FoodStallId))]
        public FoodStall? FoodStall { get; set; }

        [Required]
        public string LanguageCode { get; set; } = string.Empty; // e.g., "en", "ja", "ko"

        [Required]
        public string TranslatedText { get; set; } = string.Empty;

        [Required]
        public string TextHash { get; set; } = string.Empty; // MD5 hash of TranslatedText

        [Required]
        public string AudioUrl { get; set; } = string.Empty; // URL to generated MP3 file
    }

    public class OwnerRegistration
    {
        [Key]
        public Guid Id { get; set; } = Guid.NewGuid();

        [Required]
        public Guid UserId { get; set; }

        [ForeignKey(nameof(UserId))]
        public User? User { get; set; }

        [Required]
        public string FullName { get; set; } = string.Empty;

        [Required]
        public string CccdEncrypted { get; set; } = string.Empty; // PII encrypted using AES-256

        [Column("numberphone")]
        public string? PhoneNumber { get; set; }

        [Column("email")]
        public string? Email { get; set; }

        [Required]
        public string Status { get; set; } = "Pending"; // "Pending", "Approved", "Rejected"

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        public string AdminNote { get; set; } = string.Empty;
    }

    public class UserSession
    {
        [Key]
        public Guid Id { get; set; } = Guid.NewGuid();

        [Required]
        public Guid UserId { get; set; }

        [ForeignKey(nameof(UserId))]
        public User? User { get; set; }

        [Required]
        public string Token { get; set; } = string.Empty;

        public DateTime ExpiresAt { get; set; }

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    }

    public class PaymentTransaction
    {
        [Key]
        public Guid Id { get; set; } = Guid.NewGuid();

        [Required]
        public Guid UserId { get; set; }

        [ForeignKey(nameof(UserId))]
        public User? User { get; set; }

        [Required]
        public string TransactionId { get; set; } = string.Empty;

        [Required]
        public string ResponseCode { get; set; } = string.Empty;

        public bool IsSuccess { get; set; }

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    }

    public class AiUsageLimit
    {
        [Key]
        public Guid Id { get; set; } = Guid.NewGuid();

        [Required]
        public Guid UserId { get; set; }

        [ForeignKey(nameof(UserId))]
        public User? User { get; set; }

        public DateTime Date { get; set; } = DateTime.SpecifyKind(DateTime.UtcNow.Date, DateTimeKind.Utc);

        public int Count { get; set; } = 0;
    }

    public class Notification
    {
        [Key]
        public Guid Id { get; set; } = Guid.NewGuid();

        [Required]
        public Guid UserId { get; set; }

        [ForeignKey(nameof(UserId))]
        public User? User { get; set; }

        [Required]
        public string Message { get; set; } = string.Empty;

        public bool IsRead { get; set; } = false;

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    }

    public class StallVisit
    {
        [Key]
        public Guid Id { get; set; } = Guid.NewGuid();

        [Required]
        public Guid FoodStallId { get; set; }

        [ForeignKey(nameof(FoodStallId))]
        public FoodStall? FoodStall { get; set; }

        [Required]
        public Guid UserId { get; set; }

        [ForeignKey(nameof(UserId))]
        public User? User { get; set; }

        [Required]
        public string ActionType { get; set; } = string.Empty;

        public double UserLatitude { get; set; }

        public double UserLongitude { get; set; }

        public double DistanceMeter { get; set; }

        public bool IsValidVisit { get; set; }

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    }

    public class StallMenuImage
    {
        [Key]
        public Guid Id { get; set; } = Guid.NewGuid();

        [Required]
        public Guid FoodStallId { get; set; }

        [ForeignKey(nameof(FoodStallId))]
        public FoodStall? FoodStall { get; set; }

        [Required]
        public string ImageUrl { get; set; } = string.Empty;

        public bool IsMainImage { get; set; } = false;

        public int DisplayOrder { get; set; } = 0;

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    }

    public class PendingUserProfileChange
    {
        [Key]
        public Guid Id { get; set; } = Guid.NewGuid();

        [Required]
        public Guid UserId { get; set; }

        [ForeignKey(nameof(UserId))]
        public User? User { get; set; }

        [Required]
        public string FullName { get; set; } = string.Empty;

        [Required]
        public string PhoneNumber { get; set; } = string.Empty;

        [Required]
        public string Email { get; set; } = string.Empty;

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    }
}
