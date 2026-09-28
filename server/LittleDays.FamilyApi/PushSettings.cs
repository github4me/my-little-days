using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace LittleDays.FamilyApi;

public sealed class PushSettings
{
    public bool RegistrationEnabled { get; set; }
    public bool EventCreationEnabled { get; set; }
    public bool DeliveryEnabled { get; set; }
    public Guid ProjectId { get; set; }
    public string Environment { get; set; } = "production";
    public string TokenEncryptionKey { get; set; } = "";
    public string AccessToken { get; set; } = "";
    public bool AllowAllUsers { get; set; }
    public Guid[] AllowedUserIds { get; set; } = [];
    public int MaxInstallationsPerAccount { get; set; } = 5;
    public bool Allows(Guid userId) => userId != Guid.Empty && (AllowAllUsers || AllowedUserIds.Contains(userId));
    public static PushSettings Load(IConfiguration configuration)
    {
        var value = configuration.GetSection("Push").Get<PushSettings>() ?? new();
        if (value.MaxInstallationsPerAccount is < 1 or > 10 || value.AllowedUserIds.Length > 100 ||
            value.AllowedUserIds.Contains(Guid.Empty) || !Regex.IsMatch(value.Environment, "^[a-z][a-z0-9-]{0,31}$"))
            throw new InvalidOperationException("Invalid push limits or environment.");
        if (value.RegistrationEnabled || value.EventCreationEnabled || value.DeliveryEnabled)
        {
            if (!value.AllowAllUsers && value.AllowedUserIds.Length == 0)
                throw new InvalidOperationException("Push requires an explicit acceptance cohort or AllowAllUsers opt-in.");
            if (value.ProjectId == Guid.Empty) throw new InvalidOperationException("Push project ID is required.");
            try { if (Convert.FromBase64String(value.TokenEncryptionKey).Length != 32) throw new FormatException(); }
            catch (FormatException) { throw new InvalidOperationException("Push token encryption requires a persistent 32-byte base64 key."); }
        }
        if (value.DeliveryEnabled && (string.IsNullOrWhiteSpace(value.AccessToken) || value.AccessToken.Any(char.IsControl)))
            throw new InvalidOperationException("Protected Expo push access token is required for delivery.");
        return value;
    }
}

public sealed record RegisterPushRequest(Guid OperationId, string InstallationSecret, int ExpectedGeneration,
    string ExpoPushToken, Guid ProjectId, string Platform, string Locale, bool Enabled, string[] Categories,
    Guid FamilyId, Guid MembershipId, Guid HistoryId);
public sealed record UnregisterPushRequest(Guid OperationId, string InstallationSecret, int ExpectedGeneration);
public sealed record PushRegistrationResult(Guid OperationId, Guid InstallationId, int Generation,
    bool Enabled, string[] Categories, DateTimeOffset ExpiresAt);

