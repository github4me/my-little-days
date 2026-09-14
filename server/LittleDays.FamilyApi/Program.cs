using System.Security.Claims;
using System.Text.Json;
using System.Threading.RateLimiting;
using LittleDays.FamilyApi;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;

var migrateOnly = args.Contains("--migrate", StringComparer.Ordinal);
var builder = WebApplication.CreateBuilder(args.Where(x => x != "--migrate").ToArray());
// Request bodies, query strings, tokens, identities and SQL parameter values are never logged here.
builder.Logging.AddFilter("Microsoft.AspNetCore", LogLevel.Warning);
builder.Logging.AddFilter("Microsoft.EntityFrameworkCore", LogLevel.None);
builder.Logging.AddFilter("Microsoft.AspNetCore.Authentication", LogLevel.None);
builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = 16 * 1024);
builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.UnmappedMemberHandling = System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow;
    options.SerializerOptions.MaxDepth = 16;
});
builder.Services.Configure<RouteHandlerOptions>(options => options.ThrowOnBadRequest = true);
var connection = builder.Configuration.GetConnectionString("FamilyDatabase");
if (string.IsNullOrWhiteSpace(connection))
    throw new InvalidOperationException("ConnectionStrings:FamilyDatabase is required.");
builder.Services.AddDbContext<PilotDatabase>(options => options.UseSqlServer(connection, sql => sql.CommandTimeout(20)));

// Migrations are a separate operator action, never run under the web app runtime identity.
if (migrateOnly)
{
    await using var migrationApp = builder.Build();
    await using var scope = migrationApp.Services.CreateAsyncScope();
    await scope.ServiceProvider.GetRequiredService<PilotDatabase>().Database.MigrateAsync();
    return;
}

