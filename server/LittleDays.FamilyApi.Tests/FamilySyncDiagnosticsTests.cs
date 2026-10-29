using System.Globalization;
using System.Net;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;

namespace LittleDays.FamilyApi.Tests;

public sealed class FamilySyncDiagnosticsTests
{
    private static readonly string[] Phases =
    ["directory_token", "directory_lookup", "directory_uniqueness", "sql_commands",
        "global_lock", "family_lock", "transaction", "serialize", "total"];

    [Fact]
    public void FixedNumericTimingsUseMonotonicTimeAndDoNotSumOverlappingStages()
    {
        var clock = new TimingClock();
        var logs = new Logs();
        var timing = new FamilySyncDiagnostics(logs, clock);
        timing.Start(FamilySyncOperation.SleepFeedSnapshot);
        using (timing.Measure(FamilySyncPhase.Transaction))
        {
            var lookup = timing.Measure(FamilySyncPhase.DirectoryLookup)!;
            clock.Advance(12);
            clock.Utc = clock.Utc.AddDays(-1);
            lookup.Dispose(); lookup.Dispose();
            timing.Record(FamilySyncPhase.SqlCommands, TimeSpan.FromMilliseconds(9.5));
        }
        var context = new DefaultHttpContext();
        timing.WriteHeaders(context.Response);
        var header = Parse(context.Response.Headers["Server-Timing"].ToString());
        Assert.Equal(Phases, header.Keys);
        Assert.Equal((12d, 1), header["directory_lookup"]);
        Assert.Equal((9.5d, 1), header["sql_commands"]);
        Assert.Equal((12d, 1), header["transaction"]);
        Assert.Equal((12d, 1), header["total"]);
        Assert.Equal((0d, 0), header["directory_token"]);
        clock.Advance(7);
        timing.Complete(200); timing.Complete(500);
        timing.Record(FamilySyncPhase.SqlCommands, TimeSpan.FromSeconds(1));
        var row = Assert.Single(logs.Events);
        Assert.Equal(FamilySyncOperation.SleepFeedSnapshot, row["Operation"]);
        Assert.Equal(200, row["StatusCode"]);
        Assert.Equal(19d, row["TotalResponseMs"]);
        Assert.Equal(1, row["DirectoryLookupCount"]);
        Assert.Equal(9.5d, row["SqlCommandsMs"]);
        Assert.All(logs.Exceptions, Assert.Null);
        Assert.All(logs.Levels, level => Assert.Equal(LogLevel.Information, level));
        Assert.All(row.Where(pair => pair.Key != "{OriginalFormat}" && pair.Key != "Operation"),
            pair => Assert.True(pair.Value is int or double, pair.Key));
        Assert.DoesNotContain("Request", string.Join(',', row.Keys));
        Assert.DoesNotContain("Id", string.Join(',', row.Keys));
        Assert.DoesNotContain("SqlText", string.Join(',', row.Keys));
    }

    [Fact]
    public void UnstartedInvalidAndSeparateRequestScopesCannotMixMetrics()
    {
        var clock = new TimingClock();
        var leftLogs = new Logs(); var rightLogs = new Logs();
        var left = new FamilySyncDiagnostics(leftLogs, clock);
        var right = new FamilySyncDiagnostics(rightLogs, clock);
        Assert.Null(left.Measure(FamilySyncPhase.DirectoryToken));
        left.Record(FamilySyncPhase.SqlCommands, TimeSpan.FromSeconds(1));
        left.Start((FamilySyncOperation)999);
        left.Start(FamilySyncOperation.Me);
        right.Start(FamilySyncOperation.RecordWrite);
        left.Start(FamilySyncOperation.FullSnapshot);
        left.Record(FamilySyncPhase.SqlCommands, TimeSpan.FromMilliseconds(3));
        left.Record((FamilySyncPhase)999, TimeSpan.FromMilliseconds(100));
        left.Record(FamilySyncPhase.SqlCommands, TimeSpan.FromMilliseconds(-1));
        right.Record(FamilySyncPhase.DirectoryToken, TimeSpan.FromMilliseconds(8));
        left.Complete(200); right.Complete(503);
        Assert.Equal(FamilySyncOperation.Me, Assert.Single(leftLogs.Events)["Operation"]);
        Assert.Equal(1, leftLogs.Events[0]["SqlCommandsCount"]);
        Assert.Equal(0, leftLogs.Events[0]["DirectoryTokenCount"]);
        Assert.Equal(FamilySyncOperation.RecordWrite, Assert.Single(rightLogs.Events)["Operation"]);
        Assert.Equal(0, rightLogs.Events[0]["SqlCommandsCount"]);
        Assert.Equal(8d, rightLogs.Events[0]["DirectoryTokenMs"]);
    }

