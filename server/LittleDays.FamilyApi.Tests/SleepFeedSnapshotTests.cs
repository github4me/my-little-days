using System.Data.Common;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace LittleDays.FamilyApi.Tests;

public sealed class SleepFeedSnapshotTests(SqlFixture sql) : IClassFixture<SqlFixture>
{
    [Fact]
    public async Task SleepFeedRouteRequiresAuthenticationAndAdmissionBeforeAnyFamilyRead()
    {
        var s = new Scenario(sql);
        await using var host = new TestHost(s.Config);
        using var client = host.CreateClient();
        var path = $"/v2/families/{Guid.NewGuid()}/sleep-feed-snapshot";
        await AssertError(client, path, HttpStatusCode.Unauthorized, "unauthorized");
        client.DefaultRequestHeaders.Authorization = new("Bearer", host.Token(s.Owner, scope: "openid"));
        await AssertError(client, path, HttpStatusCode.Unauthorized, "unauthorized");
        client.DefaultRequestHeaders.Authorization = new("Bearer", host.Token(new()
        {
            ObjectId = Guid.NewGuid(), Email = s.Owner.Email
        }));
        await AssertError(client, path, HttpStatusCode.Forbidden, "pilot_not_admitted");
    }

    [Fact]
    public async Task SleepFeedRouteRetainsTheRestoreMaintenanceGate()
    {
        var s = new Scenario(sql);
        await using var host = new TestHost(s.Config,
            overrides: new Dictionary<string, string?> { ["Recovery:Blocked"] = "true" });
        using var client = host.CreateClient();
        client.DefaultRequestHeaders.Authorization = new("Bearer", host.Token(s.Owner));
        await AssertError(client, $"/v2/families/{Guid.NewGuid()}/sleep-feed-snapshot",
            HttpStatusCode.ServiceUnavailable, "recovery_blocked");
    }

    [Fact]
    public void SleepFeedContractContainsOnlyScopedRecordDataAndPreservesMetadata()
    {
        var author = Guid.NewGuid();
        var editor = Guid.NewGuid();
        var previous = new ReplacedEntrySummary("local-sleep", "sleep", DateTimeOffset.Parse("2026-09-01T10:00:00Z"));
        var replacement = new SharedRecordReplacement(editor, author, DateTimeOffset.Parse("2026-09-02T01:00:00Z"), previous);
        var entry = new SharedEntry(FullDomainTests.Entries()[3], "AAAAAAAAAAE=", author, editor, editor, replacement);
        var snapshot = new SleepFeedSnapshot(1, Guid.NewGuid(), editor, Guid.NewGuid(), Guid.NewGuid(), "caregiver", "42", [entry]);
        var json = JsonSerializer.SerializeToElement(snapshot, FamilyAvailability.SnapshotJson);
        Assert.Equal(["entries", "familyId", "historyId", "membershipId", "revision", "role", "schemaVersion", "userId"],
            json.EnumerateObject().Select(property => property.Name).Order().ToArray());
        Assert.Equal(1, json.GetProperty("schemaVersion").GetInt32());
        Assert.Equal(snapshot.FamilyId, json.GetProperty("familyId").GetGuid());
        Assert.Equal(snapshot.UserId, json.GetProperty("userId").GetGuid());
        Assert.Equal(snapshot.MembershipId, json.GetProperty("membershipId").GetGuid());
        Assert.Equal(snapshot.HistoryId, json.GetProperty("historyId").GetGuid());
        Assert.Equal("caregiver", json.GetProperty("role").GetString());
        Assert.Equal("42", json.GetProperty("revision").GetString());
        var record = Assert.Single(json.GetProperty("entries").EnumerateArray());
        Assert.Equal("AAAAAAAAAAE=", record.GetProperty("version").GetString());
        Assert.Equal(author, record.GetProperty("recordedBy").GetGuid());
        Assert.Equal(editor, record.GetProperty("lastEditedBy").GetGuid());
        Assert.Equal(editor, record.GetProperty("endedBy").GetGuid());
        Assert.Equal(editor, record.GetProperty("replacement").GetProperty("replacedBy").GetGuid());
        Assert.Equal("local-sleep", record.GetProperty("entry").GetProperty("id").GetString());
    }

