using System.Data.Common;
using System.Net;
using System.Net.Http.Json;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace LittleDays.FamilyApi.Tests;

public sealed class SleepFeedConditionalTests(SqlFixture sql) : IClassFixture<SqlFixture>
{
    [SqlFact]
    public async Task ConditionalReadCombinesAuthorityIntoOneQueryAndSkipsRecordBodiesWithoutWritingOn304()
    {
        var s = new Scenario(sql);
        var created = await Create(s);
        var probe = new QueryProbe();
        await using var db = new PilotDatabase(new DbContextOptionsBuilder<PilotDatabase>()
            .UseSqlServer(sql.ConnectionString).AddInterceptors(probe).Options);
        var service = new FamilyService(db, s.Config, TimeProvider.System);
        var first = await service.ConditionalSleepFeedSnapshot(s.Owner, created.FamilyId, null, default);
        Assert.NotNull(first.Snapshot);
        Assert.Equal(3, first.Snapshot.Entries.Length);
        Assert.Equal(3, probe.Reads.Count);
        var authority = Assert.Single(probe.Reads, command => command.Contains("AS AccountDeleted", StringComparison.Ordinal));
        Assert.Contains("dbo.AccountDeletions", authority); Assert.Contains("dbo.Families", authority); Assert.Contains("dbo.Memberships", authority);
        Assert.DoesNotContain("RecordJson", authority); Assert.DoesNotContain("BabyName", authority);
        Assert.Equal(2, probe.Writes.Count);
        Assert.Contains("@LockMode = @p0", probe.Writes[0]);
        Assert.Contains("FamilyPilot:v1", probe.Writes[0]);
        Assert.Contains("@LockMode = 'Exclusive'", probe.Writes[1]);
        Assert.DoesNotContain(probe.Writes, IsMutation);
        probe.Reads.Clear(); probe.Writes.Clear();
        var unchanged = await service.ConditionalSleepFeedSnapshot(s.Owner, created.FamilyId, first.ETag, default);
        Assert.Null(unchanged.Snapshot);
        Assert.Equal(first.ETag, unchanged.ETag);
        Assert.StartsWith("\"sleep-feed1-", first.ETag); Assert.EndsWith("\"", first.ETag);
        Assert.InRange(first.ETag.Length, 2, 512);
        Assert.Equal(2, probe.Reads.Count);
        Assert.Single(probe.Reads, command => command.Contains("AS AccountDeleted", StringComparison.Ordinal));
        Assert.Single(probe.Reads, command => command.Contains("DATALENGTH(RecordJson)", StringComparison.Ordinal));
        Assert.DoesNotContain(probe.Reads, command => command.Contains("SELECT * FROM dbo.FamilyRecords", StringComparison.Ordinal));
        Assert.DoesNotContain(probe.Reads, command => command.Contains("Invitations", StringComparison.Ordinal));
        Assert.Equal(2, probe.Writes.Count);
        Assert.DoesNotContain(probe.Writes, IsMutation);
        var full = await s.Call(api => api.FullSnapshot(s.Owner, created.FamilyId, default));
        Assert.Equal(created.Snapshot.Revision, full.Revision);
        Assert.Equal(created.Snapshot.Entries.Length, full.Entries.Length);
    }

