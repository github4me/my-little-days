using System.Data;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;

namespace LittleDays.FamilyApi;

public sealed class FamilyService(PilotDatabase db, PilotConfiguration config, TimeProvider clock)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private DateTimeOffset Now => clock.GetUtcNow();

    // This intentionally small pilot uses ONE SQL transaction-owned application lock.
    // Every authenticated data read/write participates, including snapshot and retries.
    // This serializes across processes/replicas, makes removal and receipt checks atomic,
    // and prevents a one-family-per-account race between different families. No process lock.
    public async Task<T> Transaction<T>(Func<Task<T>> action, CancellationToken ct = default)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
        await db.Database.ExecuteSqlRawAsync("""
            DECLARE @result int;
            EXEC @result = sys.sp_getapplock @Resource = N'LittleDays:FamilyPilot:v1',
                @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 10000;
            IF @result < 0 THROW 51000, 'Pilot transaction lock unavailable.', 1;
            """, ct);
        var result = await action();
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return result;
    }

    public Task<MeResult> Me(PilotIdentity user, CancellationToken ct) => Transaction(async () =>
    {
        var memberships = await db.Memberships.Where(x => x.UserId == user.ObjectId && x.Active).ToArrayAsync(ct);
        var ids = memberships.Select(x => x.FamilyId).ToArray();
        var families = await db.Families.Where(x => ids.Contains(x.Id)).ToArrayAsync(ct);
        return new MeResult(new(user.ObjectId, user.DisplayName, user.Email),
            families.Select(x => Summary(x, memberships.Single(m => m.FamilyId == x.Id))).ToArray());
    }, ct);

    public Task<FamilySummary> CreateFamily(PilotIdentity user, CreateFamilyRequest request, CancellationToken ct) => Transaction(async () =>
    {
        ValidateId(request.OperationId);
        if (request.BabyName is null || request.BabyName.Trim().Length < 1 ||
            request.BabyName.Length > config.Pilot.MaxBabyNameLength || request.BabyName.Any(char.IsControl)) Invalid();
        var hash = Fingerprint("create-family", request);
        var old = await Receipt(user, request.OperationId, hash, ct);
        if (old is not null)
        {
            await RequireGrant(user, old.FamilyId, old.MembershipId, ct);
            return ReadResult<FamilySummary>(old);
        }
        if (await db.Memberships.AnyAsync(x => x.UserId == user.ObjectId && x.Active, ct))
            throw new ApiException(409, "already_in_family");
        var family = new FamilyRow { Id = Guid.NewGuid(), BabyName = request.BabyName!.Trim(), Revision = 1, CreatedAt = Now };
        var membership = NewGrant(user, family.Id, "owner");
        db.Families.Add(family);
        db.Memberships.Add(membership);
        var result = Summary(family, membership);
        SaveReceipt(user, request.OperationId, family.Id, membership.Id, "create-family", hash, result);
        return result;
    }, ct);

    public Task<FamilySnapshot> Snapshot(PilotIdentity user, Guid familyId, CancellationToken ct) => Transaction(async () =>
    {
        var grant = await RequireGrant(user, familyId, null, ct);
        var family = await Family(familyId, ct);
        // Persist time-driven state before calculating revision/ETag so conditional GETs do not
        // keep showing a pending invitation after its expiry boundary.
        var now = Now;
        var expired = await db.Invitations.Where(x => x.FamilyId == familyId && x.Status == "pending" && x.ExpiresAt <= now).ToArrayAsync(ct);
        foreach (var invitation in expired) invitation.Status = "expired";
        if (expired.Length > 0) family.Revision++;
        var members = await db.Memberships.Where(x => x.FamilyId == familyId && x.Active).OrderBy(x => x.GrantedAt).ToArrayAsync(ct);
        var feeds = await db.Feeds.Where(x => x.FamilyId == familyId && !x.Deleted).OrderByDescending(x => x.Start).ThenBy(x => x.Id).ToArrayAsync(ct);
        // Only the owner receives recipient emails and invitation administration state.
        var invitations = grant.Role == "owner"
            ? await db.Invitations.Where(x => x.FamilyId == familyId)
                .OrderBy(x => x.Status == "pending" ? 0 : 1).ThenByDescending(x => x.CreatedAt).Take(100).ToArrayAsync(ct)
            : [];
        return new FamilySnapshot(Summary(family, grant), config.Family.HistoryId, Revision(family),
            members.Select(Member).ToArray(), invitations.Select(Invitation).ToArray(),
            feeds.Select(x => new SharedFeed(x.Id, Convert.ToBase64String(x.Version), x.RecordedBy, x.LastEditedBy,
                x.Start, x.End, x.Amount, x.Note)).ToArray());
    }, ct);

    public Task<InvitationResult> CreateInvitation(PilotIdentity user, Guid familyId, CreateInvitationRequest request, CancellationToken ct) => Transaction(async () =>
    {
        ValidateId(request.OperationId);
        var grant = await RequireOwner(user, familyId, ct);
        var email = PilotConfiguration.NormalizeEmail(request.Email);
        if (!PilotConfiguration.IsEmail(email)) Invalid();
        var recipient = config.Pilot.Identities.SingleOrDefault(x => x.Email == email);
        if (recipient is null || recipient.ObjectId == user.ObjectId) Invalid();
        var hash = Fingerprint("create-invitation", new { familyId, request.OperationId, email });
        var old = await Receipt(user, request.OperationId, hash, ct);
        // The token never enters durable receipts: a lost issuance response needs a new invitation.
        if (old is not null) throw new ApiException(409, "invitation_already_created");
        await CheckCapacity(familyId, ct);
        if (await db.Memberships.AnyAsync(x => x.UserId == recipient!.ObjectId && x.Active, ct))
            throw new ApiException(409, "already_in_family");
        if (await db.Memberships.CountAsync(x => x.FamilyId == familyId && x.Active, ct) >= config.Pilot.MaxMembers) Invalid();
        await RevokePending(familyId, recipient!.ObjectId, ct);
        // Flush revocation before inserting into the unique pending-recipient index, still in this transaction.
        await db.SaveChangesAsync(ct);
        var token = Base64Url(RandomNumberGenerator.GetBytes(32));
        var row = new InvitationRow
        {
            Id = Guid.NewGuid(),
            FamilyId = familyId,
            RecipientUserId = recipient.ObjectId,
            Email = email,
            TokenHash = TokenHash(token),
            CreatedAt = Now,
            ExpiresAt = Now.AddHours(config.Pilot.InvitationHours)
        };
        db.Invitations.Add(row);
        var family = await Family(familyId, ct);
        family.Revision++;
        SaveReceipt(user, request.OperationId, familyId, grant.Id, "create-invitation", hash, new { invitationId = row.Id });
        return new InvitationResult(Invitation(row), $"{config.Family.PublicBaseUrl}/join#token={token}");
    }, ct);

    public Task<FamilySummary> AcceptInvitation(PilotIdentity user, AcceptInvitationRequest request, CancellationToken ct) => Transaction(async () =>
    {
        ValidateId(request.OperationId);
        if (!IsToken(request.Token)) throw new ApiException(410, "invitation_unavailable");
        var tokenHash = TokenHash(request.Token);
        var hash = Fingerprint("accept-invitation", new { request.OperationId, tokenHash });
        var old = await Receipt(user, request.OperationId, hash, ct);
        if (old is not null)
        {
            // A consumed-token retry returns its original receipt only while that exact grant exists.
            await RequireGrant(user, old.FamilyId, old.MembershipId, ct);
            return ReadResult<FamilySummary>(old);
        }
        var invitation = await db.Invitations.SingleOrDefaultAsync(x => x.TokenHash == tokenHash, ct);
        if (invitation is null || invitation.RecipientUserId != user.ObjectId || invitation.Email != user.Email ||
            invitation.Status != "pending" || invitation.ExpiresAt <= Now)
            throw new ApiException(410, "invitation_unavailable");
        if (await db.Memberships.AnyAsync(x => x.UserId == user.ObjectId && x.Active, ct))
            throw new ApiException(409, "already_in_family");
        if (await db.Memberships.CountAsync(x => x.FamilyId == invitation.FamilyId && x.Active, ct) >= config.Pilot.MaxMembers) Invalid();
        await CheckCapacity(invitation.FamilyId, ct);
        var family = await Family(invitation.FamilyId, ct);
        var grant = NewGrant(user, family.Id, "caregiver");
        invitation.Status = "accepted";
        invitation.AcceptedMembershipId = grant.Id;
        db.Memberships.Add(grant);
        family.Revision++;
        var result = Summary(family, grant);
        SaveReceipt(user, request.OperationId, family.Id, grant.Id, "accept-invitation", hash, result);
        return result;
    }, ct);

    public Task<OkResult> RevokeInvitation(PilotIdentity user, Guid familyId, Guid invitationId, OperationRequest request, CancellationToken ct) => Transaction(async () =>
    {
        ValidateId(request.OperationId);
        var grant = await RequireOwner(user, familyId, ct);
        var hash = Fingerprint("revoke-invitation", new { familyId, invitationId, request.OperationId });
        var old = await Receipt(user, request.OperationId, hash, ct);
        if (old is not null) return ReadResult<OkResult>(old);
        var invitation = await db.Invitations.SingleOrDefaultAsync(x => x.Id == invitationId && x.FamilyId == familyId, ct)
            ?? throw new ApiException(410, "invitation_unavailable");
        if (invitation.Status != "pending") throw new ApiException(410, "invitation_unavailable");
        // Revocation remains available after the write cap. Only an actual pending invitation
        // can create another receipt, so fresh no-op revokes cannot grow the ledger indefinitely.
        invitation.Status = "revoked";
        (await Family(familyId, ct)).Revision++;
        var result = new OkResult();
        SaveReceipt(user, request.OperationId, familyId, grant.Id, "revoke-invitation", hash, result);
        return result;
    }, ct);

    public Task<OkResult> RemoveMember(PilotIdentity user, Guid familyId, Guid memberId, OperationRequest request, CancellationToken ct) => Transaction(async () =>
    {
        ValidateId(request.OperationId);
        var grant = await RequireOwner(user, familyId, ct);
        if (memberId == user.ObjectId || memberId == Guid.Empty) Invalid();
        var hash = Fingerprint("remove-member", new { familyId, memberId, request.OperationId });
        var old = await Receipt(user, request.OperationId, hash, ct);
        if (old is not null) return ReadResult<OkResult>(old);
        var member = await db.Memberships.SingleOrDefaultAsync(x => x.FamilyId == familyId && x.UserId == memberId && x.Active, ct);
        // Also revoke unused recipient invitations when membership was already removed or never accepted.
        if (member is not null && member.Role == "owner") throw new ApiException(403, "forbidden");
        var hasPending = await db.Invitations.AnyAsync(x => x.FamilyId == familyId && x.RecipientUserId == memberId && x.Status == "pending", ct);
        if (member is null && !hasPending) Invalid();
        // Existing grants/invites can always be revoked even when ordinary writes reached the cap.
        if (member is not null) EndGrant(member);
        await RevokePending(familyId, memberId, ct);
        (await Family(familyId, ct)).Revision++;
        var result = new OkResult();
        SaveReceipt(user, request.OperationId, familyId, grant.Id, "remove-member", hash, result);
        return result;
    }, ct);

    public Task<OkResult> Leave(PilotIdentity user, Guid familyId, OperationRequest request, CancellationToken ct) => Transaction(async () =>
    {
        ValidateId(request.OperationId);
        var hash = Fingerprint("leave", new { familyId, request.OperationId });
        var old = await Receipt(user, request.OperationId, hash, ct);
        if (old is not null)
        {
            // Do not let retrying an earlier leave terminate a later, independent grant.
            return ReadResult<OkResult>(old);
        }
        var grant = await RequireGrant(user, familyId, null, ct);
        if (grant.Role == "owner") throw new ApiException(403, "forbidden");
        EndGrant(grant);
        await RevokePending(familyId, user.ObjectId, ct);
        (await Family(familyId, ct)).Revision++;
        var result = new OkResult();
        SaveReceipt(user, request.OperationId, familyId, grant.Id, "leave", hash, result);
        return result;
    }, ct);

    public Task<FeedReceipt> ApplyFeed(PilotIdentity user, Guid familyId, FeedOperation operation, CancellationToken ct) => Transaction(async () =>
    {
        ValidateFeed(operation);
        var grant = await RequireGrant(user, familyId, operation.MembershipId, ct);
        if (operation.HistoryId != config.Family.HistoryId) throw new ApiException(409, "history_changed");
        var hash = Fingerprint("feed", new { familyId, operation });
        var old = await Receipt(user, operation.OperationId, hash, ct);
        if (old is not null) return ReadResult<FeedReceipt>(old);
        await CheckCapacity(familyId, ct);
        var row = await db.Feeds.SingleOrDefaultAsync(x => x.FamilyId == familyId && x.Id == operation.RecordId, ct);
        if (operation.Kind == "create")
        {
            // Tombstones retain record IDs permanently within this history; IDs cannot resurrect.
            if (row is not null) throw new ApiException(412, "record_changed");
            if (await db.Feeds.CountAsync(x => x.FamilyId == familyId, ct) >= config.Pilot.MaxFeeds) Invalid();
            row = new FeedRow { FamilyId = familyId, Id = operation.RecordId, RecordedBy = user.ObjectId };
            db.Feeds.Add(row);
        }
        else if (row is null || row.Deleted || Convert.ToBase64String(row.Version) != operation.BaseVersion)
            throw new ApiException(412, "record_changed");
        row.LastEditedBy = user.ObjectId;
        if (operation.Kind == "delete") row.Deleted = true;
        else
        {
            row.Start = operation.Feed!.Start.ToUniversalTime();
            row.End = operation.Feed.End.ToUniversalTime();
            row.Amount = operation.Feed.Amount;
            row.Note = operation.Feed.Note;
        }
        // A distinct accepted update consumes its base version even when every value is
        // identical. Otherwise EF skips UPDATE and a second writer could also win that version.
        if (operation.Kind == "update") db.Entry(row).Property(x => x.LastEditedBy).IsModified = true;
        var family = await Family(familyId, ct);
        family.Revision++;
        var result = new FeedReceipt(operation.OperationId, config.Family.HistoryId, Revision(family));
        SaveReceipt(user, operation.OperationId, familyId, grant.Id, "feed", hash, result);
        return result;
    }, ct);

    private async Task<MembershipRow> RequireGrant(PilotIdentity user, Guid familyId, Guid? membershipId, CancellationToken ct)
    {
        var grant = await db.Memberships.SingleOrDefaultAsync(x => x.UserId == user.ObjectId && x.FamilyId == familyId && x.Active, ct)
            ?? throw new ApiException(403, "membership_revoked");
        if (membershipId is not null && grant.Id != membershipId) throw new ApiException(409, "membership_changed");
        return grant;
    }
    private async Task<MembershipRow> RequireOwner(PilotIdentity user, Guid familyId, CancellationToken ct)
    {
        var grant = await RequireGrant(user, familyId, null, ct);
        if (grant.Role != "owner") throw new ApiException(403, "forbidden");
        return grant;
    }
    private Task<FamilyRow> Family(Guid id, CancellationToken ct) => db.Families.SingleAsync(x => x.Id == id, ct);
    private MembershipRow NewGrant(PilotIdentity user, Guid familyId, string role) => new()
    {
        Id = Guid.NewGuid(),
        FamilyId = familyId,
        UserId = user.ObjectId,
        Role = role,
        GrantedAt = Now,
        DisplayName = user.DisplayName,
        Email = user.Email
    };
    private void EndGrant(MembershipRow grant) { grant.Active = false; grant.EndedAt = Now; }
    private async Task RevokePending(Guid familyId, Guid recipientId, CancellationToken ct)
    {
        foreach (var invite in await db.Invitations.Where(x => x.FamilyId == familyId && x.RecipientUserId == recipientId && x.Status == "pending").ToArrayAsync(ct))
            invite.Status = "revoked";
    }
    private async Task CheckCapacity(Guid familyId, CancellationToken ct)
    {
        if (await db.Operations.CountAsync(x => x.FamilyId == familyId, ct) >= config.Pilot.MaxOperationsPerFamily) Invalid();
    }
    private async Task<OperationRow?> Receipt(PilotIdentity user, Guid id, string hash, CancellationToken ct)
    {
        var old = await db.Operations.SingleOrDefaultAsync(x => x.UserId == user.ObjectId && x.OperationId == id, ct);
        if (old is not null && old.HistoryId != config.Family.HistoryId) throw new ApiException(409, "history_changed");
        if (old is not null && old.Fingerprint != hash) throw new ApiException(409, "operation_reused");
        return old;
    }
    private void SaveReceipt<T>(PilotIdentity user, Guid operationId, Guid familyId, Guid membershipId, string action, string hash, T result)
    {
        db.Operations.Add(new OperationRow
        {
            UserId = user.ObjectId,
            OperationId = operationId,
            FamilyId = familyId,
            MembershipId = membershipId,
            HistoryId = config.Family.HistoryId,
            Action = action,
            Fingerprint = hash,
            ResultJson = JsonSerializer.Serialize(result, Json),
            CreatedAt = Now
        });
    }
    private static T ReadResult<T>(OperationRow row) => JsonSerializer.Deserialize<T>(row.ResultJson, Json)!;
    private static FamilySummary Summary(FamilyRow family, MembershipRow grant) => new(family.Id, family.BabyName, grant.Role, grant.Id);
    private FamilyMember Member(MembershipRow row)
    {
        var binding = config.Pilot.Identities.SingleOrDefault(x => x.ObjectId == row.UserId);
        return new(row.UserId, binding?.DisplayName ?? row.DisplayName, binding?.Email ?? row.Email, row.Role, row.Id);
    }
    private static FamilyInvitation Invitation(InvitationRow row) => new(row.Id, row.Email, row.ExpiresAt, row.Status);
    private static string Revision(FamilyRow family) => family.Revision.ToString(CultureInfo.InvariantCulture);
    private static string Fingerprint<T>(string action, T value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(action + ":" + JsonSerializer.Serialize(value, Json))));
    public static string TokenHash(string token) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));
    private static string Base64Url(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    public static bool IsToken(string? token) => token is { Length: 43 } && token.All(c => char.IsAsciiLetterOrDigit(c) || c is '_' or '-');
    private static void ValidateId(Guid id) { if (id == Guid.Empty) Invalid(); }
    private static void Invalid() => throw new ApiException(422, "invalid_input");
    private void ValidateFeed(FeedOperation operation)
    {
        ValidateId(operation.OperationId); ValidateId(operation.RecordId); ValidateId(operation.MembershipId); ValidateId(operation.HistoryId);
        if (operation.Kind is not ("create" or "update" or "delete")) Invalid();
        if (operation.Kind == "create" && operation.BaseVersion is not null) Invalid();
        if (operation.Kind != "create" && (operation.BaseVersion is null || operation.BaseVersion.Length != 12 ||
            !Convert.TryFromBase64String(operation.BaseVersion, new byte[8], out var bytes) || bytes != 8)) Invalid();
        if (operation.Kind == "delete") { if (operation.Feed is not null) Invalid(); return; }
        var feed = operation.Feed;
        if (feed is null || feed.Start < DateTimeOffset.UnixEpoch || feed.End < feed.Start || feed.End > Now.AddMinutes(2) ||
            feed.Amount < 0 || feed.Amount > 2000 || decimal.Round(feed.Amount, 2) != feed.Amount ||
            feed.Note is null || feed.Note.Length > config.Pilot.MaxNoteLength ||
            feed.Note.Any(c => char.IsControl(c) && c is not ('\n' or '\r' or '\t'))) Invalid();
    }
}
