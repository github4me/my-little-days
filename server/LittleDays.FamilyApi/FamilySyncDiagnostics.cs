using System.Data.Common;
using System.Globalization;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace LittleDays.FamilyApi;

public enum FamilySyncOperation { Me, SleepFeedSnapshot, FullSnapshot, RecordWrite }
public sealed record FamilySyncOperationMetadata(FamilySyncOperation Operation);
public enum FamilySyncPhase
{
    DirectoryToken, DirectoryLookup, DirectoryUniqueness, SqlCommands,
    GlobalLock, FamilyLock, Transaction, Serialize
}

// Request-scoped numeric observations only. No account/family/request IDs, route
// values, payloads, SQL text/parameters, tokens or exception messages are retained.
// Phases overlap: SQL includes lock commands and reader-open time, not subsequent
// row materialization. Transaction includes locks, SQL and bounded serialization.
public sealed class FamilySyncDiagnostics(ILogger<FamilySyncDiagnostics> logger, TimeProvider clock)
{
    private static readonly string[] Names =
    ["directory_token", "directory_lookup", "directory_uniqueness", "sql_commands",
        "global_lock", "family_lock", "transaction", "serialize"];
    private readonly object gate = new();
    private readonly double[] milliseconds = new double[Names.Length];
    private readonly int[] counts = new int[Names.Length];
    private readonly TimeProvider time = clock;
    private long started;
    private FamilySyncOperation operation;
    private bool active;
    private bool completed;

    public void Start(FamilySyncOperation value)
    {
        try
        {
            if (!Enum.IsDefined(value)) return;
            lock (gate)
            {
                if (active || completed) return;
                started = time.GetTimestamp();
                operation = value;
                active = true;
            }
        }
        catch { /* Diagnostics must not change an API outcome. */ }
    }

    public IDisposable? Measure(FamilySyncPhase phase)
    {
        try
        {
            lock (gate)
            {
                if (!active || completed || !Enum.IsDefined(phase)) return null;
                return new Measurement(this, phase, time.GetTimestamp());
            }
        }
        catch { return null; }
    }

    public void Record(FamilySyncPhase phase, TimeSpan duration)
    {
        try
        {
            lock (gate)
            {
                if (!active || completed || !Enum.IsDefined(phase)) return;
                var index = (int)phase;
                var value = duration.TotalMilliseconds;
                if (!double.IsFinite(value) || value < 0) return;
                milliseconds[index] += value;
                if (counts[index] < int.MaxValue) counts[index]++;
            }
        }
        catch { /* Diagnostics must not change an API outcome. */ }
    }

    // This total is elapsed time before response headers; Complete logs the full
    // response duration separately. Never sum overlapping phases into a total.
    public void WriteHeaders(HttpResponse response)
    {
        try
        {
            lock (gate)
            {
                // A bodyless 304 can run OnStarting only after the middleware's
                // finally block. Completing the log must not suppress its header.
                if (!active || response.HasStarted) return;
                var phases = Names.Select((name, index) =>
                    $"{name};dur={Number(milliseconds[index])};count={counts[index].ToString(CultureInfo.InvariantCulture)}");
                response.Headers["Server-Timing"] = string.Join(",", phases.Append($"total;dur={Number(Elapsed())};count=1"));
            }
        }
        catch { /* A header/logging failure must not fail the family request. */ }
    }

    public void Complete(int statusCode)
    {
        try
        {
            lock (gate)
            {
                if (!active || completed) return;
                completed = true;
                logger.LogInformation(
                    "Family sync {Operation} status {StatusCode} total_response_ms {TotalResponseMs} " +
                    "directory_token_ms {DirectoryTokenMs} directory_token_count {DirectoryTokenCount} " +
                    "directory_lookup_ms {DirectoryLookupMs} directory_lookup_count {DirectoryLookupCount} " +
                    "directory_uniqueness_ms {DirectoryUniquenessMs} directory_uniqueness_count {DirectoryUniquenessCount} " +
                    "sql_commands_ms {SqlCommandsMs} sql_commands_count {SqlCommandsCount} " +
                    "global_lock_ms {GlobalLockMs} global_lock_count {GlobalLockCount} " +
                    "family_lock_ms {FamilyLockMs} family_lock_count {FamilyLockCount} " +
                    "transaction_ms {TransactionMs} transaction_count {TransactionCount} " +
                    "serialize_ms {SerializeMs} serialize_count {SerializeCount}",
                    operation, statusCode, Elapsed(),
                    milliseconds[0], counts[0], milliseconds[1], counts[1], milliseconds[2], counts[2],
                    milliseconds[3], counts[3], milliseconds[4], counts[4], milliseconds[5], counts[5],
                    milliseconds[6], counts[6], milliseconds[7], counts[7]);
            }
        }
        catch { /* Diagnostics must not change an API outcome. */ }
    }