    [SqlFact]
    public async Task Http304HasNoBodyAndFreshGrantChecksPrecedeEntityTagComparison()
    {
        var s = new Scenario(sql);
        var created = await Create(s);
        var grant = await s.Call(api => api.AcceptInvitation(s.Caregiver,
            Assert.Single(created.Snapshot.Invitations).Id, new(Guid.NewGuid()), default));
        await using var host = new TestHost(s.Config, sql.ConnectionString);
        using var client = host.CreateClient();
        client.DefaultRequestHeaders.Authorization = new("Bearer", host.Token(s.Caregiver));
        var path = $"/v2/families/{created.FamilyId}/sleep-feed-snapshot";
        using var first = await client.GetAsync(path);
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        var body = (await first.Content.ReadFromJsonAsync<SleepFeedSnapshot>())!;
        Assert.Equal(grant.MembershipId, body.MembershipId);
        Assert.Equal("caregiver", body.Role);
        Assert.Equal(3, body.Entries.Length);
        var etag = first.Headers.ETag!;
        Assert.False(etag.IsWeak);
        Assert.Equal(5, FamilySyncDiagnosticsTests.Parse(Assert.Single(first.Headers.GetValues("Server-Timing")))["sql_commands"].Count);
        client.DefaultRequestHeaders.IfNoneMatch.Add(etag);
        using var unchanged = await client.GetAsync(path);
        Assert.Equal(HttpStatusCode.NotModified, unchanged.StatusCode);
        Assert.Equal("", await unchanged.Content.ReadAsStringAsync());
        Assert.Equal(etag, unchanged.Headers.ETag);
        Assert.Equal("no-store", unchanged.Headers.CacheControl!.ToString());
        Assert.Equal(4, FamilySyncDiagnosticsTests.Parse(Assert.Single(unchanged.Headers.GetValues("Server-Timing")))["sql_commands"].Count);
        await s.Call(api => api.RemoveMember(s.Owner, created.FamilyId, s.Caregiver.ObjectId,
            s.Context(created.Snapshot.Family, target: grant.MembershipId), default));
        using var denied = await client.GetAsync(path);
        Assert.Equal(HttpStatusCode.Forbidden, denied.StatusCode);
        Assert.Equal("{\"code\":\"membership_revoked\"}", await denied.Content.ReadAsStringAsync());
        Assert.Null(denied.Headers.ETag);
        await s.Call(api => api.DeleteAccount(s.Caregiver, new(Guid.NewGuid(), new string('a', 64)), default));
        var deleted = await Assert.ThrowsAsync<ApiException>(() => s.Call(api =>
            api.ConditionalSleepFeedSnapshot(s.Caregiver, Guid.NewGuid(), etag.ToString(), default)));
        Assert.Equal(410, deleted.Status); Assert.Equal("account_deleted", deleted.Code);
    }

    [SqlFact]
    public async Task ScopedEntityTagChangesWithRevisionRoleHistoryGrantAndAccountWithoutReturningStaleData()
    {
        var s = new Scenario(sql);
        var created = await Create(s);
        var grant = await s.Call(api => api.AcceptInvitation(s.Caregiver,
            Assert.Single(created.Snapshot.Invitations).Id, new(Guid.NewGuid()), default));
        var user = s.Caregiver;
        var previous = await s.Call(api => api.ConditionalSleepFeedSnapshot(user, created.FamilyId, null, default));
        foreach (var change in new[] { "revision", "role", "history", "grant", "account" })
        {
            await using (var db = sql.Open())
            {
                var family = await db.Families.SingleAsync(row => row.Id == created.FamilyId);
                var membership = await db.Memberships.SingleAsync(row => row.FamilyId == created.FamilyId && row.UserId == user.ObjectId && row.Active);
                switch (change)
                {
                    case "revision": family.Revision++; break;
                    case "role": membership.Role = "owner"; break;
                    case "history": s.Config.Family.HistoryId = Guid.NewGuid(); break;
                    case "grant":
                        membership.Active = false; membership.Status = "removed";
                        await db.SaveChangesAsync();
                        db.Memberships.Add(new() { Id = Guid.NewGuid(), FamilyId = family.Id, UserId = user.ObjectId,
                            Role = membership.Role, GrantedAt = DateTimeOffset.UtcNow, Email = user.Email, DisplayName = "Synthetic" });
                        break;
                    case "account": membership.UserId = s.Other.ObjectId; user = s.Other; break;
                }
                await db.SaveChangesAsync();
            }
            var changed = await s.Call(api => api.ConditionalSleepFeedSnapshot(user, created.FamilyId, previous.ETag, default));
            Assert.NotNull(changed.Snapshot);
            Assert.NotEqual(previous.ETag, changed.ETag);
            Assert.Equal(user.ObjectId, changed.Snapshot.UserId);
            Assert.Equal(s.Config.Family.HistoryId, changed.Snapshot.HistoryId);
            if (change == "grant") Assert.NotEqual(grant.MembershipId, changed.Snapshot.MembershipId);
            previous = changed;
        }
        var settled = await s.Call(api => api.ConditionalSleepFeedSnapshot(user, created.FamilyId, previous.ETag, default));
        Assert.Null(settled.Snapshot);
    }

