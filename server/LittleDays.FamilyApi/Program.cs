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
builder.Services.AddSingleton(config.Push);
builder.Services.AddSingleton<PushWakeSignal>();
builder.Services.AddHttpClient<IPushGateway, ExpoPushGateway>(http => http.Timeout = TimeSpan.FromSeconds(20))
    .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler { AllowAutoRedirect = false });
builder.Services.AddScoped<PushProcessor>();
if (config.Push.RegistrationEnabled || config.Push.EventCreationEnabled || config.Push.DeliveryEnabled)
    builder.Services.AddHostedService<PushWorker>();
builder.Services.AddSingleton<RecoveryGate>();
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddScoped<FamilyService>();
builder.Services.AddPublicIdentityAdmission(config);
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
    // Only validated JWT identities receive an account partition. Anonymous traffic
    // has a separate aggregate budget; neither forwarded headers nor caller-supplied
    // IDs can claim a different bucket. Distinct accounts never share hash buckets.
    // These limits are per instance; SQL authorization/quotas remain cross-instance.
    options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(context =>
        RateLimitPartition.GetFixedWindowLimiter(RateLimitKey(context), _ => new FixedWindowRateLimiterOptions
        { PermitLimit = config.Pilot.RequestsPerMinute, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
    options.AddPolicy("sensitive", context =>
    {
        return RateLimitPartition.GetFixedWindowLimiter(RateLimitKey(context), _ => new FixedWindowRateLimiterOptions
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
        var fullUpload = context.Request.Method == "POST" &&
            (context.Request.Path == "/v2/families" || context.Request.Path.StartsWithSegments("/v2/families") &&
                context.Request.Path.Value!.EndsWith("/record-operations", StringComparison.Ordinal));
        var limit = fullUpload ? FullDomainValidation.MaxSeedBytes + 64 * 1024
            : context.Request.Path.StartsWithSegments("/v2") ? 128 * 1024 : 16 * 1024;
        var bodyLimit = context.Features.Get<Microsoft.AspNetCore.Http.Features.IHttpMaxRequestBodySizeFeature>();
        if (bodyLimit is { IsReadOnly: false }) bodyLimit.MaxRequestBodySize = limit;
        if (context.Request.ContentLength > limit) throw new ApiException(422, "invalid_input");
        if ((context.Request.Path.StartsWithSegments("/v1") || context.Request.Path.StartsWithSegments("/v2")) &&
            context.RequestServices.GetRequiredService<RecoveryGate>().Blocked)
            throw new ApiException(503, "recovery_blocked");
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
app.MapGet("/health/ready", (RecoveryGate gate) => gate.Blocked
    ? Results.Json(new { code = "recovery_blocked" }, statusCode: 503)
    : Results.Json(new { status = "ready" })).DisableRateLimiting();
// Keep outside the directory-admitted groups: recognize the validated token without
// waking SQL or contacting Graph. An unexpired token can belong to a disabled/deleted
// account; only /me and the guarded family endpoints can establish current access.
// Global JWT checks, rate limits, no-store headers and the recovery gate still apply.
app.MapGet("/v1/session", (HttpContext context) =>
    new TokenSession(PublicIdentityAdmission.ObjectId(context.User, config.Entra.TenantId)))
    .RequireAuthorization();
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
    var result = await service.ConditionalSnapshot(PublicIdentityAdmission.Get(context), familyId, context.Request.Headers.IfNoneMatch.ToString(), ct);
    context.Response.Headers.ETag = result.ETag;
    return result.Snapshot is null ? Results.StatusCode(304) : Results.Json(result.Snapshot, FamilyAvailability.SnapshotJson);
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
fullApi.MapGet("/push/capabilities", (HttpContext context) =>
{
    var allowed = config.Push.Allows(PublicIdentityAdmission.Get(context).ObjectId);
    return new { registrationEnabled = config.Push.RegistrationEnabled && allowed,
        eventCreationEnabled = config.Push.EventCreationEnabled && allowed, categories = PushPolicy.Categories,
        projectId = config.Push.RegistrationEnabled && allowed ? (Guid?)config.Push.ProjectId : null };
});
fullApi.MapPut("/push/installations/{installationId:guid}", (Guid installationId, HttpContext context,
    RegisterPushRequest request, FamilyService service, CancellationToken ct) =>
    service.RegisterPush(PublicIdentityAdmission.Get(context), installationId, request, ct)).RequireRateLimiting("sensitive");
fullApi.MapPost("/push/installations/{installationId:guid}/unregister", (Guid installationId, HttpContext context,
    UnregisterPushRequest request, FamilyService service, CancellationToken ct) =>
    service.UnregisterPush(PublicIdentityAdmission.Get(context), installationId, request, ct)).RequireRateLimiting("sensitive");
fullApi.MapPost("/families", (HttpContext context, CreateFullFamilyRequest request, FamilyService service, CancellationToken ct) =>
    FullCreation(context, request, service, ct)).RequireRateLimiting("sensitive");
fullApi.MapGet("/families/{familyId:guid}/snapshot", async (Guid familyId, HttpContext context, FamilyService service, CancellationToken ct) =>
{
    var result = await service.ConditionalFullSnapshot(PublicIdentityAdmission.Get(context), familyId, context.Request.Headers.IfNoneMatch.ToString(), ct);
    context.Response.Headers.ETag = result.ETag;
    return result.Snapshot is null ? Results.StatusCode(304) : Results.Json(result.Snapshot, FamilyAvailability.SnapshotJson);
});
fullApi.MapPost("/families/{familyId:guid}/record-operations", (Guid familyId, HttpContext context, FullRecordOperation request, FamilyService service, CancellationToken ct) =>
    service.ApplyFullRecord(PublicIdentityAdmission.Get(context), familyId, request, ct));
fullApi.MapPost("/families/{familyId:guid}/profile", (Guid familyId, HttpContext context, FullProfileRequest request, FamilyService service, CancellationToken ct) =>
    service.UpdateFullProfile(PublicIdentityAdmission.Get(context), familyId, request, ct));
app.Run();

static async Task<IResult> FullCreation(HttpContext context, CreateFullFamilyRequest request, FamilyService service, CancellationToken ct) =>
    Results.Json(await service.CreateFullFamily(PublicIdentityAdmission.Get(context), request, ct), FamilyAvailability.SnapshotJson);

static async Task Error(HttpContext context, int status, string code)
{
    if (context.Response.HasStarted) return;
    context.Response.StatusCode = status;
    await context.Response.WriteAsJsonAsync(new { code }, context.RequestAborted);
}

static string RateLimitKey(HttpContext context) =>
    context.User.Identity?.IsAuthenticated == true && Guid.TryParse(context.User.FindFirstValue("oid"), out var account)
        ? $"account:{account:D}" : "anonymous";

public partial class Program { }
