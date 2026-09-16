using Microsoft.EntityFrameworkCore;

namespace LittleDays.FamilyApi;

public sealed class PilotDatabase(DbContextOptions<PilotDatabase> options) : DbContext(options)
{
    public DbSet<FamilyRow> Families => Set<FamilyRow>();
    public DbSet<MembershipRow> Memberships => Set<MembershipRow>();
    public DbSet<InvitationRow> Invitations => Set<InvitationRow>();
    public DbSet<FeedRow> Feeds => Set<FeedRow>();
    public DbSet<FamilyRecordRow> FamilyRecords => Set<FamilyRecordRow>();
    public DbSet<OperationRow> Operations => Set<OperationRow>();
    public DbSet<OwnershipTransferRow> OwnershipTransfers => Set<OwnershipTransferRow>();
    public DbSet<AccountDeletionRow> AccountDeletions => Set<AccountDeletionRow>();

    protected override void OnModelCreating(ModelBuilder model)
    {
        model.Entity<FamilyRow>(entity =>
        {
            entity.HasKey(x => x.Id);
            entity.Property(x => x.BabyName).HasMaxLength(100);
            entity.Property(x => x.BabyBirthDate).HasMaxLength(10);
            entity.Property(x => x.BabySex).HasMaxLength(11).HasDefaultValue("unspecified");
            entity.Property(x => x.SchemaVersion).HasDefaultValue(1);
            entity.Property(x => x.ProfileVersion).IsRowVersion();
        });
        model.Entity<MembershipRow>(entity =>
        {
            entity.HasKey(x => x.Id);
            entity.Property(x => x.Role).HasMaxLength(10);
            entity.Property(x => x.Email).HasMaxLength(254);
            entity.Property(x => x.DisplayName).HasMaxLength(80);
            entity.Property(x => x.Status).HasMaxLength(10);
            entity.HasIndex(x => x.UserId).IsUnique().HasFilter("[Active] = 1");
            entity.HasIndex(x => new { x.FamilyId, x.UserId, x.Active });
            entity.HasOne<FamilyRow>().WithMany().HasForeignKey(x => x.FamilyId).OnDelete(DeleteBehavior.Restrict);
        });
        model.Entity<InvitationRow>(entity =>
        {
            entity.HasKey(x => x.Id);
            entity.Property(x => x.Email).HasMaxLength(254);
            entity.Property(x => x.Status).HasMaxLength(10);
            entity.HasIndex(x => new { x.FamilyId, x.Email }).IsUnique().HasFilter("[Status] = N'pending'");
            entity.HasOne<FamilyRow>().WithMany().HasForeignKey(x => x.FamilyId).OnDelete(DeleteBehavior.Restrict);
        });
        model.Entity<OwnershipTransferRow>(entity =>
        {
            entity.HasKey(x => x.Id);
            entity.Property(x => x.Status).HasMaxLength(10);
            entity.HasIndex(x => x.FamilyId).IsUnique().HasFilter("[Status] = N'pending'");
            entity.HasOne<FamilyRow>().WithMany().HasForeignKey(x => x.FamilyId).OnDelete(DeleteBehavior.Restrict);
        });
        model.Entity<AccountDeletionRow>(entity =>
        {
            entity.HasKey(x => x.UserId);
            entity.Property(x => x.Status).HasMaxLength(32);
            entity.Property(x => x.ReceiptHash).HasMaxLength(64).IsUnicode(false);
            entity.Property(x => x.PendingEmail).HasMaxLength(254);
            entity.HasIndex(x => x.OperationId).IsUnique();
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
        model.Entity<FamilyRecordRow>(entity =>
        {
            // SQL string equality ignores trailing spaces. Hash the source ID for the key,
            // keeping its exact spelling and case in Id and RecordJson.
            entity.HasKey(x => new { x.FamilyId, x.Collection, x.IdHash });
            entity.Property(x => x.Collection).HasMaxLength(5).IsUnicode(false);
            entity.Property(x => x.IdHash).HasMaxLength(64).IsUnicode(false);
            entity.Property(x => x.Id).HasMaxLength(128).IsRequired();
            entity.Property(x => x.RecordJson).HasColumnType("nvarchar(max)");
            entity.Property(x => x.Version).IsRowVersion();
            entity.HasOne<FamilyRow>().WithMany().HasForeignKey(x => x.FamilyId).OnDelete(DeleteBehavior.Restrict);
            entity.ToTable(t => t.HasCheckConstraint("CK_FamilyRecords_Collection", "[Collection] IN ('entry', 'care', 'extra')"));
            entity.ToTable(t => t.HasCheckConstraint("CK_FamilyRecords_Json", "ISJSON([RecordJson]) = 1 AND (DATALENGTH([RecordJson]) <= 131072 OR ([Collection] = 'extra' AND [Id] = 'avatar' AND COALESCE(JSON_VALUE([RecordJson], '$.kind'), '') = 'avatar' AND DATALENGTH([RecordJson]) <= 35651584))"));
        });
    }
}

public sealed class FamilyRow
{
    public Guid Id { get; set; }
    public string BabyName { get; set; } = "";
    public long Revision { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public string? BabyBirthDate { get; set; }
    public string BabySex { get; set; } = "unspecified";
    public int SchemaVersion { get; set; } = 1;
    public byte[] ProfileVersion { get; set; } = [];
    public DateTimeOffset? DeletedAt { get; set; }
    public Guid? DeletedBy { get; set; }
    public Guid? DeleteOperationId { get; set; }
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
    public string Status { get; set; } = "active";
}
public sealed class InvitationRow
{
    public Guid Id { get; set; }
    public Guid FamilyId { get; set; }
    public Guid? RecipientUserId { get; set; }
    public string Email { get; set; } = "";
    public string Status { get; set; } = "pending";
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
    public Guid? AcceptedMembershipId { get; set; }
}
public sealed class OwnershipTransferRow
{
    public Guid Id { get; set; }
    public Guid FamilyId { get; set; }
    public Guid FromUserId { get; set; }
    public Guid ToUserId { get; set; }
    public Guid FromMembershipId { get; set; }
    public Guid ToMembershipId { get; set; }
    public string Status { get; set; } = "pending";
    public DateTimeOffset CreatedAt { get; set; }
}
// Minimal durable tombstone also denies access with an otherwise valid old JWT.
// No email/name/token is retained here after deletion.
public sealed class AccountDeletionRow
{
    public Guid UserId { get; set; }
    public Guid OperationId { get; set; }
    public string Status { get; set; } = "pending";
    public DateTimeOffset RequestedAt { get; set; }
    public DateTimeOffset? CompletedAt { get; set; }
    public string ReceiptHash { get; set; } = "";
    public string? PendingEmail { get; set; }
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

public sealed class FamilyRecordRow
{
    public Guid FamilyId { get; set; }
    public string Collection { get; set; } = "entry";
    public string IdHash { get; set; } = "";
    public string Id { get; set; } = "";
    public string RecordJson { get; set; } = "{}";
    public Guid RecordedBy { get; set; }
    public Guid LastEditedBy { get; set; }
    public bool Deleted { get; set; }
    public byte[] Version { get; set; } = [];
}
