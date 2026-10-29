using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace LittleDays.FamilyApi;

public interface ISleepAiAttemptStore
{
    Task<IAsyncDisposable> Reserve(Guid userId, CancellationToken ct);
}

// Shared by both the legacy synchronous endpoint and durable jobs. Counters and
// provider leases survive process replacement; polling never calls this path.
public sealed class SleepAiAttemptStore(PilotDatabase db, FamilyService family,
    TimeProvider clock, IOptions<SleepAiOptions> options) : ISleepAiAttemptStore
{
    public async Task<IAsyncDisposable> Reserve(Guid userId, CancellationToken ct)
    {
        var id = Guid.NewGuid();
        await family.SleepAiTransaction(async () =>
        {
            var now = clock.GetUtcNow();
            var day = new DateTimeOffset(now.UtcDateTime.Date, TimeSpan.Zero);
            var hour = DateTimeOffset.FromUnixTimeSeconds(now.ToUnixTimeSeconds() / 3600 * 3600);
            if (await db.SleepAiAttempts.CountAsync(x => x.StartedAt >= day, ct) >= options.Value.MaxRequestsPerInstancePerDay)
                throw new ApiException(429, "ai_daily_limit");
            if (await db.SleepAiAttempts.CountAsync(x => x.UserId == userId && x.StartedAt >= hour, ct) >= options.Value.MaxRequestsPerAccountPerHour)
                throw new ApiException(429, "ai_hourly_limit");
            if (await db.SleepAiAttempts.CountAsync(x => x.LeaseUntil > now, ct) >= options.Value.ConcurrentRequestLimit)
                throw new ApiException(429, "ai_busy");
            db.SleepAiAttempts.Add(new() { Id = id, UserId = userId, StartedAt = now, LeaseUntil = now.AddSeconds(75) });
            return true;
        }, ct);
        return new Lease(db, id);
    }

    private sealed class Lease(PilotDatabase db, Guid id) : IAsyncDisposable
    {
        public async ValueTask DisposeAsync()
        {
            // A disconnected caller must not prevent releasing its reservation.
            // If SQL is unavailable, the fixed lease expires instead of granting
            // extra concurrency or refunding an already-dispatched attempt.
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
            try { await db.SleepAiAttempts.Where(x => x.Id == id).ExecuteUpdateAsync(s => s.SetProperty(x => x.LeaseUntil, (DateTimeOffset?)null), timeout.Token); }
            catch (Exception) { }
        }
    }
}