    [Fact]
    public void BrokenClockAndLoggerCannotThrowFromInstrumentation()
    {
        var clock = new ThrowingClock();
        var timing = new FamilySyncDiagnostics(new Logs { Throw = true }, clock);
        timing.Start(FamilySyncOperation.Me);
        var measurement = timing.Measure(FamilySyncPhase.DirectoryLookup);
        clock.Throw = true;
        measurement?.Dispose();
        timing.WriteHeaders(new DefaultHttpContext().Response);
        timing.Complete(200);
        var unavailable = new FamilySyncDiagnostics(new Logs(), clock);
        unavailable.Start(FamilySyncOperation.Me);
        Assert.Null(unavailable.Measure(FamilySyncPhase.SqlCommands));
        unavailable.Complete(200);
        var brokenLogger = new FamilySyncDiagnostics(new Logs { Throw = true }, new TimingClock());
        brokenLogger.Start(FamilySyncOperation.RecordWrite);
        Assert.Null(Record.Exception(() => brokenLogger.Complete(503)));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task FreshDirectoryChecksAreMeasuredWithoutLoggingPrivateIdentityOrErrorBodies(bool failUniqueness)
    {
        var clock = new TimingClock(); var logs = new Logs();
        var diagnostics = new FamilySyncDiagnostics(logs, clock);
        diagnostics.Start(FamilySyncOperation.SleepFeedSnapshot);
        var user = Guid.NewGuid(); var tenant = Guid.NewGuid();
        var account = new
        {
            id = user, accountEnabled = true, creationType = "LocalAccount", displayName = "PRIVATE PERSON",
            identities = new[] { new { signInType = "emailAddress", issuer = "fixture.onmicrosoft.com", issuerAssignedId = "private@example.test" } }
        };
        using var handler = new DirectoryHandler(clock,
            new HttpResponseMessage(HttpStatusCode.OK) { Content = JsonContent(account) },
            failUniqueness
                ? new HttpResponseMessage(HttpStatusCode.ServiceUnavailable) { Content = new StringContent("PRIVATE ERROR BODY") }
                : new HttpResponseMessage(HttpStatusCode.OK) { Content = JsonContent(new { value = new[] { account } }) });
        using var http = new HttpClient(handler);
        var config = new PilotConfiguration(new() { TenantId = tenant }, new(), new())
        { Admission = new() { Mode = "Directory", EmailOtpOnly = true, LocalAccountIssuer = "fixture.onmicrosoft.com" } };
        var principal = new ClaimsPrincipal(new ClaimsIdentity(
            [new Claim("oid", user.ToString()), new Claim("tid", tenant.ToString())], "fixture"));
        var admission = new GraphPublicIdentityAdmission(http, config, new Tokens(clock), diagnostics);
        if (failUniqueness)
        {
            var error = await Assert.ThrowsAsync<ApiException>(() => admission.AdmitAsync(principal, default));
            Assert.Equal(503, error.Status); Assert.Equal("identity_unavailable", error.Code);
        }
        else Assert.Equal(user, (await admission.AdmitAsync(principal, default)).ObjectId);
        diagnostics.Complete(failUniqueness ? 503 : 200);
        var row = Assert.Single(logs.Events);
        Assert.Equal(1, row["DirectoryTokenCount"]); Assert.Equal(2d, row["DirectoryTokenMs"]);
        Assert.Equal(1, row["DirectoryLookupCount"]); Assert.Equal(5d, row["DirectoryLookupMs"]);
        Assert.Equal(1, row["DirectoryUniquenessCount"]); Assert.Equal(5d, row["DirectoryUniquenessMs"]);
        Assert.Equal(2, handler.Calls);
        Assert.DoesNotContain("PRIVATE", logs.Text);
        Assert.DoesNotContain("private@example.test", logs.Text);
        Assert.DoesNotContain(user.ToString(), logs.Text);
        Assert.DoesNotContain("fixture-token", logs.Text);
        Assert.All(logs.Exceptions, Assert.Null);
    }

    [Fact]
    public async Task OnlySelectedEndpointsExposeFixedTimingsAndKeepTheirExistingUnauthorizedBody()
    {
        var s = new Scenario(new SqlFixture());
        await using var host = new TestHost(s.Config);
        using var client = host.CreateClient();
        foreach (var path in new[] { "/v1/me", $"/v2/families/{Guid.NewGuid()}/sleep-feed-snapshot", $"/v2/families/{Guid.NewGuid()}/snapshot" })
        {
            using var response = await client.GetAsync(path);
            Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
            Assert.Equal("{\"code\":\"unauthorized\"}", await response.Content.ReadAsStringAsync());
            var header = Parse(Assert.Single(response.Headers.GetValues("Server-Timing")));
            Assert.Equal(Phases, header.Keys);
            Assert.Equal((0d, 0), header["sql_commands"]);
        }
        using var health = await client.GetAsync("/health/live");
        Assert.Equal(HttpStatusCode.OK, health.StatusCode);
        Assert.False(health.Headers.Contains("Server-Timing"));
    }

    internal static Dictionary<string, (double Milliseconds, int Count)> Parse(string header) => header.Split(',').ToDictionary(
        part => part.Split(';')[0], part =>
        {
            var fields = part.Split(';');
            Assert.Equal(3, fields.Length);
            return (double.Parse(fields[1][4..], CultureInfo.InvariantCulture), int.Parse(fields[2][6..], CultureInfo.InvariantCulture));
        });
    private static StringContent JsonContent<T>(T value) => new(JsonSerializer.Serialize(value), Encoding.UTF8, "application/json");
    private sealed class Tokens(TimingClock clock) : IGraphAdmissionTokenProvider
    {
        public Task<string> GetAsync(CancellationToken ct) { clock.Advance(2); return Task.FromResult("fixture-token"); }
        public void Reject(string token) => throw new InvalidOperationException("No retry expected");
    }
    private sealed class DirectoryHandler(TimingClock clock, params HttpResponseMessage[] responses) : HttpMessageHandler
    {
        public int Calls { get; private set; }
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        { clock.Advance(5); return Task.FromResult(responses[Calls++]); }
    }
    private sealed class ThrowingClock : TimeProvider
    {
        public bool Throw;
        public override long GetTimestamp() => Throw ? throw new InvalidOperationException("PRIVATE CLOCK") : 0;
    }
    internal sealed class Logs : ILogger<FamilySyncDiagnostics>
    {
        public readonly List<Dictionary<string, object?>> Events = [];
        public readonly List<Exception?> Exceptions = [];
        public readonly List<LogLevel> Levels = [];
        public string Text = "";
        public bool Throw;
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => true;
        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            if (Throw) throw new InvalidOperationException("PRIVATE LOG ERROR");
            Events.Add(((IEnumerable<KeyValuePair<string, object?>>)state!).ToDictionary(pair => pair.Key, pair => pair.Value));
            Levels.Add(logLevel); Exceptions.Add(exception); Text += formatter(state, exception);
        }
    }
}