var config = PilotConfiguration.Load(builder.Configuration);
builder.Services.AddSingleton(config);
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddScoped<FamilyService>();
builder.Services.AddAccountIdentityDeletion(builder.Configuration, config);
builder.Services.AddScoped<DeletionProcessor>();
if (builder.Configuration.GetValue("AccountDeletion:WorkerEnabled", true)) builder.Services.AddHostedService<DeletionWorker>();
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer(options =>
{
    options.Authority = config.Entra.Authority;
    options.Audience = config.Entra.Audience.ToString("D");
    options.MapInboundClaims = false;
    options.RequireHttpsMetadata = true;
    options.SaveToken = false;
    options.IncludeErrorDetails = false;
    options.TokenValidationParameters = new TokenValidationParameters
    {
        ValidateIssuer = true,
        ValidIssuer = config.Entra.Authority,
        ValidateAudience = true,
        ValidAudience = config.Entra.Audience.ToString("D"),
        ValidateLifetime = true,
        RequireExpirationTime = true,
        RequireSignedTokens = true,
        ValidateIssuerSigningKey = true,
        ValidAlgorithms = [SecurityAlgorithms.RsaSha256],
        ClockSkew = TimeSpan.FromMinutes(1)
    };
    options.Events = new JwtBearerEvents
    {
        OnTokenValidated = context =>
        {
            var principal = context.Principal!;
            if (!Guid.TryParse(principal.FindFirstValue("tid"), out var tenant) || tenant != config.Entra.TenantId ||
                !Guid.TryParse(principal.FindFirstValue("azp"), out var client) || client != config.Entra.MobileClientId ||
                !Guid.TryParse(principal.FindFirstValue("oid"), out var objectId) || objectId == Guid.Empty ||
                principal.FindFirstValue("ver") != "2.0" ||
                !(principal.FindFirstValue("scp") ?? "").Split(' ', StringSplitOptions.RemoveEmptyEntries).Contains("Family.ReadWrite", StringComparer.Ordinal))
                context.Fail("Token not authorized for the family pilot.");
            return Task.CompletedTask;
        },
        OnChallenge = async context =>
        {
            context.HandleResponse();
            context.Response.StatusCode = 401;
            context.Response.Headers.WWWAuthenticate = "Bearer";
            await context.Response.WriteAsJsonAsync(new { code = "unauthorized" });
        },
        OnForbidden = async context =>
        {
            context.Response.StatusCode = 403;
            await context.Response.WriteAsJsonAsync(new { code = "forbidden" });
        }
    };
});
builder.Services.AddAuthorization();
builder.Services.AddRateLimiter(options =>
{
    // Finite partition count: one aggregate limit, plus one sensitive limit per admitted pilot account.
    // These availability limits are per instance; SQL limits and authorization remain cross-instance.
    options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(_ =>
        RateLimitPartition.GetFixedWindowLimiter("pilot-global", _ => new FixedWindowRateLimiterOptions
        { PermitLimit = config.Pilot.RequestsPerMinute, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
    options.AddPolicy("sensitive", context =>
    {
        var oid = context.User.FindFirstValue("oid");
        var key = config.Pilot.Identities.Any(x => x.ObjectId.ToString("D") == oid) ? oid! : "anonymous";
        return RateLimitPartition.GetFixedWindowLimiter(key, _ => new FixedWindowRateLimiterOptions
        { PermitLimit = config.Pilot.SensitiveRequestsPerMinute, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 });
    });
    options.OnRejected = async (context, ct) =>
    {
        context.HttpContext.Response.StatusCode = 429;
        context.HttpContext.Response.Headers.RetryAfter = "60";
        await context.HttpContext.Response.WriteAsJsonAsync(new { code = "rate_limited" }, ct);
    };
});

var app = builder.Build();
app.Use(async (context, next) =>
{
    context.Response.Headers.CacheControl = "no-store";
    context.Response.Headers["Referrer-Policy"] = "no-referrer";
    context.Response.Headers.XContentTypeOptions = "nosniff";
    try
    {
        if (context.Request.ContentLength > 16 * 1024) throw new ApiException(422, "invalid_input");
        await next(context);
    }
    catch (ApiException error) { await Error(context, error.Status, error.Code); }
    catch (BadHttpRequestException) { await Error(context, 422, "invalid_input"); }
    catch (JsonException) { await Error(context, 422, "invalid_input"); }
    catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested) { }
    catch (Exception)
    {
        // Never include raw exceptions: SQL/JWT errors can carry private payload or connection details.
        app.Logger.LogError("Family request failed; inspect database/service health without logging private requests.");
        await Error(context, 503, "service_unavailable");
    }
});
if (!app.Environment.IsDevelopment()) app.UseHsts();
app.UseAuthentication();
app.UseRateLimiter();
app.UseAuthorization();
app.MapGet("/health/live", () => Results.Json(new { status = "ok" })).DisableRateLimiting();
app.MapPost("/v1/account-deletion-status", (DeletionStatusRequest request, FamilyService service, CancellationToken ct) => service.DeletionStatus(request, ct));
var api = app.MapGroup("/v1").RequireAuthorization();
api.AddEndpointFilter(async (context, next) =>
{
    config.Admit(context.HttpContext.User);
    return await next(context);
});
api.MapGet("/me", (ClaimsPrincipal user, FamilyService service, CancellationToken ct) => service.Me(config.Admit(user), ct));
api.MapPost("/families", (ClaimsPrincipal user, CreateFamilyRequest request, FamilyService service, CancellationToken ct) =>
    service.CreateFamily(config.Admit(user), request, ct)).RequireRateLimiting("sensitive");
api.MapGet("/families/{familyId:guid}/snapshot", async (Guid familyId, HttpContext context, FamilyService service, CancellationToken ct) =>
{
    // Authorization is performed transactionally before any conditional-response comparison.
    var snapshot = await service.Snapshot(config.Admit(context.User), familyId, ct);
    var etag = $"\"{snapshot.HistoryId:D}:{snapshot.Revision}:{snapshot.Family.MembershipId:D}\"";
    context.Response.Headers.ETag = etag;
    return context.Request.Headers.IfNoneMatch.ToString() == etag ? Results.StatusCode(304) : Results.Json(snapshot);
});
api.MapPost("/families/{familyId:guid}/invitations", (Guid familyId, ClaimsPrincipal user, CreateInvitationRequest request, FamilyService service, CancellationToken ct) =>
    service.CreateInvitation(config.Admit(user), familyId, request, ct)).RequireRateLimiting("sensitive");
api.MapPost("/invitations/{invitationId:guid}/accept", (Guid invitationId, ClaimsPrincipal user, OperationRequest request, FamilyService service, CancellationToken ct) =>
    service.AcceptInvitation(config.Admit(user), invitationId, request, ct)).RequireRateLimiting("sensitive");
api.MapPost("/invitations/{invitationId:guid}/decline", (Guid invitationId, ClaimsPrincipal user, OperationRequest request, FamilyService service, CancellationToken ct) =>
    service.DeclineInvitation(config.Admit(user), invitationId, request, ct)).RequireRateLimiting("sensitive");
api.MapPost("/families/{familyId:guid}/invitations/{invitationId:guid}/revoke", (Guid familyId, Guid invitationId, ClaimsPrincipal user, OperationRequest request, FamilyService service, CancellationToken ct) =>
    service.RevokeInvitation(config.Admit(user), familyId, invitationId, request, ct));
api.MapPost("/families/{familyId:guid}/members/{userId:guid}/remove", (Guid familyId, Guid userId, ClaimsPrincipal user, OperationRequest request, FamilyService service, CancellationToken ct) =>
    service.RemoveMember(config.Admit(user), familyId, userId, request, ct));
api.MapPost("/families/{familyId:guid}/leave", (Guid familyId, ClaimsPrincipal user, OperationRequest request, FamilyService service, CancellationToken ct) =>
    service.Leave(config.Admit(user), familyId, request, ct));
api.MapPost("/families/{familyId:guid}/feed-operations", (Guid familyId, ClaimsPrincipal user, FeedOperation request, FamilyService service, CancellationToken ct) =>
    service.ApplyFeed(config.Admit(user), familyId, request, ct));
api.MapPost("/families/{familyId:guid}/profile", (Guid familyId, ClaimsPrincipal user, ProfileRequest request, FamilyService service, CancellationToken ct) =>
    service.UpdateProfile(config.Admit(user), familyId, request, ct));
api.MapPost("/families/{familyId:guid}/ownership-transfer", (Guid familyId, ClaimsPrincipal user, NominateOwnerRequest request, FamilyService service, CancellationToken ct) =>
    service.NominateOwner(config.Admit(user), familyId, request, ct));
api.MapPost("/families/{familyId:guid}/ownership-transfer/{transferId:guid}/accept", (Guid familyId, Guid transferId, ClaimsPrincipal user, OperationRequest request, FamilyService service, CancellationToken ct) =>
    service.AcceptOwnership(config.Admit(user), familyId, transferId, request, ct));
api.MapPost("/families/{familyId:guid}/ownership-transfer/{transferId:guid}/cancel", (Guid familyId, Guid transferId, ClaimsPrincipal user, OperationRequest request, FamilyService service, CancellationToken ct) =>
    service.CancelOwnership(config.Admit(user), familyId, transferId, request, ct));
api.MapPost("/families/{familyId:guid}/close", (Guid familyId, ClaimsPrincipal user, OperationRequest request, FamilyService service, CancellationToken ct) =>
    service.CloseFamily(config.Admit(user), familyId, request, ct)).RequireRateLimiting("sensitive");
api.MapPost("/account/delete", (ClaimsPrincipal user, DeleteAccountRequest request, FamilyService service, CancellationToken ct) =>
    service.DeleteAccount(config.Admit(user), request, ct)).RequireRateLimiting("sensitive");
app.Run();

static async Task Error(HttpContext context, int status, string code)
{
    if (context.Response.HasStarted) return;
    context.Response.StatusCode = status;
    await context.Response.WriteAsJsonAsync(new { code }, context.RequestAborted);
}

public partial class Program { }