    private double Elapsed() => Math.Max(0, time.GetElapsedTime(started).TotalMilliseconds);
    private static string Number(double value) => value.ToString("0.###", CultureInfo.InvariantCulture);
    private sealed class Measurement(FamilySyncDiagnostics owner, FamilySyncPhase phase, long timestamp) : IDisposable
    {
        private FamilySyncDiagnostics? pending = owner;
        public void Dispose()
        {
            var target = Interlocked.Exchange(ref pending, null);
            if (target is null) return;
            try { target.Record(phase, target.time.GetElapsedTime(timestamp)); }
            catch { /* Includes cancellation/failure paths without leaking details. */ }
        }
    }
}

public static class FamilySyncDiagnosticEndpoints
{
    public static IApplicationBuilder UseFamilySyncDiagnostics(this IApplicationBuilder app) => app.Use(async (context, next) =>
    {
        var metadata = context.GetEndpoint()?.Metadata.GetMetadata<FamilySyncOperationMetadata>();
        if (metadata is null) { await next(context); return; }
        var diagnostics = context.RequestServices.GetRequiredService<FamilySyncDiagnostics>();
        diagnostics.Start(metadata.Operation);
        context.Response.OnStarting(() => { diagnostics.WriteHeaders(context.Response); return Task.CompletedTask; });
        try { await next(context); }
        finally { diagnostics.Complete(context.Response.StatusCode); }
    });

    public static RouteHandlerBuilder WithFamilySyncDiagnostics(this RouteHandlerBuilder builder, FamilySyncOperation operation)
    {
        builder.WithMetadata(new FamilySyncOperationMetadata(operation));
        builder.AddEndpointFilter(async (context, next) =>
        {
            var value = await next(context);
            var result = value as IResult ?? Results.Json(value);
            return new TimedResult(result, context.HttpContext.RequestServices.GetRequiredService<FamilySyncDiagnostics>());
        });
        return builder;
    }

    private sealed class TimedResult(IResult result, FamilySyncDiagnostics diagnostics) : IResult
    {
        public async Task ExecuteAsync(HttpContext httpContext)
        {
            using var measurement = result is IStatusCodeHttpResult { StatusCode: StatusCodes.Status304NotModified }
                ? null : diagnostics.Measure(FamilySyncPhase.Serialize);
            await result.ExecuteAsync(httpContext);
        }
    }
}

// EventData.Duration is EF command execution through reader-open, not complete
// row consumption. These aggregates intentionally include the two lock commands.
public sealed class FamilySyncCommandInterceptor(FamilySyncDiagnostics diagnostics) : DbCommandInterceptor
{
    private void Record(CommandEndEventData data) => diagnostics.Record(FamilySyncPhase.SqlCommands, data.Duration);
    public override DbDataReader ReaderExecuted(DbCommand command, CommandExecutedEventData eventData, DbDataReader result)
    { Record(eventData); return result; }
    public override ValueTask<DbDataReader> ReaderExecutedAsync(DbCommand command, CommandExecutedEventData eventData,
        DbDataReader result, CancellationToken cancellationToken = default)
    { Record(eventData); return ValueTask.FromResult(result); }
    public override int NonQueryExecuted(DbCommand command, CommandExecutedEventData eventData, int result)
    { Record(eventData); return result; }
    public override ValueTask<int> NonQueryExecutedAsync(DbCommand command, CommandExecutedEventData eventData,
        int result, CancellationToken cancellationToken = default)
    { Record(eventData); return ValueTask.FromResult(result); }
    public override object? ScalarExecuted(DbCommand command, CommandExecutedEventData eventData, object? result)
    { Record(eventData); return result; }
    public override ValueTask<object?> ScalarExecutedAsync(DbCommand command, CommandExecutedEventData eventData,
        object? result, CancellationToken cancellationToken = default)
    { Record(eventData); return ValueTask.FromResult(result); }
    public override void CommandFailed(DbCommand command, CommandErrorEventData eventData) => Record(eventData);
    public override Task CommandFailedAsync(DbCommand command, CommandErrorEventData eventData, CancellationToken cancellationToken = default)
    { Record(eventData); return Task.CompletedTask; }
    public override void CommandCanceled(DbCommand command, CommandEndEventData eventData) => Record(eventData);
    public override Task CommandCanceledAsync(DbCommand command, CommandEndEventData eventData, CancellationToken cancellationToken = default)
    { Record(eventData); return Task.CompletedTask; }
}