    [SqlFact]
    public async Task OwnerAndCaregiverReceiveOnlyLiveSleepFeedRecordsWithCurrentScopeAndOriginalVersions()
    {
        var s = new Scenario(sql);
        var created = await Create(s);
        var caregiver = await Join(s, created);
        var deleted = created.Snapshot.Entries.Single(item => Id(item) == "local-breast");
        await s.Call(service => service.ApplyFullRecord(s.Owner, created.FamilyId,
            new(Guid.NewGuid(), Id(deleted), created.MembershipId, created.HistoryId,
                "delete", "entry", deleted.Version, null, null), default));
        var full = await s.Call(service => service.FullSnapshot(s.Owner, created.FamilyId, default));
        await using var host = new TestHost(s.Config, sql.ConnectionString);
        foreach (var (user, grant, role) in new[]
        {
            (s.Owner, created.MembershipId, "owner"), (s.Caregiver, caregiver.MembershipId, "caregiver")
        })
        {
            using var client = host.CreateClient();
            client.DefaultRequestHeaders.Authorization = new("Bearer", host.Token(user));
            using var response = await client.GetAsync($"/v2/families/{created.FamilyId}/sleep-feed-snapshot");
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            Assert.Equal("no-store", response.Headers.CacheControl!.ToString());
            var partial = (await response.Content.ReadFromJsonAsync<SleepFeedSnapshot>())!;
            Assert.Equal(1, partial.SchemaVersion);
            Assert.Equal(created.FamilyId, partial.FamilyId);
            Assert.Equal(user.ObjectId, partial.UserId);
            Assert.Equal(grant, partial.MembershipId);
            Assert.Equal(created.HistoryId, partial.HistoryId);
            Assert.Equal(role, partial.Role);
            Assert.Equal(full.Revision, partial.Revision);
            Assert.Equal(["local-bottle", "local-sleep"], partial.Entries.Select(Id).ToArray());
            foreach (var record in partial.Entries)
                Assert.Equal(Serialize(full.Entries.Single(item => Id(item) == Id(record))), Serialize(record));
            var body = await response.Content.ReadAsStringAsync();
            Assert.DoesNotContain("careRecords", body);
            Assert.DoesNotContain("extraRecords", body);
            Assert.DoesNotContain("profile", body);
            Assert.DoesNotContain("invitations", body);
            Assert.DoesNotContain("data:image", body);
        }
        var after = await s.Call(service => service.FullSnapshot(s.Owner, created.FamilyId, default));
        Assert.Equal(Serialize(full), Serialize(after));
        Assert.Equal(5, after.Entries.Length);
        Assert.Single(after.CareRecords);
        Assert.Equal(5, after.ExtraRecords!.Length);
    }

    [SqlFact]
    public async Task ScopedReadPreservesTimerCompletionAndConflictReplacementProvenance()
    {
        var s = new Scenario(sql);
        var created = await Create(s);
        await Join(s, created);
        await using (var db = sql.Open())
        {
            var row = await db.FamilyRecords.SingleAsync(item => item.FamilyId == created.FamilyId && item.Id == "local-sleep");
            row.LastEditedBy = s.Caregiver.ObjectId;
            row.TimerEndedBy = s.Caregiver.ObjectId;
            row.ConflictReplacedBy = s.Owner.ObjectId;
            row.ConflictPreviousEditedBy = s.Caregiver.ObjectId;
            row.ConflictReplacedAt = DateTimeOffset.Parse("2026-09-02T01:00:00Z");
            row.ConflictPreviousJson = Serialize(new ReplacedEntrySummary("local-sleep", "sleep",
                DateTimeOffset.Parse("2026-09-01T10:00:00Z"), DateTimeOffset.Parse("2026-09-01T10:30:00Z")));
            await db.SaveChangesAsync();
        }
        var full = await s.Call(service => service.FullSnapshot(s.Owner, created.FamilyId, default));
        var result = await s.Call(service => service.SleepFeedSnapshot(s.Owner, created.FamilyId, default));
        var record = result.Entries.Single(item => Id(item) == "local-sleep");
        Assert.Equal(Serialize(full.Entries.Single(item => Id(item) == "local-sleep")), Serialize(record));
        Assert.Equal(s.Caregiver.ObjectId, record.EndedBy);
        Assert.Equal(s.Owner.ObjectId, record.Replacement!.ReplacedBy);
        Assert.Equal(s.Owner.ObjectId, record.RecordedBy);
        Assert.Equal(s.Caregiver.ObjectId, record.LastEditedBy);
    }

