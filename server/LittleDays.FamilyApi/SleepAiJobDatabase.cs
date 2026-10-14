using Microsoft.EntityFrameworkCore;

namespace LittleDays.FamilyApi;

public sealed partial class PilotDatabase
{
    public DbSet<SleepAiJobRow> SleepAiJobs => Set<SleepAiJobRow>();
    public DbSet<SleepAiRevocationRow> SleepAiRevocations => Set<SleepAiRevocationRow>();
    public DbSet<SleepAiAttemptRow> SleepAiAttempts => Set<SleepAiAttemptRow>();
    private static void ConfigureSleepAiJobs(ModelBuilder model)
    {
        model.Entity<SleepAiJobRow>(e =>
        {
            e.ToTable("SleepAiJobs"); e.HasKey(x => new { x.UserId, x.Id });
            e.Property(x => x.InputRevision).HasMaxLength(64).IsUnicode(false);
            e.Property(x => x.RequestHash).HasMaxLength(64).IsUnicode(false);
            e.Property(x => x.State).HasMaxLength(12).IsUnicode(false);
            e.Property(x => x.ErrorCode).HasMaxLength(40).IsUnicode(false);
            e.Property(x => x.RequestJson).HasColumnType("nvarchar(max)");
            e.Property(x => x.ResultJson).HasColumnType("nvarchar(max)");
            e.HasIndex(x => new { x.State, x.CreatedAt });
            e.HasIndex(x => x.ExpiresAt);
            e.HasIndex(x => new { x.UserId, x.ConsentGeneration });
            e.HasIndex(x => x.MembershipId);
        });
        model.Entity<SleepAiRevocationRow>(e =>
        {
            e.ToTable("SleepAiRevocations"); e.HasKey(x => new { x.UserId, x.Kind, x.Id });
            e.Property(x => x.Kind).HasMaxLength(8).IsUnicode(false);
            e.HasIndex(x => x.ExpiresAt);
        });
        model.Entity<SleepAiAttemptRow>(e =>
        {
            e.ToTable("SleepAiAttempts"); e.HasKey(x => x.Id);
            e.HasIndex(x => new { x.UserId, x.StartedAt });
            e.HasIndex(x => x.StartedAt); e.HasIndex(x => x.LeaseUntil);
        });
    }
}

public sealed class SleepAiJobRow
{
    public Guid UserId { get; set; }
    public Guid Id { get; set; }
    public Guid ConsentGeneration { get; set; }
    public Guid? FamilyId { get; set; }
    public Guid? MembershipId { get; set; }
    public Guid? HistoryId { get; set; }
    public string InputRevision { get; set; } = "";
    public string RequestHash { get; set; } = "";
    public string State { get; set; } = "queued";
    public DateTimeOffset RequestNow { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
    public string? RequestJson { get; set; }
    public string? ResultJson { get; set; }
    public string? ErrorCode { get; set; }
    public Guid? LeaseId { get; set; }
    public DateTimeOffset? LeaseUntil { get; set; }
    public int Runs { get; set; }
}

public sealed class SleepAiRevocationRow
{
    public Guid UserId { get; set; }
    public string Kind { get; set; } = "";
    public Guid Id { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
}

public sealed class SleepAiAttemptRow
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public DateTimeOffset StartedAt { get; set; }
    public DateTimeOffset? LeaseUntil { get; set; }
}