public static class PushPolicy
{
    public static readonly string[] Categories = ["feed", "diaper", "sleep"];
    public static readonly string[] SupportedLocales =
        ["en", "zh-Hans", "zh-Hant", "fr", "de", "hi", "it", "ja", "ko", "es", "th", "vi"];
    public static bool IsSupportedLocale(string? locale) =>
        locale == "zh" || locale is not null && SupportedLocales.Contains(locale, StringComparer.Ordinal);
    // `zh` is the only legacy registration ID. Unknown persisted values fail
    // safely to English instead of being interpreted as Chinese.
    public static string DeliveryLocale(string? locale) => locale == "zh" ? "zh-Hans" :
        locale is not null && SupportedLocales.Contains(locale, StringComparer.Ordinal) ? locale : "en";
    public static int CategoryMask(IEnumerable<string> categories) => categories.Aggregate(0, (mask, category) =>
        mask | category switch { "feed" => 1, "diaper" => 2, "sleep" => 4, _ => 0 });
    public static string[] ReadCategories(int mask) => Categories.Where(x => (CategoryMask([x]) & mask) != 0).ToArray();
    public static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
    public static void ValidateSecret(Guid id, Guid operationId, string? secret, int generation)
    {
        if (id == Guid.Empty || operationId == Guid.Empty || generation < 0 ||
            secret is null || !Regex.IsMatch(secret, "^[a-f0-9]{64}$")) throw new ApiException(422, "invalid_input");
    }
    public static bool SecretMatches(string secret, string hash) =>
        CryptographicOperations.FixedTimeEquals(Convert.FromHexString(Hash(secret)), Convert.FromHexString(hash));
    public static void Validate(RegisterPushRequest value, Guid installationId, PushSettings settings)
    {
        ValidateSecret(installationId, value.OperationId, value.InstallationSecret, value.ExpectedGeneration);
        if (value.ExpoPushToken is null || !Regex.IsMatch(value.ExpoPushToken, "^(Expo|Exponent)PushToken\\[[A-Za-z0-9_-]{10,200}\\]$") ||
            value.ProjectId != settings.ProjectId || value.Platform is not ("ios" or "android") || !IsSupportedLocale(value.Locale) ||
            value.Categories is null || value.Categories.Length > 3 || value.Categories.Distinct().Count() != value.Categories.Length ||
            value.Categories.Any(x => !Categories.Contains(x)) || value.Enabled && value.Categories.Length == 0 ||
            value.FamilyId == Guid.Empty || value.MembershipId == Guid.Empty || value.HistoryId == Guid.Empty)
            throw new ApiException(422, "invalid_input");
    }
    public static string? ActiveTimer(JsonElement value) => value.GetProperty("type").GetString() switch
    {
        "sleep" when !value.TryGetProperty("end", out _) => "sleep",
        "feed" when value.TryGetProperty("feedRunning", out var running) && running.ValueKind == JsonValueKind.True => "feed",
        _ => null
    };
    public static DateTimeOffset NotBefore(JsonElement value, DateTimeOffset committed) => ActiveTimer(value) == "sleep"
        ? Max(committed.AddSeconds(60), value.GetProperty("start").GetDateTimeOffset().AddSeconds(60)) : committed;
    public static DateTimeOffset Window(DateTimeOffset value) => DateTimeOffset.FromUnixTimeSeconds(value.ToUnixTimeSeconds() / 300 * 300);
    public static DateTimeOffset Max(DateTimeOffset one, DateTimeOffset two) => one > two ? one : two;
    public static TimeSpan RetryDelay(int attempts) => TimeSpan.FromSeconds(Math.Min(900, Math.Pow(2, Math.Min(attempts, 9))) + Random.Shared.Next(1, 10));
}

// A dedicated persistent key is required: ephemeral App Service data-protection keys
// must not make registered tokens unreadable after a host restart. Never log this class.
public sealed class PushTokenProtector(PushSettings settings)
{
    public string Protect(string token)
    {
        var nonce = RandomNumberGenerator.GetBytes(12);
        var bytes = Encoding.UTF8.GetBytes(token);
        var encrypted = new byte[bytes.Length];
        var tag = new byte[16];
        using var aes = new AesGcm(Convert.FromBase64String(settings.TokenEncryptionKey), 16);
        aes.Encrypt(nonce, bytes, encrypted, tag, Encoding.UTF8.GetBytes(settings.ProjectId + ":" + settings.Environment));
        return Convert.ToBase64String(nonce.Concat(tag).Concat(encrypted).ToArray());
    }
    public string Unprotect(string token)
    {
        var bytes = Convert.FromBase64String(token);
        if (bytes.Length < 29) throw new CryptographicException();
        var plain = new byte[bytes.Length - 28];
        using var aes = new AesGcm(Convert.FromBase64String(settings.TokenEncryptionKey), 16);
        aes.Decrypt(bytes.AsSpan(0, 12), bytes.AsSpan(28), bytes.AsSpan(12, 16), plain,
            Encoding.UTF8.GetBytes(settings.ProjectId + ":" + settings.Environment));
        return Encoding.UTF8.GetString(plain);
    }
}