    [SqlFact]
    public async Task ScopedReadLoadsNoOtherRecordBodiesAndDoesNotExpireInvitationsOrWriteData()
    {
        var s = new Scenario(sql);
        var created = await Create(s);
        string before;
        await using (var db = sql.Open())
        {
            var invitation = await db.Invitations.SingleAsync(item => item.FamilyId == created.FamilyId);
            invitation.ExpiresAt = DateTimeOffset.UtcNow.AddDays(-1);
            await db.SaveChangesAsync();
            before = await DatabaseState(db, created.FamilyId);
        }
        var probe = new QueryProbe();
        await using (var db = new PilotDatabase(new DbContextOptionsBuilder<PilotDatabase>()
            .UseSqlServer(sql.ConnectionString).AddInterceptors(probe).Options))
        {
            var result = await new FamilyService(db, s.Config, TimeProvider.System).SleepFeedSnapshot(s.Owner, created.FamilyId, default);
            Assert.Equal(3, result.Entries.Length);
        }
        var recordRead = Assert.Single(probe.Reads, command => command.Contains("SELECT * FROM dbo.FamilyRecords", StringComparison.Ordinal));
        Assert.Contains("Collection = N'entry' AND Deleted = 0", recordRead);
        Assert.Contains("JSON_VALUE(RecordJson, '$.type') IN (N'feed', N'sleep')", recordRead);
        Assert.Equal([recordRead], probe.Reads.Where(command =>
            command.Contains("FamilyRecords", StringComparison.Ordinal) &&
            !command.Contains("DATALENGTH", StringComparison.OrdinalIgnoreCase)).ToArray());
        Assert.DoesNotContain(probe.Reads, command => command.Contains("[Invitations]", StringComparison.Ordinal));
        Assert.DoesNotContain(probe.Reads, command => command.Contains("[OwnershipTransfers]", StringComparison.Ordinal));
        Assert.DoesNotContain(probe.Writes, command =>
            command.Contains("INSERT ", StringComparison.OrdinalIgnoreCase) ||
            command.Contains("UPDATE ", StringComparison.OrdinalIgnoreCase) ||
            command.Contains("DELETE ", StringComparison.OrdinalIgnoreCase));
        await using var check = sql.Open();
        Assert.Equal(before, await DatabaseState(check, created.FamilyId));
        Assert.Equal("pending", (await check.Invitations.SingleAsync(item => item.FamilyId == created.FamilyId)).Status);
    }

    [SqlFact]
    public async Task ScopedReadRetainsStoredFamilyBudgetEvenWhenItsOwnResponseWouldBeSmall()
    {
        var s = new Scenario(sql);
        var created = await Create(s);
        await using (var db = sql.Open())
        {
            // Synthetic unrelated rows exceed 64 MiB in SQL UTF-16 storage,
            // while the scoped response would still contain only three entries.
            await db.Database.ExecuteSqlInterpolatedAsync($$"""
                INSERT dbo.FamilyRecords(FamilyId,Collection,IdHash,Id,RecordJson,RecordedBy,LastEditedBy,Deleted)
                SELECT {{created.FamilyId}}, 'entry', CONVERT(varchar(64), HASHBYTES('SHA2_256',CONCAT('scope-storage-',n)),2),
                    CONCAT('scope-storage-',n), CONCAT(CONVERT(nvarchar(max),'{"id":"scope-storage-'),n,
                    '","type":"diaper","start":"2026-09-01T00:00:00Z","diaperKind":"wet","note":"',
                    REPLICATE(CONVERT(nvarchar(max),'x'),10000),'"}'),
                    {{s.Owner.ObjectId}}, {{s.Owner.ObjectId}}, 0
                FROM (SELECT TOP (3500) ROW_NUMBER() OVER(ORDER BY (SELECT NULL)) AS n FROM sys.all_objects a CROSS JOIN sys.all_objects b) rows
                """);
        }
        await Code("family_storage_limit", 409,
            () => s.Call(service => service.SleepFeedSnapshot(s.Owner, created.FamilyId, default)));
    }

