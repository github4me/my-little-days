using Microsoft.EntityFrameworkCore;

namespace LittleDays.FamilyApi;

public sealed partial class PilotDatabase
{
    public DbSet<PushInstallationRow> PushInstallations => Set<PushInstallationRow>();
    public DbSet<FamilyNotificationEventRow> FamilyNotificationEvents => Set<FamilyNotificationEventRow>();
    public DbSet<PushDeliveryRow> PushDeliveries => Set<PushDeliveryRow>();
    public DbSet<NotificationSummaryBucketRow> NotificationSummaryBuckets => Set<NotificationSummaryBucketRow>();

    private static void ConfigurePush(ModelBuilder model)
    {
        model.Entity<PushInstallationRow>(e =>
        {
            e.ToTable("PushInstallations"); e.HasKey(x => x.Id);
            e.Property(x => x.SecretHash).HasMaxLength(64).IsUnicode(false);
            e.Property(x => x.TokenHash).HasMaxLength(64).IsUnicode(false);
            e.Property(x => x.ProtectedToken).HasMaxLength(1024).IsUnicode(false);
            e.Property(x => x.Environment).HasMaxLength(32).IsUnicode(false);
            e.Property(x => x.Platform).HasMaxLength(7).IsUnicode(false);
            e.Property(x => x.Locale).HasMaxLength(16).IsUnicode(false);
            e.Property(x => x.LastRequestHash).HasMaxLength(64).IsUnicode(false);
            e.HasIndex(x => new { x.ProjectId, x.Environment, x.TokenHash }).IsUnique().HasFilter("[TokenHash] IS NOT NULL");
            e.HasIndex(x => new { x.UserId, x.Enabled });
            e.HasIndex(x => x.FamilyId);
            e.HasIndex(x => x.MembershipId);
            e.HasIndex(x => x.ExpiresAt);
        });
        model.Entity<FamilyNotificationEventRow>(e =>
        {
            e.ToTable("FamilyNotificationEvents"); e.HasKey(x => x.Id);
            e.Property(x => x.RecordIdHash).HasMaxLength(64).IsUnicode(false);
            e.Property(x => x.Category).HasMaxLength(6).IsUnicode(false);
            e.HasIndex(x => new { x.HistoryId, x.ActorUserId, x.OperationId, x.Category }).IsUnique();
            e.HasIndex(x => new { x.FamilyId, x.CreatedAt });
            e.HasIndex(x => new { x.FamilyId, x.RecordIdHash });
            e.HasIndex(x => x.ActorUserId);
            e.HasIndex(x => x.ExpiresAt);
        });
        model.Entity<PushDeliveryRow>(e =>
        {
            e.ToTable("PushDeliveries"); e.HasKey(x => new { x.EventId, x.BucketId });
            e.HasIndex(x => x.BucketId);
            e.HasIndex(x => x.ExpiresAt);
        });
        model.Entity<NotificationSummaryBucketRow>(e =>
        {
            e.ToTable("NotificationSummaryBuckets"); e.HasKey(x => x.Id);
            e.Property(x => x.BucketKey).HasMaxLength(64).IsUnicode(false);
            e.Property(x => x.State).HasMaxLength(12).IsUnicode(false);
            e.Property(x => x.ReceiptId).HasMaxLength(128).IsUnicode(false);
            e.Property(x => x.LastError).HasMaxLength(40).IsUnicode(false);
            e.HasIndex(x => x.BucketKey).IsUnique();
            e.HasIndex(x => new { x.State, x.DueAt, x.Id });
            e.HasIndex(x => new { x.State, x.LeaseUntil });
            e.HasIndex(x => new { x.InstallationId, x.Generation });
            e.HasIndex(x => new { x.MembershipId, x.State });
            e.HasIndex(x => new { x.FamilyId, x.State });
            e.HasIndex(x => new { x.RecipientUserId, x.State });
            e.HasIndex(x => x.ExpiresAt);
        });
    }
}

// No foreign keys to disposable memberships/records: old API cleanup must remain
// compatible. Sender checks authoritative rows; retention removes bounded metadata.
public sealed class PushInstallationRow
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public Guid FamilyId { get; set; }
    public Guid MembershipId { get; set; }
    public Guid HistoryId { get; set; }
    public Guid ProjectId { get; set; }
    public string Environment { get; set; } = "";
    public string SecretHash { get; set; } = "";
    public string? TokenHash { get; set; }
    public string ProtectedToken { get; set; } = "";
    public string Platform { get; set; } = "";
    public string Locale { get; set; } = "en";
    public int Generation { get; set; }
    public bool Enabled { get; set; }
    public int CategoryMask { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset NextSendAt { get; set; }
    public Guid LastOperationId { get; set; }
    public string LastRequestHash { get; set; } = "";
}
public sealed class FamilyNotificationEventRow
{
    public Guid Id { get; set; }
    public Guid FamilyId { get; set; }
    public Guid HistoryId { get; set; }
    public Guid ActorUserId { get; set; }
    public Guid OperationId { get; set; }
    public string RecordIdHash { get; set; } = "";
    public string Category { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset NotBeforeAt { get; set; }
    public bool Cancelled { get; set; }
}
public sealed class PushDeliveryRow
{
    public Guid EventId { get; set; }
    public Guid BucketId { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
}
public sealed class NotificationSummaryBucketRow
{
    public Guid Id { get; set; }
    public string BucketKey { get; set; } = "";
    public Guid FamilyId { get; set; }
    public Guid HistoryId { get; set; }
    public Guid RecipientUserId { get; set; }
    public Guid MembershipId { get; set; }
    public Guid InstallationId { get; set; }
    public int Generation { get; set; }
    public bool IsSummary { get; set; }
    public DateTimeOffset WindowStart { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset DueAt { get; set; }
    public string State { get; set; } = "pending";
    public bool Sealed { get; set; }
    public Guid? LeaseId { get; set; }
    public DateTimeOffset? LeaseUntil { get; set; }
    public int Attempts { get; set; }
    public string? ReceiptId { get; set; }
    public string LastError { get; set; } = "";
}
