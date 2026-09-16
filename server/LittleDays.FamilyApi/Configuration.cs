using System.Net.Mail;
using System.Security.Claims;

namespace LittleDays.FamilyApi;

public sealed class EntraSettings
{
    public Guid TenantId { get; set; }
    public Guid Audience { get; set; }
    public Guid MobileClientId { get; set; }
    public string Authority => $"https://{TenantId:D}.ciamlogin.com/{TenantId:D}/v2.0";
}

public sealed class FamilySettings
{
    public string PublicBaseUrl { get; set; } = "";
    public Guid HistoryId { get; set; }
}

public sealed class PilotIdentity
{
    public Guid ObjectId { get; set; }
    public string Email { get; set; } = "";
    public string DisplayName { get; set; } = "";
}

public sealed class PilotSettings
{
    public PilotIdentity[] Identities { get; set; } = [];
    public int MaxMembers { get; set; } = 6;
    // Keep the legacy setting readable, but never let an old value (such as 20)
    // expand the product limit: one administrator plus five invited members.
    public int EffectiveMaxMembers => Math.Min(MaxMembers, 6);
    public int MaxFeeds { get; set; } = 1000;
    public int MaxOperationsPerFamily { get; set; } = 100000;
    public int MaxNoteLength { get; set; } = 500;
    public int MaxBabyNameLength { get; set; } = 60;
    public int RequestsPerMinute { get; set; } = 120;
    public int SensitiveRequestsPerMinute { get; set; } = 10;
}

public sealed record PilotConfiguration(EntraSettings Entra, FamilySettings Family, PilotSettings Pilot)
{
    // Direct constructors support isolated fixtures; deployed configuration must choose its mode.
    public PublicIdentitySettings Admission { get; init; } = new() { Mode = "Static" };

    public static PilotConfiguration Load(IConfiguration configuration)
    {
        var entra = configuration.GetSection("Entra").Get<EntraSettings>() ?? new();
        var family = configuration.GetSection("Family").Get<FamilySettings>() ?? new();
        var pilot = configuration.GetSection("Pilot").Get<PilotSettings>() ?? new();
        var admission = PublicIdentitySettings.Load(configuration);
        if (entra.TenantId == Guid.Empty || entra.Audience == Guid.Empty || entra.MobileClientId == Guid.Empty ||
            family.HistoryId == Guid.Empty || !Uri.TryCreate(family.PublicBaseUrl, UriKind.Absolute, out var uri) ||
            uri.Scheme != "https" || uri.UserInfo.Length != 0 || uri.Query.Length != 0 || uri.Fragment.Length != 0 ||
            uri.AbsolutePath != "/")
            throw new InvalidOperationException("Entra and Family configuration must contain valid IDs and a public HTTPS origin.");
        // Removing the final checked binding must not disable health/deletion-receipt access.
        // An empty list admits no authenticated users; it is not an authentication fallback.
        if (pilot.Identities.Length > 20 || pilot.MaxMembers is < 2 or > 20 ||
            pilot.MaxFeeds is < 1 or > 10000 || pilot.MaxOperationsPerFamily is < 10 or > 1000000 ||
            pilot.MaxNoteLength is < 1 or > 500 ||
            pilot.MaxBabyNameLength is < 1 or > 60 || pilot.RequestsPerMinute is < 1 or > 600 ||
            pilot.SensitiveRequestsPerMinute is < 1 or > 60)
            throw new InvalidOperationException("Pilot identities and limits must be explicitly valid.");
        foreach (var identity in pilot.Identities)
        {
            identity.Email = NormalizeEmail(identity.Email);
            identity.DisplayName = identity.DisplayName.Trim();
            if (identity.ObjectId == Guid.Empty || !IsEmail(identity.Email) || identity.DisplayName.Length is < 1 or > 80 ||
                identity.DisplayName.Any(char.IsControl))
                throw new InvalidOperationException("Each pilot binding requires a valid object ID, checked email and display name.");
        }
        if (pilot.Identities.Select(x => x.ObjectId).Distinct().Count() != pilot.Identities.Length ||
            pilot.Identities.Select(x => x.Email).Distinct(StringComparer.Ordinal).Count() != pilot.Identities.Length)
            throw new InvalidOperationException("Pilot object IDs and recipient emails must be unique.");
        family.PublicBaseUrl = uri.GetLeftPart(UriPartial.Authority);
        return new(entra, family, pilot) { Admission = admission };
    }

    public PilotIdentity Admit(ClaimsPrincipal principal)
    {
        if (Admission.Mode != "Static") throw new ApiException(503, "identity_unavailable");
        // Only immutable object IDs in an already validated tenant identify an account.
        // Generic email/preferred_username claims are intentionally ignored.
        if (!Guid.TryParse(principal.FindFirstValue("oid"), out var objectId))
            throw new ApiException(401, "unauthorized");
        return Pilot.Identities.SingleOrDefault(x => x.ObjectId == objectId)
            ?? throw new ApiException(403, "pilot_not_admitted");
    }

    public static string NormalizeEmail(string? email) => (email ?? "").Trim().ToLowerInvariant();
    public static bool IsEmail(string email) => email.Length is > 0 and <= 254 &&
        !email.Any(char.IsControl) && MailAddress.TryCreate(email, out var address) && address.Address == email;
}