    [SqlFact]
    public async Task ScopedReadDeniesNonmembersRevokedGrantsDeletedAccountsAndLegacyFamilies()
    {
        var s = new Scenario(sql);
        var created = await Create(s);
        var grant = await Join(s, created);
        await Code("membership_revoked", 403, () => s.Call(service => service.SleepFeedSnapshot(s.Other, created.FamilyId, default)));
        await s.Call(service => service.RemoveMember(s.Owner, created.FamilyId, s.Caregiver.ObjectId,
            s.Context(created.Snapshot.Family, target: grant.MembershipId), default));
        await Code("membership_revoked", 403, () => s.Call(service => service.SleepFeedSnapshot(s.Caregiver, created.FamilyId, default)));
        await s.Call(service => service.DeleteAccount(s.Caregiver,
            new(Guid.NewGuid(), new string('a', 64)), default));
        await Code("account_deleted", 410, () => s.Call(service => service.SleepFeedSnapshot(s.Caregiver, created.FamilyId, default)));
        var legacy = new Scenario(sql);
        var family = await legacy.Create();
        await Code("family_schema_unsupported", 409, () => legacy.Call(service => service.SleepFeedSnapshot(legacy.Owner, family.Id, default)));
    }

    [SqlFact]
    public async Task ScopedReadReturnsAnEmptyArrayAndTheCurrentHistoryWithoutInventingRecords()
    {
        var s = new Scenario(sql);
        var created = await s.Call(service => service.CreateFullFamily(s.Owner,
            new(Guid.NewGuid(), "family-sharing-v1", FullDomainTests.Seed(entries: [], care: [])), default));
        s.Config.Family.HistoryId = Guid.NewGuid();
        var result = await s.Call(service => service.SleepFeedSnapshot(s.Owner, created.FamilyId, default));
        Assert.Empty(result.Entries);
        Assert.Equal(s.Config.Family.HistoryId, result.HistoryId);
        Assert.NotEqual(created.HistoryId, result.HistoryId);
        Assert.Equal(created.MembershipId, result.MembershipId);
        Assert.Equal(created.Snapshot.Revision, result.Revision);
    }

    private static Task<CreateFullFamilyResult> Create(Scenario s) => s.Call(service => service.CreateFullFamily(s.Owner,
        new(Guid.NewGuid(), "family-sharing-v1", FamilyExtrasTests.Seed([s.Caregiver.Email])), default));
    private static Task<FamilySummary> Join(Scenario s, CreateFullFamilyResult created) => s.Call(service => service.AcceptInvitation(s.Caregiver,
        Assert.Single(created.Snapshot.Invitations).Id, new(Guid.NewGuid()), default));
    private static string Id(SharedEntry item) => item.Entry.GetProperty("id").GetString()!;
    private static string Serialize<T>(T value) => JsonSerializer.Serialize(value, FamilyAvailability.SnapshotJson);
    private static async Task Code(string code, int status, Func<Task<SleepFeedSnapshot>> request)
    {
        var error = await Assert.ThrowsAsync<ApiException>(request);
        Assert.Equal(code, error.Code);
        Assert.Equal(status, error.Status);
    }
    private static async Task AssertError(HttpClient client, string path, HttpStatusCode status, string code)
    {
        using var response = await client.GetAsync(path);
        Assert.Equal(status, response.StatusCode);
        Assert.Equal(code, (await response.Content.ReadFromJsonAsync<ErrorBody>())!.Code);
    }
    private static async Task<string> DatabaseState(PilotDatabase db, Guid familyId) => Serialize(new
    {
        Family = await db.Families.AsNoTracking().SingleAsync(item => item.Id == familyId),
        Records = await db.FamilyRecords.AsNoTracking().Where(item => item.FamilyId == familyId).OrderBy(item => item.Collection).ThenBy(item => item.Id).ToArrayAsync(),
        Invitations = await db.Invitations.AsNoTracking().Where(item => item.FamilyId == familyId).OrderBy(item => item.Id).ToArrayAsync(),
        Operations = await db.Operations.AsNoTracking().Where(item => item.FamilyId == familyId).OrderBy(item => item.OperationId).ToArrayAsync()
    });
    private sealed record ErrorBody(string Code);
    private sealed class QueryProbe : DbCommandInterceptor
    {
        public List<string> Reads { get; } = [];
        public List<string> Writes { get; } = [];
        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand command,
            CommandEventData eventData, InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default)
        {
            Reads.Add(command.CommandText);
            return ValueTask.FromResult(result);
        }
        public override ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(DbCommand command,
            CommandEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            Writes.Add(command.CommandText);
            return ValueTask.FromResult(result);
        }
    }
}
