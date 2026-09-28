using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace LittleDays.FamilyApi;

public static partial class FullDomainValidation
{
    public const int MaxAvatarBytes = 12 * 1024 * 1024;
    public static bool IsExtraSingleton(string id) => id is "avatar" or "play-selection" or "reminder-settings";

    public static void ExtraRecord(JsonElement record)
    {
        var id = Text(Property(record, "id"), 128);
        if (id.Trim() != id || id.Any(char.IsControl)) Invalid();
        var kind = Choice(Property(record, "kind"), "avatar", "play-selection", "play-checkin", "reminder", "reminder-settings");
        if (IsExtraSingleton(kind) ? id != kind : IsExtraSingleton(id)) Invalid();
        switch (kind)
        {
            case "avatar":
                Fields(record, "id", "kind", "dataUrl");
                var photo = Property(record, "dataUrl");
                if (photo.ValueKind != JsonValueKind.Null) Avatar(photo);
                break;
            case "play-selection":
                Fields(record, "id", "kind", "selection");
                var selection = Property(record, "selection");
                Fields(selection, "included", "excluded");
                var ids = new HashSet<string>(StringComparer.Ordinal);
                foreach (var key in new[] { "included", "excluded" })
                    foreach (var activity in Array(Property(selection, key), 1000))
                        if (!ids.Add(ActivityId(activity))) Invalid();
                break;
            case "play-checkin":
                Fields(record, "id", "kind", "day", "activityId");
                Date(Text(Property(record, "day"), 10));
                ActivityId(Property(record, "activityId"));
                break;
            case "reminder":
                Fields(record, "id", "kind", "settings", "onceAt");
                var settings = Property(record, "settings");
                ReminderSettings(settings);
                if (Property(settings, "mode").GetString() == "once") Instant(Property(record, "onceAt"));
                else if (record.TryGetProperty("onceAt", out _)) Invalid();
                break;
            case "reminder-settings":
                Fields(record, "id", "kind", "settings");
                var saved = Property(record, "settings");
                if (saved.ValueKind != JsonValueKind.Null) ReminderSettings(saved);
                break;
        }
        // Keep settings/check-ins within the original record-size bound; only the
        // single family avatar has a larger, separately validated binary limit.
        if (Encoding.Unicode.GetByteCount(record.GetRawText()) > (kind == "avatar" ? 34 * 1024 * 1024 : 131072)) Invalid();
    }

    private static string ActivityId(JsonElement value)
    {
        var id = Text(value, 200);
        if (!ActivityIdPattern().IsMatch(id)) Invalid();
        return id;
    }
    [GeneratedRegex(@"^[A-Za-z0-9_-]+$")]
    private static partial Regex ActivityIdPattern();

    private static void ReminderSettings(JsonElement value)
    {
        Fields(value, "kind", "mode", "title", "minutes", "dailyTime", "silent");
        var kind = Choice(Property(value, "kind"), "feed", "diaper", "sleep");
        var mode = Choice(Property(value, "mode"), "once", "daily", "after-feed");
        if (mode == "after-feed" && kind != "feed") Invalid();
        Text(Property(value, "title"), 100, true);
        Number(Property(value, "minutes"), 1, 10080);
        var time = Text(Property(value, "dailyTime"), 5, true);
        if (mode == "daily")
        {
            if (!System.TimeOnly.TryParseExact(time, "HH:mm", System.Globalization.CultureInfo.InvariantCulture,
                    System.Globalization.DateTimeStyles.None, out _)) Invalid();
        }
        else if (time != "") Invalid();
        if (Property(value, "silent").ValueKind is not (JsonValueKind.True or JsonValueKind.False)) Invalid();
    }

    private static void Avatar(JsonElement value)
    {
        var text = Text(value, ((MaxAvatarBytes + 2) / 3 * 4) + 32);
        var comma = text.IndexOf(',');
        if (comma < 0) Invalid();
        var mime = text[..comma];
        if (mime is not ("data:image/jpeg;base64" or "data:image/png;base64" or "data:image/heic;base64" or "data:image/webp;base64")) Invalid();
        var encoded = text[(comma + 1)..];
        if (encoded.Length == 0 || encoded.Length % 4 != 0 || encoded.Any(char.IsWhiteSpace)) Invalid();
        byte[] bytes;
        try { bytes = Convert.FromBase64String(encoded); }
        catch (FormatException) { Invalid(); return; }
        if (bytes.Length > MaxAvatarBytes || Convert.ToBase64String(bytes) != encoded) Invalid();
        var valid = mime switch
        {
            "data:image/jpeg;base64" => bytes.Length >= 3 && bytes[0] == 0xff && bytes[1] == 0xd8 && bytes[2] == 0xff,
            "data:image/png;base64" => bytes.AsSpan().StartsWith(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 }),
            "data:image/webp;base64" => bytes.Length >= 12 && bytes.AsSpan(0, 4).SequenceEqual("RIFF"u8) && bytes.AsSpan(8, 4).SequenceEqual("WEBP"u8),
            "data:image/heic;base64" => bytes.Length >= 12 && bytes.AsSpan(4, 4).SequenceEqual("ftyp"u8) &&
                new[] { "heic", "heix", "hevc", "hevx" }.Contains(Encoding.ASCII.GetString(bytes, 8, 4), StringComparer.Ordinal),
            _ => false
        };
        if (!valid) Invalid();
    }
}