    [SqlFact]
    public async Task UnmatchedOrOversizedEntityTagsReturnTheNormalScopedRepresentation()
    {
        var s = new Scenario(sql); var created = await Create(s);
        var original = await s.Call(api => api.ConditionalSleepFeedSnapshot(s.Owner, created.FamilyId, null, default));
        foreach (var tag in new[] { "\"other-scope\"", "W/" + original.ETag, new string('x', 513) })
        {
            var result = await s.Call(api => api.ConditionalSleepFeedSnapshot(s.Owner, created.FamilyId, tag, default));
            Assert.NotNull(result.Snapshot);
            Assert.Equal(original.ETag, result.ETag);
            Assert.Equal(original.Snapshot!.Revision, result.Snapshot.Revision);
            Assert.Equal(original.Snapshot.Entries.Select(item => item.Version), result.Snapshot.Entries.Select(item => item.Version));
        }
    }

    [SqlFact]
    public async Task CommandFailuresAndCancellationKeepOriginalOutcomesAndOnlyNumericDiagnostics()
    {
        var logs = new FamilySyncDiagnosticsTests.Logs();
        var timing = new FamilySyncDiagnostics(logs, TimeProvider.System);
        timing.Start(FamilySyncOperation.RecordWrite);
        await using (var db = new PilotDatabase(new DbContextOptionsBuilder<PilotDatabase>().UseSqlServer(sql.ConnectionString)
            .AddInterceptors(new FamilySyncCommandInterceptor(timing)).Options))
            await Assert.ThrowsAsync<SqlException>(() => db.Database.ExecuteSqlRawAsync("SELECT PRIVATE_MISSING_COLUMN"));
        using var cancel = new CancellationTokenSource();
        await using (var db = new PilotDatabase(new DbContextOptionsBuilder<PilotDatabase>().UseSqlServer(sql.ConnectionString)
            .AddInterceptors(new FamilySyncCommandInterceptor(timing), new CancelCommand(cancel)).Options))
            await Assert.ThrowsAnyAsync<OperationCanceledException>(() => db.Database.ExecuteSqlRawAsync("SELECT 1", cancel.Token));
        timing.Complete(503);
        var row = Assert.Single(logs.Events);
        Assert.Equal(2, row["SqlCommandsCount"]);
        Assert.True((double)row["SqlCommandsMs"]! >= 0);
        Assert.DoesNotContain("PRIVATE_MISSING_COLUMN", logs.Text);
        Assert.DoesNotContain("SELECT", logs.Text);
        Assert.All(logs.Exceptions, Assert.Null);
    }

    private static Task<CreateFullFamilyResult> Create(Scenario s) => s.Call(api => api.CreateFullFamily(s.Owner,
        new(Guid.NewGuid(), "family-sharing-v1", FamilyExtrasTests.Seed([s.Caregiver.Email])), default));
    private static bool IsMutation(string command) => command.Contains("INSERT ", StringComparison.OrdinalIgnoreCase) ||
        command.Contains("UPDATE ", StringComparison.OrdinalIgnoreCase) || command.Contains("DELETE ", StringComparison.OrdinalIgnoreCase);
    private sealed class QueryProbe : DbCommandInterceptor
    {
        public List<string> Reads { get; } = [];
        public List<string> Writes { get; } = [];
        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand command, CommandEventData eventData,
            InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default)
        { Reads.Add(command.CommandText); return ValueTask.FromResult(result); }
        public override ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(DbCommand command, CommandEventData eventData,
            InterceptionResult<int> result, CancellationToken cancellationToken = default)
        { Writes.Add(command.CommandText); return ValueTask.FromResult(result); }
    }
    private sealed class CancelCommand(CancellationTokenSource cancellation) : DbCommandInterceptor
    {
        public override ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(DbCommand command, CommandEventData eventData,
            InterceptionResult<int> result, CancellationToken cancellationToken = default)
        { cancellation.Cancel(); return ValueTask.FromResult(result); }
    }
}
