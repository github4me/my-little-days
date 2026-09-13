using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace LittleDays.FamilyApi;

public sealed class PilotDatabase(DbContextOptions<PilotDatabase> options) : DbContext(options)
{
    public DbSet<FamilyRow> Families => Set<FamilyRow>();
    public DbSet<MembershipRow> Memberships => Set<MembershipRow>();
    public DbSet<InvitationRow> Invitations => Set<InvitationRow>();
    public DbSet<FeedRow> Feeds => Set<FeedRow>();
    public DbSet<OperationRow> Operations => Set<OperationRow>();

    protected override void OnModelCreating(ModelBuilder model)
    {
        model.Entity<FamilyRow>(entity =>
        {
            entity.HasKey(x => x.Id);
            entity.Property(x => x.BabyName).HasMaxLength(60);
        });
        model.Entity<MembershipRow>(entity =>
        {
            entity.HasKey(x => x.Id);
            entity.Property(x => x.Role).HasMaxLength(10);
            entity.Property(x => x.Email).HasMaxLength(254);
            entity.Property(x => x.DisplayName).HasMaxLength(80);
            entity.HasIndex(x => x.UserId).IsUnique().HasFilter("[Active] = 1");
            entity.HasIndex(x => new { x.FamilyId, x.UserId, x.Active });
            entity.HasOne<FamilyRow>().WithMany().HasForeignKey(x => x.FamilyId).OnDelete(DeleteBehavior.Restrict);
        });
        model.Entity<InvitationRow>(entity =>
        {
            entity.HasKey(x => x.Id);
            entity.Property(x => x.Email).HasMaxLength(254);
            entity.Property(x => x.TokenHash).HasMaxLength(64).IsUnicode(false);
            entity.Property(x => x.Status).HasMaxLength(10);
            entity.HasIndex(x => x.TokenHash).IsUnique();
            entity.HasIndex(x => new { x.FamilyId, x.RecipientUserId }).IsUnique().HasFilter("[Status] = N'pending'");
            entity.HasOne<FamilyRow>().WithMany().HasForeignKey(x => x.FamilyId).OnDelete(DeleteBehavior.Restrict);
        });
        model.Entity<FeedRow>(entity =>
        {
            entity.HasKey(x => new { x.FamilyId, x.Id });
            entity.Property(x => x.Note).HasMaxLength(500);
            entity.Property(x => x.Amount).HasPrecision(7, 2);
            entity.Property(x => x.Version).IsRowVersion();
            entity.HasOne<FamilyRow>().WithMany().HasForeignKey(x => x.FamilyId).OnDelete(DeleteBehavior.Restrict);
            entity.ToTable(t => t.HasCheckConstraint("CK_Feeds_Amount", "[Amount] >= 0 AND [Amount] <= 2000"));
            entity.ToTable(t => t.HasCheckConstraint("CK_Feeds_Interval", "[End] >= [Start]"));
        });
        model.Entity<OperationRow>(entity =>
        {
            entity.HasKey(x => new { x.UserId, x.OperationId });
            entity.Property(x => x.Fingerprint).HasMaxLength(64).IsUnicode(false);
            entity.Property(x => x.Action).HasMaxLength(40).IsUnicode(false);
            entity.Property(x => x.ResultJson).HasMaxLength(2048);
            entity.HasIndex(x => x.FamilyId);
            entity.HasOne<FamilyRow>().WithMany().HasForeignKey(x => x.FamilyId).OnDelete(DeleteBehavior.Restrict);
        });
    }
}

public sealed class FamilyRow
{
    public Guid Id { get; set; }
    public string BabyName { get; set; } = "";
    public long Revision { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}
public sealed class MembershipRow
{
    public Guid Id { get; set; }
    public Guid FamilyId { get; set; }
    public Guid UserId { get; set; }
    public string Role { get; set; } = "caregiver";
    public string Email { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public bool Active { get; set; } = true;
    public DateTimeOffset GrantedAt { get; set; }
    public DateTimeOffset? EndedAt { get; set; }
}
public sealed class InvitationRow
{
    public Guid Id { get; set; }
    public Guid FamilyId { get; set; }
    public Guid RecipientUserId { get; set; }
    public string Email { get; set; } = "";
    public string TokenHash { get; set; } = "";
    public string Status { get; set; } = "pending";
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
    public Guid? AcceptedMembershipId { get; set; }
}
public sealed class FeedRow
{
    public Guid FamilyId { get; set; }
    public Guid Id { get; set; }
    public DateTimeOffset Start { get; set; }
    public DateTimeOffset End { get; set; }
    public decimal Amount { get; set; }
    public string Note { get; set; } = "";
    public Guid RecordedBy { get; set; }
    public Guid LastEditedBy { get; set; }
    public bool Deleted { get; set; }
    public byte[] Version { get; set; } = [];
}
public sealed class OperationRow
{
    public Guid UserId { get; set; }
    public Guid OperationId { get; set; }
    public Guid FamilyId { get; set; }
    public Guid MembershipId { get; set; }
    public Guid HistoryId { get; set; }
    public string Action { get; set; } = "";
    public string Fingerprint { get; set; } = "";
    public string ResultJson { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }
}

// Used by explicit EF tooling only. Never invent a deployment connection string.
public sealed class PilotDatabaseFactory : IDesignTimeDbContextFactory<PilotDatabase>
{
    public PilotDatabase CreateDbContext(string[] args)
    {
        var connection = Environment.GetEnvironmentVariable("ConnectionStrings__FamilyDatabase")
            ?? throw new InvalidOperationException("Set ConnectionStrings__FamilyDatabase for EF tooling.");
        return new(new DbContextOptionsBuilder<PilotDatabase>().UseSqlServer(connection).Options);
    }
}
