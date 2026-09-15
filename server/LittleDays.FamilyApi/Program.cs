using System.Security.Claims;
using System.Text.Json;
using System.Threading.RateLimiting;
using LittleDays.FamilyApi;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;

if (args.Contains("--migrate", StringComparer.Ordinal))
    throw new InvalidOperationException("Schema changes use LittleDays.DatabaseMigrator, not the API runtime.");
var builder = WebApplication.CreateBuilder(args);
// Request bodies, query strings, tokens, identities and SQL parameter values are never logged here.
builder.Logging.AddFilter("Microsoft.AspNetCore", LogLevel.Warning);
builder.Logging.AddFilter("Microsoft.EntityFrameworkCore", LogLevel.None);
builder.Logging.AddFilter("Microsoft.AspNetCore.Authentication", LogLevel.None);
builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = FullDomainValidation.MaxSeedBytes + 64 * 1024);
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

var config = PilotConfiguration.Load(builder.Configuration);
builder.Services.AddSingleton(config);
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddScoped<FamilyService>();
builder.Services.AddPublicIdentityAdmission(builder.Configuration, config);
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
                context.Fail("Token not authorized for family sharing.");
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
    // Finite partition count: one aggregate limit and 256 authenticated-account buckets.
    // These availability limits are per instance; SQL limits and authorization remain cross-instance.
    options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(_ =>
        RateLimitPartition.GetFixedWindowLimiter("pilot-global", _ => new FixedWindowRateLimiterOptions
        { PermitLimit = config.Pilot.RequestsPerMinute, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
    options.AddPolicy("sensitive", context =>
    {
        var oid = context.User.FindFirstValue("oid");
        var key = Guid.TryParse(oid, out var account) ? (account.GetHashCode() & 255).ToString(System.Globalization.CultureInfo.InvariantCulture) : "anonymous";
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
        var limit = context.Request.Method == "POST" && context.Request.Path == "/v2/families"
            ? FullDomainValidation.MaxSeedBytes + 64 * 1024 : context.Request.Path.StartsWithSegments("/v2") ? 128 * 1024 : 16 * 1024;
        var bodyLimit = context.Features.Get<Microsoft.AspNetCore.Http.Features.IHttpMaxRequestBodySizeFeature>();
        if (bodyLimit is { IsReadOnly: false }) bodyLimit.MaxRequestBodySize = limit;
        if (context.Request.ContentLength > limit) throw new ApiException(422, "invalid_input");
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
    var admission = context.HttpContext.RequestServices.GetRequiredService<IPublicIdentityAdmission>();
    PublicIdentityAdmission.Set(context.HttpContext, await admission.AdmitAsync(context.HttpContext.User, context.HttpContext.RequestAborted));
    return await next(context);
});
api.MapGet("/me", (HttpContext context, FamilyService service, CancellationToken ct) => service.Me(PublicIdentityAdmission.Get(context), ct));
api.MapPost("/families", (HttpContext context, CreateFamilyRequest request, FamilyService service, CancellationToken ct) =>
    service.CreateFamily(PublicIdentityAdmission.Get(context), request, ct)).RequireRateLimiting("sensitive");
api.MapGet("/families/{familyId:guid}/snapshot", async (Guid familyId, HttpContext context, FamilyService service, CancellationToken ct) =>
{
    // Authorization is performed transactionally before any conditional-response comparison.
    var snapshot = await service.Snapshot(PublicIdentityAdmission.Get(context), familyId, ct);
    var etag = $"\"{snapshot.HistoryId:D}:{snapshot.Revision}:{snapshot.Family.MembershipId:D}\"";
    context.Response.Headers.ETag = etag;
    return context.Request.Headers.IfNoneMatch.ToString() == etag ? Results.StatusCode(304) : Results.Json(snapshot);
});
api.MapPost("/families/{familyId:guid}/invitations", (Guid familyId, HttpContext context, CreateInvitationRequest request, FamilyService service, CancellationToken ct) =>
    service.CreateInvitation(PublicIdentityAdmission.Get(context), familyId, request, ct)).RequireRateLimiting("sensitive");
api.MapPost("/invitations/{invitationId:guid}/accept", (Guid invitationId, HttpContext context, OperationRequest request, FamilyService service, CancellationToken ct) =>
    service.AcceptInvitation(PublicIdentityAdmission.Get(context), invitationId, request, ct)).RequireRateLimiting("sensitive");
api.MapPost("/invitations/{invitationId:guid}/decline", (Guid invitationId, HttpContext context, OperationRequest request, FamilyService service, CancellationToken ct) =>
    service.DeclineInvitation(PublicIdentityAdmission.Get(context), invitationId, request, ct)).RequireRateLimiting("sensitive");
api.MapPost("/families/{familyId:guid}/invitations/{invitationId:guid}/revoke", (Guid familyId, Guid invitationId, HttpContext context, OperationRequest request, FamilyService service, CancellationToken ct) =>
    service.RevokeInvitation(PublicIdentityAdmission.Get(context), familyId, invitationId, request, ct));
api.MapPost("/families/{familyId:guid}/members/{userId:guid}/remove", (Guid familyId, Guid userId, HttpContext context, OperationRequest request, FamilyService service, CancellationToken ct) =>
    service.RemoveMember(PublicIdentityAdmission.Get(context), familyId, userId, request, ct));
api.MapPost("/families/{familyId:guid}/leave", (Guid familyId, HttpContext context, OperationRequest request, FamilyService service, CancellationToken ct) =>
    service.Leave(PublicIdentityAdmission.Get(context), familyId, request, ct));
api.MapPost("/families/{familyId:guid}/feed-operations", (Guid familyId, HttpContext context, FeedOperation request, FamilyService service, CancellationToken ct) =>
    service.ApplyFeed(PublicIdentityAdmission.Get(context), familyId, request, ct));
api.MapPost("/families/{familyId:guid}/profile", (Guid familyId, HttpContext context, ProfileRequest request, FamilyService service, CancellationToken ct) =>
    service.UpdateProfile(PublicIdentityAdmission.Get(context), familyId, request, ct));
api.MapPost("/families/{familyId:guid}/ownership-transfer", (Guid familyId, HttpContext context, NominateOwnerRequest request, FamilyService service, CancellationToken ct) =>
    service.NominateOwner(PublicIdentityAdmission.Get(context), familyId, request, ct));
api.MapPost("/families/{familyId:guid}/ownership-transfer/{transferId:guid}/accept", (Guid familyId, Guid transferId, HttpContext context, OperationRequest request, FamilyService service, CancellationToken ct) =>
    service.AcceptOwnership(PublicIdentityAdmission.Get(context), familyId, transferId, request, ct));
api.MapPost("/families/{familyId:guid}/ownership-transfer/{transferId:guid}/cancel", (Guid familyId, Guid transferId, HttpContext context, OperationRequest request, FamilyService service, CancellationToken ct) =>
    service.CancelOwnership(PublicIdentityAdmission.Get(context), familyId, transferId, request, ct));
api.MapPost("/families/{familyId:guid}/close", (Guid familyId, HttpContext context, OperationRequest request, FamilyService service, CancellationToken ct) =>
    service.CloseFamily(PublicIdentityAdmission.Get(context), familyId, request, ct)).RequireRateLimiting("sensitive");
api.MapPost("/account/delete", (HttpContext context, DeleteAccountRequest request, FamilyService service, CancellationToken ct) =>
    service.DeleteAccount(PublicIdentityAdmission.Get(context), request, ct)).RequireRateLimiting("sensitive");
var fullApi = app.MapGroup("/v2").RequireAuthorization();
fullApi.AddEndpointFilter(async (context, next) =>
{
    var admission = context.HttpContext.RequestServices.GetRequiredService<IPublicIdentityAdmission>();
    PublicIdentityAdmission.Set(context.HttpContext, await admission.AdmitAsync(context.HttpContext.User, context.HttpContext.RequestAborted));
    return await next(context);
});
fullApi.MapGet("/capabilities", () => new FullFamilyCapabilities(2, FullDomainValidation.RecordKinds, FullDomainValidation.MaxSeedBytes));
fullApi.MapPost("/families", (HttpContext context, CreateFullFamilyRequest request, FamilyService service, CancellationToken ct) =>
    service.CreateFullFamily(PublicIdentityAdmission.Get(context), request, ct)).RequireRateLimiting("sensitive");
fullApi.MapGet("/families/{familyId:guid}/snapshot", async (Guid familyId, HttpContext context, FamilyService service, CancellationToken ct) =>
{
    var snapshot = await service.FullSnapshot(PublicIdentityAdmission.Get(context), familyId, ct);
    var etag = $"\"v2:{snapshot.HistoryId:D}:{snapshot.Revision}:{snapshot.Family.MembershipId:D}\"";
    context.Response.Headers.ETag = etag;
    return context.Request.Headers.IfNoneMatch.ToString() == etag ? Results.StatusCode(304) : Results.Json(snapshot);
});
fullApi.MapPost("/families/{familyId:guid}/record-operations", (Guid familyId, HttpContext context, FullRecordOperation request, FamilyService service, CancellationToken ct) =>
    service.ApplyFullRecord(PublicIdentityAdmission.Get(context), familyId, request, ct));
fullApi.MapPost("/families/{familyId:guid}/profile", (Guid familyId, HttpContext context, FullProfileRequest request, FamilyService service, CancellationToken ct) =>
    service.UpdateFullProfile(PublicIdentityAdmission.Get(context), familyId, request, ct));
app.Run();

static async Task Error(HttpContext context, int status, string code)
{
    if (context.Response.HasStarted) return;
    context.Response.StatusCode = status;
    await context.Response.WriteAsJsonAsync(new { code }, context.RequestAborted);
}

public partial class Program { }
