using System.Data.Common;
using System.Net;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace LittleDays.FamilyApi.Tests;

public sealed class SleepAiRevocationEndpointsSqlTests(SqlFixture sql) : IClassFixture<SqlFixture>
{
    [SqlFact]
    public async Task DeleteRoutesWaitForFinalPayloadCleanupBefore204AndLogOnlySafeMetadata()
    {
        foreach (var consent in new[] { false, true })
        {
            var scenario = new Scenario(sql); var id = Guid.NewGuid(); var logs = new TimingLogs();
            var barrier = new FinalPayloadBarrier();
            await using var host = new TestHost(scenario.Config, sql.ConnectionString);
            await using var isolated = host.WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
            {
                services.AddSingleton<ILogger<SleepAiDiagnostics>>(logs);
                services.AddScoped(_ => new PilotDatabase(new DbContextOptionsBuilder<PilotDatabase>()
                    .UseSqlServer(sql.ConnectionString).AddInterceptors(barrier).Options));
            }));
            using var client = isolated.CreateClient();
            var token = host.Token(scenario.Owner);
            client.DefaultRequestHeaders.Authorization = new("Bearer", token);
            var path = Path(consent, id);
            var responseTask = client.DeleteAsync(path);
            try
            {
                await barrier.Entered.Task.WaitAsync(TimeSpan.FromSeconds(15));
                Assert.False(responseTask.IsCompleted);
                Assert.Empty(logs.Events);
            }
            finally { barrier.Release.TrySetResult(); }
            using var response = await responseTask.WaitAsync(TimeSpan.FromSeconds(15));
            Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
            Assert.Equal("", await response.Content.ReadAsStringAsync());
            Assert.Equal("no-store", response.Headers.CacheControl!.ToString());
            AssertSafeTiming(logs, consent ? "Revoke" : "Cancel", "ok", id, scenario.Owner, path, token);
            await using var check = sql.Open();
            var fence = await check.SleepAiRevocations.SingleAsync(row => row.UserId == scenario.Owner.ObjectId && row.Id == id);
            Assert.Equal(consent ? "consent" : "job", fence.Kind);
        }
    }

    [SqlFact]
    public async Task DeleteCleanupFailureNeverAcknowledgesAndLogsFixedDatabaseOutcomeWithoutPrivateError()
    {
        var failure = await SqlFailure(51000);
        foreach (var consent in new[] { false, true })
        {
            var scenario = new Scenario(sql); var id = Guid.NewGuid(); var logs = new TimingLogs();
            var barrier = new FinalPayloadBarrier { Failure = failure };
            await using var host = new TestHost(scenario.Config, sql.ConnectionString);
            await using var isolated = host.WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
            {
                services.AddSingleton<ILogger<SleepAiDiagnostics>>(logs);
                services.AddScoped(_ => new PilotDatabase(new DbContextOptionsBuilder<PilotDatabase>()
                    .UseSqlServer(sql.ConnectionString).AddInterceptors(barrier).Options));
            }));
            using var client = isolated.CreateClient();
            var token = host.Token(scenario.Owner);
            client.DefaultRequestHeaders.Authorization = new("Bearer", token);
            var path = Path(consent, id);
            var responseTask = client.DeleteAsync(path);
            try
            {
                await barrier.Entered.Task.WaitAsync(TimeSpan.FromSeconds(15));
                Assert.False(responseTask.IsCompleted);
                Assert.Empty(logs.Events);
            }
            finally { barrier.Release.TrySetResult(); }
            using var response = await responseTask.WaitAsync(TimeSpan.FromSeconds(15));
            Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
            Assert.Equal("{\"code\":\"service_unavailable\"}", await response.Content.ReadAsStringAsync());
            AssertSafeTiming(logs, consent ? "Revoke" : "Cancel", "database_lock_error", id, scenario.Owner, path, token);
            Assert.DoesNotContain(failure.Message, logs.Text);
        }
    }

    [Fact]
    public async Task DeleteAuthenticationAdmissionAndInvalidIdKeepExistingHttpContract()
    {
        var scenario = new Scenario(sql); var logs = new TimingLogs();
        await using var host = new TestHost(scenario.Config);
        await using var isolated = host.WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
            services.AddSingleton<ILogger<SleepAiDiagnostics>>(logs)));
        using var client = isolated.CreateClient();
        foreach (var consent in new[] { false, true })
        {
            client.DefaultRequestHeaders.Authorization = null;
            using var anonymous = await client.DeleteAsync(Path(consent, Guid.NewGuid()));
            Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);
            client.DefaultRequestHeaders.Authorization = new("Bearer", host.Token(new() { ObjectId = Guid.NewGuid(), Email = scenario.Owner.Email }));
            using var denied = await client.DeleteAsync(Path(consent, Guid.NewGuid()));
            Assert.Equal(HttpStatusCode.Forbidden, denied.StatusCode);
        }
        Assert.Empty(logs.Events);
        client.DefaultRequestHeaders.Authorization = new("Bearer", host.Token(scenario.Owner));
        foreach (var consent in new[] { false, true })
        {
            using var invalid = await client.DeleteAsync(Path(consent, Guid.Empty));
            Assert.Equal(HttpStatusCode.UnprocessableEntity, invalid.StatusCode);
            Assert.Equal("{\"code\":\"invalid_input\"}", await invalid.Content.ReadAsStringAsync());
        }
        Assert.Equal(new[] { "Cancel", "Revoke" }, logs.Events.Select(row => row["Stage"]));
        Assert.All(logs.Events, row => Assert.Equal("ai_provider_unavailable", row["Outcome"]));
        Assert.All(logs.Exceptions, Assert.Null);
    }

    [SqlFact]
    public async Task SqlNumbersAndEfWrappedFailuresUseFixedOutcomesWithoutLoggingExceptionDetails()
    {
        foreach (var (number, expected) in new[] { (-2, "database_timeout"), (1205, "database_deadlock"),
                     (51000, "database_lock_error"), (51001, "database_error") })
        {
            var error = await SqlFailure(number);
            foreach (var wrapped in new[] { false, true })
            {
                var logs = new TimingLogs(); var clock = new TimingClock();
                var diagnostics = new SleepAiDiagnostics(logs, clock);
                Exception original = wrapped ? new DbUpdateException("synthetic-private-save", error) : error;
                var observed = await Assert.ThrowsAnyAsync<Exception>(() => diagnostics.MeasureAsync<bool>(SleepAiStage.Revoke, () =>
                { clock.Advance(125); return Task.FromException<bool>(original); }));
                Assert.Same(original, observed);
                var row = Assert.Single(logs.Events);
                Assert.Equal(expected, row["Outcome"]); Assert.Equal(125d, row["DurationMs"]);
                Assert.DoesNotContain("synthetic-private", logs.Text);
                Assert.DoesNotContain(error.Message, logs.Text);
                Assert.All(logs.Exceptions, Assert.Null);
            }
        }
    }

    private async Task<SqlException> SqlFailure(int number)
    {
        if (number == 1205) return await DeadlockFailure();
        await using var connection = new SqlConnection(sql.ConnectionString);
        await connection.OpenAsync();
        var commandText = number switch
        {
            -2 => "WAITFOR DELAY '00:00:02';",
            51000 => "THROW 51000, N'synthetic-private-database-payload', 1;",
            _ => "THROW 51001, N'synthetic-private-database-payload', 1;"
        };
        await using var command = new SqlCommand(commandText, connection) { CommandTimeout = number == -2 ? 1 : 10 };
        var error = await Assert.ThrowsAsync<SqlException>(() => command.ExecuteNonQueryAsync());
        Assert.Equal(number, error.Number);
        return error;
    }

    private async Task<SqlException> DeadlockFailure()
    {
        // RAISERROR cannot raise system error 1205. Produce the real SqlClient
        // error in this fixture's disposable database, without reflection.
        await using var setup = new SqlConnection(sql.ConnectionString);
        await setup.OpenAsync();
        await Execute(setup, null, "CREATE TABLE dbo.SleepAiTimingDeadlockProbe (Id int PRIMARY KEY, Value int NOT NULL); INSERT dbo.SleepAiTimingDeadlockProbe VALUES (1,0),(2,0);");
        try
        {
            await using var victim = new SqlConnection(sql.ConnectionString);
            await using var survivor = new SqlConnection(sql.ConnectionString);
            await victim.OpenAsync(); await survivor.OpenAsync();
            await Execute(victim, null, "SET DEADLOCK_PRIORITY LOW;");
            await using var victimTransaction = (SqlTransaction)await victim.BeginTransactionAsync();
            await using var survivorTransaction = (SqlTransaction)await survivor.BeginTransactionAsync();
            await Execute(victim, victimTransaction, "UPDATE dbo.SleepAiTimingDeadlockProbe WITH (ROWLOCK) SET Value=Value+1 WHERE Id=1;");
            await Execute(survivor, survivorTransaction, "UPDATE dbo.SleepAiTimingDeadlockProbe WITH (ROWLOCK) SET Value=Value+1 WHERE Id=2;");
            var blockedVictim = Execute(victim, victimTransaction, "UPDATE dbo.SleepAiTimingDeadlockProbe WITH (ROWLOCK) SET Value=Value+1 WHERE Id=2;");
            var blockedSurvivor = Execute(survivor, survivorTransaction, "UPDATE dbo.SleepAiTimingDeadlockProbe WITH (ROWLOCK) SET Value=Value+1 WHERE Id=1;");
            var error = await Assert.ThrowsAsync<SqlException>(() => blockedVictim);
            Assert.Equal(1205, error.Number);
            Assert.Equal(1, await blockedSurvivor);
            await survivorTransaction.RollbackAsync();
            return error;
        }
        finally { await Execute(setup, null, "DROP TABLE dbo.SleepAiTimingDeadlockProbe;"); }

        static async Task<int> Execute(SqlConnection connection, SqlTransaction? transaction, string sqlText)
        {
            await using var command = new SqlCommand(sqlText, connection, transaction) { CommandTimeout = 20 };
            return await command.ExecuteNonQueryAsync();
        }
    }

    private static string Path(bool consent, Guid id) => consent
        ? $"/v2/sleep-prediction-jobs/consents/{id:D}" : $"/v2/sleep-prediction-jobs/{id:D}";

    private static void AssertSafeTiming(TimingLogs logs, string stage, string outcome, Guid id, PilotIdentity user, string path, string token)
    {
        var row = Assert.Single(logs.Events);
        Assert.Equal(stage, row["Stage"]); Assert.Equal(outcome, row["Outcome"]);
        Assert.Equal(0, row["Run"]); Assert.Equal(0, row["Attempt"]);
        Assert.True((double)row["DurationMs"]! >= 0);
        Assert.Matches("^[A-F0-9]{24}$", Assert.IsType<string>(row["Job"]));
        Assert.Equal(new[] { "{OriginalFormat}", "Attempt", "CachedInputTokens", "DurationMs", "InputTokens", "Job", "Model",
            "Outcome", "OutputTokens", "Run", "ServiceTier", "Stage" }.Order(), row.Keys.Order());
        Assert.Null(row["Model"]); Assert.Null(row["InputTokens"]); Assert.Null(row["OutputTokens"]); Assert.Null(row["CachedInputTokens"]);
        foreach (var secret in new[] { id.ToString("D"), id.ToString("N"), user.ObjectId.ToString("D"),
                     user.ObjectId.ToString("N"), user.Email, path, token, "synthetic-private" })
            Assert.DoesNotContain(secret, logs.Text);
        Assert.All(logs.Exceptions, Assert.Null);
    }

    private sealed class FinalPayloadBarrier : DbCommandInterceptor
    {
        public TaskCompletionSource Entered { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource Release { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public Exception? Failure { get; init; }
        public override async ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(DbCommand command, CommandEventData eventData,
            InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            if (command.CommandText.Contains("DELETE", StringComparison.Ordinal) && command.CommandText.Contains("SleepAiExchanges", StringComparison.Ordinal))
            {
                Entered.TrySetResult();
                await Release.Task.WaitAsync(cancellationToken);
                if (Failure is not null) throw Failure;
            }
            return result;
        }
    }
}
