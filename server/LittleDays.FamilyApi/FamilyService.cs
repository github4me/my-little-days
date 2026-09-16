using System.Data;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;

namespace LittleDays.FamilyApi;

public sealed partial class FamilyService(PilotDatabase db, PilotConfiguration config, TimeProvider clock)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private DateTimeOffset Now => clock.GetUtcNow();

    // All families currently share ONE SQL transaction-owned application lock.
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
        var deletion = await db.AccountDeletions.FindAsync([user.ObjectId], ct);
        if (deletion is not null) return new MeResult(new(user.ObjectId, "", ""), [], [], new(deletion.OperationId, deletion.Status, deletion.RequestedAt));
        var memberships = await db.Memberships.Where(x => x.UserId == user.ObjectId && x.Active).ToArrayAsync(ct);
        var ids = memberships.Select(x => x.FamilyId).ToArray();
        var families = await db.Families.Where(x => ids.Contains(x.Id) && x.DeletedAt == null).ToArrayAsync(ct);
        var now = Now;
        var inbox = await (from invitation in db.Invitations
            join family in db.Families on invitation.FamilyId equals family.Id
            join owner in db.Memberships on family.Id equals owner.FamilyId
            where invitation.Email == user.Email && invitation.Status == "pending" && invitation.ExpiresAt > now &&
                family.DeletedAt == null && owner.Active && owner.Role == "owner"
            orderby invitation.CreatedAt descending
            select new PendingFamilyInvitation(invitation.Id, family.Id, owner.DisplayName, invitation.ExpiresAt)).ToArrayAsync(ct);
        return new MeResult(new(user.ObjectId, user.DisplayName, user.Email),
            families.Select(x => Summary(x, memberships.Single(m => m.FamilyId == x.Id))).ToArray(), families.Length == 0 ? inbox : [], null);
    }, ct);

    public Task<FamilySummary> CreateFamily(PilotIdentity user, CreateFamilyRequest request, CancellationToken ct) => Transaction(async () =>
    {
        await RequireAccount(user, ct);
        ValidateId(request.OperationId);
        if (request.BabyName is null || request.BabyName.Trim().Length < 1 ||
            request.BabyName.Length > config.Pilot.MaxBabyNameLength || request.BabyName.Any(char.IsControl)) Invalid();
        var hash = Fingerprint("create-family", request);
        var old = await Receipt(user, request.OperationId, hash, ct);
        if (old is not null)
        {
            var existingGrant = await RequireGrant(user, old.FamilyId, old.MembershipId, ct);
            return Summary(await Family(old.FamilyId, ct), existingGrant);
        }
        if (await db.Memberships.AnyAsync(x => x.UserId == user.ObjectId && x.Active, ct))
            throw new ApiException(409, "already_in_family");
        // The legacy creation contract has no consent option. Require the reviewed
        // full-family flow when creating would also reject incoming invitations.
        if (await LiveReceivedInvitations(user, Now).AnyAsync(ct))
            throw new ApiException(409, "invitation_decline_consent_required");
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
        var members = await db.Memberships.Where(x => x.FamilyId == familyId && (x.Active || grant.Role == "owner")).OrderBy(x => x.GrantedAt).ToArrayAsync(ct);
        var feeds = await db.Feeds.Where(x => x.FamilyId == familyId && !x.Deleted).OrderByDescending(x => x.Start).ThenBy(x => x.Id).ToArrayAsync(ct);
        // Only the owner receives recipient emails and invitation administration state.
        var invitations = grant.Role == "owner"
            ? await db.Invitations.Where(x => x.FamilyId == familyId)
                .OrderBy(x => x.Status == "pending" ? 0 : 1).ThenByDescending(x => x.CreatedAt).Take(100).ToArrayAsync(ct)
            : [];
        var transfer = await db.OwnershipTransfers.SingleOrDefaultAsync(x => x.FamilyId == familyId && x.Status == "pending", ct);
        return new FamilySnapshot(Summary(family, grant), config.Family.HistoryId, Revision(family),
            members.Select(x => Member(x, grant.Role == "owner")).ToArray(), invitations.Select(Invitation).ToArray(),
            feeds.Select(x => new SharedFeed(x.Id, Convert.ToBase64String(x.Version), x.RecordedBy, x.LastEditedBy,
                x.Start, x.End, x.Amount, x.Note)).ToArray(), transfer is null ? null : Transfer(transfer));
    }, ct);

    public Task<InvitationResult> CreateInvitation(PilotIdentity user, Guid familyId, CreateInvitationRequest request, CancellationToken ct) => Transaction(async () =>
    {
        ValidateId(request.OperationId);
        var grant = await RequireOwner(user, familyId, ct);
        RequireContext(request, grant);
        var email = PilotConfiguration.NormalizeEmail(request.Email);
        if (!PilotConfiguration.IsEmail(email)) Invalid();
        if (email == user.Email) Invalid();
        var hash = Fingerprint("create-invitation", new { familyId, request.OperationId, email, request.MembershipId, request.HistoryId });
        var old = await Receipt(user, request.OperationId, hash, ct);
        if (old is not null)
        {
            var priorId = ReadResult<InvitationReceipt>(old).InvitationId;
            var prior = await db.Invitations.SingleOrDefaultAsync(x => x.Id == priorId && x.FamilyId == familyId, ct)
                ?? throw new ApiException(410, "invitation_unavailable");
            return new InvitationResult(Invitation(prior));
        }
        await CheckCapacity(familyId, ct);
        var now = Now;
        // Count only this family's known members and live reservations. Never look up
        // an arbitrary email's registration or membership in a different family.
        var activeEmails = await db.Memberships.Where(x => x.FamilyId == familyId && x.Active).Select(x => x.Email).ToArrayAsync(ct);
        if (activeEmails.Contains(email, StringComparer.Ordinal))
            throw new ApiException(409, "invitation_already_created");
        var pendingEmails = await db.Invitations.Where(x => x.FamilyId == familyId && x.Status == "pending" && x.ExpiresAt > now)
            .Select(x => x.Email).Distinct().ToArrayAsync(ct);
        // Replacing an existing live invitation adds no capacity, even if a legacy
        // family already exceeds today's limit. Terminal/expired invitations do not reserve a slot.
        if (!pendingEmails.Contains(email, StringComparer.Ordinal) &&
            activeEmails.Length + pendingEmails.Except(activeEmails, StringComparer.Ordinal).Count() >= config.Pilot.EffectiveMaxMembers)
            throw new ApiException(409, "invitation_limit");
        foreach (var prior in await db.Invitations.Where(x => x.FamilyId == familyId && x.Email == email && x.Status == "pending").ToArrayAsync(ct))
            prior.Status = "revoked";
        // Flush revocation before inserting into the unique pending-recipient index, still in this transaction.
        await db.SaveChangesAsync(ct);
        var row = new InvitationRow
        {
            Id = Guid.NewGuid(),
            FamilyId = familyId,
            Email = email,
            CreatedAt = Now,
            ExpiresAt = Now.AddDays(30)
        };
        db.Invitations.Add(row);
        var family = await Family(familyId, ct);
        family.Revision++;
        var result = new InvitationResult(Invitation(row));
        SaveReceipt(user, request.OperationId, familyId, grant.Id, "create-invitation", hash, new InvitationReceipt(row.Id));
        return result;
    }, ct);

    public Task<FamilySummary> UpdateProfile(PilotIdentity user, Guid familyId, ProfileRequest request, CancellationToken ct) => Transaction(async () =>
    {
        ValidateId(request.OperationId);
        var grant = await RequireOwner(user, familyId, ct);
        RequireContext(request, grant);
        RequireLegacyFamily(await Family(familyId, ct));
        if (request.BabyName is null || request.BabyName.Trim().Length < 1 || request.BabyName.Length > config.Pilot.MaxBabyNameLength || request.BabyName.Any(char.IsControl)) Invalid();
        if (request.BabyBirthDate is not null && (!DateOnly.TryParseExact(request.BabyBirthDate, "yyyy-MM-dd", CultureInfo.InvariantCulture,
            DateTimeStyles.None, out var birthDate) || birthDate < new DateOnly(1970, 1, 1) || birthDate > DateOnly.FromDateTime(Now.UtcDateTime.AddDays(1)))) Invalid();
        var hash = Fingerprint("profile", new { familyId, request });
        var old = await Receipt(user, request.OperationId, hash, ct);
        if (old is not null) return Summary(await Family(familyId, ct), grant);
        await CheckCapacity(familyId, ct);
        var family = await Family(familyId, ct);
        if (Revision(family) != request.BaseVersion) throw new ApiException(412, "profile_changed");
        family.BabyName = request.BabyName!.Trim();
        family.BabyBirthDate = request.BabyBirthDate;
        family.Revision++;
        // Profile receipts contain no profile data; retries return the authorized current profile.
        SaveReceipt(user, request.OperationId, familyId, grant.Id, "profile", hash, new OkResult());
        return Summary(family, grant);
    }, ct);

    public Task<OwnershipTransfer> NominateOwner(PilotIdentity user, Guid familyId, NominateOwnerRequest request, CancellationToken ct) => Transaction(async () =>
    {
        ValidateId(request.OperationId); ValidateId(request.UserId);
        var grant = await RequireOwner(user, familyId, ct);
        RequireContext(request, grant);
        var hash = Fingerprint("nominate-owner", new { familyId, request });
        var old = await Receipt(user, request.OperationId, hash, ct);
        if (old is not null)
        {
            var result = ReadResult<OwnershipTransfer>(old);
            if (!await db.OwnershipTransfers.AnyAsync(x => x.Id == result.Id && x.Status == "pending", ct))
                throw new ApiException(409, "transfer_unavailable");
            return result;
        }
        var nominee = await db.Memberships.SingleOrDefaultAsync(x => x.FamilyId == familyId && x.UserId == request.UserId && x.Active, ct);
        await CheckCapacity(familyId, ct);
        if (nominee is null || nominee.UserId == user.ObjectId) Invalid();
        if (await db.OwnershipTransfers.AnyAsync(x => x.FamilyId == familyId && x.Status == "pending", ct))
            throw new ApiException(409, "transfer_pending");
        var row = new OwnershipTransferRow
        {
            Id = Guid.NewGuid(), FamilyId = familyId, FromUserId = user.ObjectId, ToUserId = nominee!.UserId,
            FromMembershipId = grant.Id, ToMembershipId = nominee.Id, CreatedAt = Now
        };
        db.OwnershipTransfers.Add(row);
        (await Family(familyId, ct)).Revision++;
        var resultNew = Transfer(row);
        SaveReceipt(user, request.OperationId, familyId, grant.Id, "nominate-owner", hash, resultNew);
        return resultNew;
    }, ct);

    public Task<OkResult> AcceptOwnership(PilotIdentity user, Guid familyId, Guid transferId, OperationRequest request, CancellationToken ct) => Transaction(async () =>
    {
        ValidateId(request.OperationId);
        var grant = await RequireGrant(user, familyId, null, ct);
        RequireContext(request, grant);
        var hash = Fingerprint("accept-owner", new { familyId, transferId, request });
        var old = await Receipt(user, request.OperationId, hash, ct);
        if (old is not null)
        {
            if (old.MembershipId != grant.Id) throw new ApiException(409, "membership_changed");
            return ReadResult<OkResult>(old);
        }
        var transfer = await db.OwnershipTransfers.SingleOrDefaultAsync(x => x.Id == transferId && x.FamilyId == familyId, ct);
        if (transfer is null || transfer.Status != "pending" || transfer.ToUserId != user.ObjectId || transfer.ToMembershipId != grant.Id)
            throw new ApiException(409, "transfer_unavailable");
        var owner = await db.Memberships.SingleOrDefaultAsync(x => x.Id == transfer.FromMembershipId && x.Active && x.Role == "owner", ct);
        if (owner is null || grant.Role != "caregiver") throw new ApiException(409, "transfer_unavailable");
        owner.Role = "caregiver";
        grant.Role = "owner";
        transfer.Status = "accepted";
        (await Family(familyId, ct)).Revision++;
        var result = new OkResult();
        SaveReceipt(user, request.OperationId, familyId, grant.Id, "accept-owner", hash, result);
        return result;
    }, ct);

    public Task<OkResult> CancelOwnership(PilotIdentity user, Guid familyId, Guid transferId, OperationRequest request, CancellationToken ct) => Transaction(async () =>
    {
        ValidateId(request.OperationId);
        var grant = await RequireOwner(user, familyId, ct);
        RequireContext(request, grant);
        var hash = Fingerprint("cancel-owner", new { familyId, transferId, request });
        var old = await Receipt(user, request.OperationId, hash, ct);
        if (old is not null) return ReadResult<OkResult>(old);
        var transfer = await db.OwnershipTransfers.SingleOrDefaultAsync(x => x.Id == transferId && x.FamilyId == familyId && x.Status == "pending", ct)
            ?? throw new ApiException(409, "transfer_unavailable");
        transfer.Status = "cancelled";
        (await Family(familyId, ct)).Revision++;
        var result = new OkResult();
        SaveReceipt(user, request.OperationId, familyId, grant.Id, "cancel-owner", hash, result);
        return result;
    }, ct);

    public Task<OkResult> CloseFamily(PilotIdentity user, Guid familyId, OperationRequest request, CancellationToken ct) => Transaction(async () =>
    {
        await RequireAccount(user, ct);
        ValidateId(request.OperationId);
        var family = await db.Families.SingleOrDefaultAsync(x => x.Id == familyId, ct)
            ?? throw new ApiException(403, "membership_revoked");
        if (family.DeletedAt is not null)
        {
            if (family.DeletedBy == user.ObjectId && family.DeleteOperationId == request.OperationId) return new OkResult();
            throw new ApiException(403, "membership_revoked");
        }
        var grant = await RequireOwner(user, familyId, ct);
        RequireContext(request, grant);
        if (await db.Memberships.AnyAsync(x => x.FamilyId == familyId && x.Active && x.Id != grant.Id, ct))
            throw new ApiException(409, "family_has_members");
        // Keep the closure receipt in the family tombstone so cleanup cannot permit replay.
        var hash = Fingerprint("close-family", new { familyId, request.OperationId });
        await Receipt(user, request.OperationId, hash, ct);
        family.DeletedAt = Now; family.DeletedBy = user.ObjectId; family.DeleteOperationId = request.OperationId;
        family.Revision++;
        EndGrant(grant, "left");
        await InvalidateTransfers(familyId, user.ObjectId, ct);
        foreach (var invite in await db.Invitations.Where(x => x.FamilyId == familyId && x.Status == "pending").ToArrayAsync(ct)) invite.Status = "revoked";
        return new OkResult();
    }, ct);

    public Task<AccountDeletion> DeleteAccount(PilotIdentity user, DeleteAccountRequest request, CancellationToken ct) => Transaction(async () =>
    {
        ValidateId(request.OperationId);
        var receiptHash = ReceiptSecretHash(request.ReceiptSecret);
        var old = await db.AccountDeletions.FindAsync([user.ObjectId], ct);
        if (old is not null)
        {
            if (old.OperationId != request.OperationId || old.ReceiptHash != receiptHash) throw new ApiException(409, "operation_reused");
            return new AccountDeletion(old.OperationId, old.Status, old.RequestedAt);
        }
        if (await db.AccountDeletions.AnyAsync(x => x.OperationId == request.OperationId, ct)) throw new ApiException(409, "operation_reused");
        await Receipt(user, request.OperationId, Fingerprint("delete-account", new { request.OperationId, receiptHash }), ct);
        if (await db.Memberships.AnyAsync(x => x.UserId == user.ObjectId && x.Active && x.Role == "owner", ct))
            throw new ApiException(409, "family_owner_cannot_delete");
        var row = new AccountDeletionRow { UserId = user.ObjectId, OperationId = request.OperationId, RequestedAt = Now, ReceiptHash = receiptHash, PendingEmail = user.Email };
        db.AccountDeletions.Add(row);
        foreach (var grant in await db.Memberships.Where(x => x.UserId == user.ObjectId && x.Active).ToArrayAsync(ct))
        {
            EndGrant(grant, "left");
            (await Family(grant.FamilyId, ct)).Revision++;
            await InvalidateTransfers(grant.FamilyId, user.ObjectId, ct);
        }
        // API access is denied as soon as this transaction commits; content cleanup is durable/retryable.
        return new AccountDeletion(row.OperationId, row.Status, row.RequestedAt);
    }, ct);

    public Task<AccountDeletion> DeletionStatus(DeletionStatusRequest request, CancellationToken ct) => Transaction(async () =>
    {
        if (!IsReceiptSecret(request.ReceiptSecret)) throw new ApiException(404, "deletion_unavailable");
        var hash = ReceiptSecretHash(request.ReceiptSecret);
        var row = await db.AccountDeletions.SingleOrDefaultAsync(x => x.OperationId == request.DeletionId, ct);
        if (row is null || !CryptographicOperations.FixedTimeEquals(Convert.FromHexString(row.ReceiptHash), Convert.FromHexString(hash)))
            throw new ApiException(404, "deletion_unavailable");
        return new AccountDeletion(row.OperationId, row.Status, row.RequestedAt);
    }, ct);
    private static bool IsReceiptSecret(string? secret) => secret is { Length: 64 } && secret.All(char.IsAsciiHexDigit);
    private static string ReceiptSecretHash(string secret)
    {
        if (!IsReceiptSecret(secret)) Invalid();
        return Convert.ToHexString(SHA256.HashData(Encoding.ASCII.GetBytes(secret.ToLowerInvariant())));
    }

    private async Task InvalidateTransfers(Guid familyId, Guid userId, CancellationToken ct)
    {
        foreach (var transfer in await db.OwnershipTransfers.Where(x => x.FamilyId == familyId && x.Status == "pending" &&
            (x.FromUserId == userId || x.ToUserId == userId)).ToArrayAsync(ct)) transfer.Status = "cancelled";
    }
    private static OwnershipTransfer Transfer(OwnershipTransferRow row) => new(row.Id, row.FromUserId, row.ToUserId, row.Status, row.CreatedAt);
    private sealed record InvitationReceipt(Guid InvitationId);

    public Task<FamilySummary> AcceptInvitation(PilotIdentity user, Guid invitationId, OperationRequest request, CancellationToken ct) => Transaction(async () =>
    {
        await RequireAccount(user, ct);
        ValidateId(request.OperationId);
        // Preserve old durable receipts when clients omit both new options.
        var hash = request.RequiredExtrasSchemaVersion is not null
            ? Fingerprint("accept-invitation", new { request.OperationId, invitationId, request.DeclineOtherInvitations, request.RequiredSchemaVersion, request.RequiredExtrasSchemaVersion })
            : request.DeclineOtherInvitations || request.RequiredSchemaVersion is not null
            ? Fingerprint("accept-invitation", new { request.OperationId, invitationId, request.DeclineOtherInvitations, request.RequiredSchemaVersion })
            : Fingerprint("accept-invitation", new { request.OperationId, invitationId });
        var old = await Receipt(user, request.OperationId, hash, ct);
        if (old is not null)
        {
            // An accepted-invitation retry is valid only while that exact membership grant exists.
            var existingGrant = await RequireGrant(user, old.FamilyId, old.MembershipId, ct);
            return Summary(await Family(old.FamilyId, ct), existingGrant);
        }
        var invitation = await db.Invitations.SingleOrDefaultAsync(x => x.Id == invitationId, ct);
        if (invitation is null || invitation.Email != user.Email ||
            invitation.Status != "pending" || invitation.ExpiresAt <= Now)
            throw new ApiException(410, "invitation_unavailable");
        if (await db.Memberships.AnyAsync(x => x.UserId == user.ObjectId && x.Active, ct))
            throw new ApiException(409, "already_in_family");
        var family = await Family(invitation.FamilyId, ct);
        // A full-history client cannot use a legacy family. Reject before creating a
        // membership or declining another invitation so it can choose a valid family.
        if (request.RequiredSchemaVersion is not null && request.RequiredSchemaVersion != family.SchemaVersion ||
            request.RequiredExtrasSchemaVersion is not null && (request.RequiredExtrasSchemaVersion != 1 || family.SchemaVersion != 2))
            throw new ApiException(409, "family_schema_unsupported");
        // Acceptance consumes its existing reservation, so excess legacy pending
        // invitations need not be deleted. Active membership may never grow past the cap.
        if (await db.Memberships.CountAsync(x => x.FamilyId == invitation.FamilyId && x.Active, ct) >= config.Pilot.EffectiveMaxMembers)
            throw new ApiException(409, "invitation_limit");
        await CheckCapacity(invitation.FamilyId, ct);
        var others = await LiveReceivedInvitations(user, Now).Where(x => x.Id != invitationId).ToArrayAsync(ct);
        if (others.Length > 0 && !request.DeclineOtherInvitations)
            throw new ApiException(409, "invitation_decline_consent_required");
        foreach (var other in others)
        {
            other.Status = "joined_alt";
            other.RecipientUserId = user.ObjectId;
        }
        foreach (var sourceFamilyId in others.Select(x => x.FamilyId).Distinct())
            (await Family(sourceFamilyId, ct)).Revision++;
        var grant = NewGrant(user, family.Id, "caregiver");
        invitation.RecipientUserId = user.ObjectId;
        invitation.Status = "accepted";
        invitation.AcceptedMembershipId = grant.Id;
        db.Memberships.Add(grant);
        family.Revision++;
        var result = Summary(family, grant);
        SaveReceipt(user, request.OperationId, family.Id, grant.Id, "accept-invitation", hash, result);
        return result;
    }, ct);

    public Task<OkResult> DeclineInvitation(PilotIdentity user, Guid invitationId, OperationRequest request, CancellationToken ct) => Transaction(async () =>
    {
        await RequireAccount(user, ct);
        ValidateId(request.OperationId);
        var hash = Fingerprint("decline-invitation", new { request.OperationId, invitationId });
        var old = await Receipt(user, request.OperationId, hash, ct);
        if (old is not null) return ReadResult<OkResult>(old);
        var invitation = await db.Invitations.SingleOrDefaultAsync(x => x.Id == invitationId, ct);
        if (invitation is null || invitation.Email != user.Email || invitation.Status != "pending" || invitation.ExpiresAt <= Now)
            throw new ApiException(410, "invitation_unavailable");
        var family = await Family(invitation.FamilyId, ct);
        invitation.Status = "declined";
        invitation.RecipientUserId = user.ObjectId;
        family.Revision++;
        var result = new OkResult();
        SaveReceipt(user, request.OperationId, family.Id, Guid.Empty, "decline-invitation", hash, result);
        return result;
    }, ct);

    public Task<OkResult> RevokeInvitation(PilotIdentity user, Guid familyId, Guid invitationId, OperationRequest request, CancellationToken ct) => Transaction(async () =>
    {
        ValidateId(request.OperationId);
        var grant = await RequireOwner(user, familyId, ct);
        RequireContext(request, grant);
        var hash = Fingerprint("revoke-invitation", new { familyId, invitationId, request });
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
        RequireContext(request, grant);
        if (memberId == user.ObjectId || memberId == Guid.Empty) Invalid();
        var hash = Fingerprint("remove-member", new { familyId, memberId, request });
        var old = await Receipt(user, request.OperationId, hash, ct);
        if (old is not null) return ReadResult<OkResult>(old);
        var member = await db.Memberships.SingleOrDefaultAsync(x => x.FamilyId == familyId && x.UserId == memberId && x.Active, ct);
        if (member is not null && member.Role == "owner") throw new ApiException(403, "forbidden");
        if (member is null || request.TargetMembershipId != member.Id) throw new ApiException(409, "member_changed");
        // Existing grants/invites can always be revoked even when ordinary writes reached the cap.
        EndGrant(member, "removed");
        await RevokePending(familyId, memberId, ct);
        await InvalidateTransfers(familyId, memberId, ct);
        (await Family(familyId, ct)).Revision++;
        var result = new OkResult();
        SaveReceipt(user, request.OperationId, familyId, grant.Id, "remove-member", hash, result);
        return result;
    }, ct);

    public Task<OkResult> Leave(PilotIdentity user, Guid familyId, OperationRequest request, CancellationToken ct) => Transaction(async () =>
    {
        await RequireAccount(user, ct);
        ValidateId(request.OperationId);
        var hash = Fingerprint("leave", new { familyId, request });
        var old = await Receipt(user, request.OperationId, hash, ct);
        if (old is not null)
        {
            // Do not let retrying an earlier leave terminate a later, independent grant.
            return ReadResult<OkResult>(old);
        }
        var grant = await RequireGrant(user, familyId, null, ct);
        RequireContext(request, grant);
        if (grant.Role == "owner") throw new ApiException(403, "forbidden");
        EndGrant(grant, "left");
        await RevokePending(familyId, user.ObjectId, ct);
        await InvalidateTransfers(familyId, user.ObjectId, ct);
        (await Family(familyId, ct)).Revision++;
        var result = new OkResult();
        SaveReceipt(user, request.OperationId, familyId, grant.Id, "leave", hash, result);
        return result;
    }, ct);

    public Task<FeedReceipt> ApplyFeed(PilotIdentity user, Guid familyId, FeedOperation operation, CancellationToken ct) => Transaction(async () =>
    {
        ValidateFeed(operation);
        var grant = await RequireGrant(user, familyId, operation.MembershipId, ct);
        RequireLegacyFamily(await Family(familyId, ct));
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
        if (operation.Kind != "create" && grant.Role != "owner" && row.RecordedBy != user.ObjectId)
            throw new ApiException(403, "record_forbidden");
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
        await RequireAccount(user, ct);
        if (!await db.Families.AnyAsync(x => x.Id == familyId && x.DeletedAt == null, ct))
            throw new ApiException(403, "membership_revoked");
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
    private async Task<FamilyRow> Family(Guid id, CancellationToken ct) => await db.Families.SingleOrDefaultAsync(x => x.Id == id && x.DeletedAt == null, ct)
        ?? throw new ApiException(403, "membership_revoked");
    private IQueryable<InvitationRow> LiveReceivedInvitations(PilotIdentity user, DateTimeOffset now) =>
        from invitation in db.Invitations
        join family in db.Families on invitation.FamilyId equals family.Id
        where invitation.Email == user.Email && invitation.Status == "pending" && invitation.ExpiresAt > now && family.DeletedAt == null
        select invitation;
    private async Task RequireAccount(PilotIdentity user, CancellationToken ct)
    {
        if (await db.AccountDeletions.AnyAsync(x => x.UserId == user.ObjectId, ct)) throw new ApiException(410, "account_deleted");
    }
    private void RequireContext(IGrantContext request, MembershipRow grant)
    {
        if (request.MembershipId is null || request.HistoryId is null) Invalid();
        if (request.HistoryId != config.Family.HistoryId) throw new ApiException(409, "history_changed");
        if (request.MembershipId != grant.Id) throw new ApiException(409, "membership_changed");
    }
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
    private void EndGrant(MembershipRow grant, string status) { grant.Active = false; grant.EndedAt = Now; grant.Status = status; }
    private async Task RevokePending(Guid familyId, Guid recipientId, CancellationToken ct)
    {
        var email = await db.Memberships.Where(x => x.FamilyId == familyId && x.UserId == recipientId)
            .OrderByDescending(x => x.GrantedAt).Select(x => x.Email).FirstOrDefaultAsync(ct);
        foreach (var invite in await db.Invitations.Where(x => x.FamilyId == familyId && (x.RecipientUserId == recipientId || x.Email == email) && x.Status == "pending").ToArrayAsync(ct))
            invite.Status = "revoked";
    }
    private async Task CheckCapacity(Guid familyId, CancellationToken ct)
    {
        if (await db.Operations.CountAsync(x => x.FamilyId == familyId, ct) >= config.Pilot.MaxOperationsPerFamily) Invalid();
    }
    private async Task<OperationRow?> Receipt(PilotIdentity user, Guid id, string hash, CancellationToken ct)
    {
        if (await db.Families.AnyAsync(x => x.DeletedBy == user.ObjectId && x.DeleteOperationId == id, ct))
            throw new ApiException(409, "operation_reused");
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
    private static FamilySummary Summary(FamilyRow family, MembershipRow grant) => new(family.Id, family.BabyName, grant.Role, grant.Id, family.BabyBirthDate,
        family.SchemaVersion == 2 ? Convert.ToBase64String(family.ProfileVersion) : Revision(family));
    private FamilyMember Member(MembershipRow row, bool owner)
    {
        var binding = config.Admission.Mode == "Static" ? config.Pilot.Identities.SingleOrDefault(x => x.ObjectId == row.UserId) : null;
        return new(row.UserId, binding?.DisplayName ?? row.DisplayName, owner ? binding?.Email ?? row.Email : null, row.Role, row.Id, row.Status, row.EndedAt);
    }
    private static FamilyInvitation Invitation(InvitationRow row) => new(row.Id, row.Email, row.ExpiresAt,
        row.Status is "own_family" or "joined_alt" ? "declined" : row.Status,
        row.Status switch { "own_family" => "created_family", "joined_alt" => "joined_family", _ => null },
        row.AcceptedMembershipId);
    private static string Revision(FamilyRow family) => family.Revision.ToString(CultureInfo.InvariantCulture);
    private static string Fingerprint<T>(string action, T value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(action + ":" + JsonSerializer.Serialize(value, Json))));
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
