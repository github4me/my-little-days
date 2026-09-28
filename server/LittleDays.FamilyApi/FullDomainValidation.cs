using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace LittleDays.FamilyApi;

// Mirrors the offline domain's individual-record bounds. Family members may each have
// active timers; only the initial owner's seed requires every timer to be stopped.
public static partial class FullDomainValidation
{
    public const int MaxSeedBytes = 32 * 1024 * 1024;
    public const int MaxSourceBytes = 10 * 1024 * 1024;
    public const int MaxRecordsPerCollection = 100000;
    public static readonly string[] RecordKinds = ["feed", "diaper", "sleep", "growth", "milestone", "care"];

    public sealed record SeedData(FullFamilyProfile Profile, JsonElement[] Entries, JsonElement[] CareRecords, string[] InviteeEmails, JsonElement[] ExtraRecords);

    public static SeedData Seed(JsonElement seed)
    {
        if (seed.ValueKind != JsonValueKind.Object || Encoding.UTF8.GetByteCount(seed.GetRawText()) > MaxSeedBytes) Invalid();
        Fields(seed, "schemaVersion", "source", "inviteeEmails", "counts", "extrasSchemaVersion", "extraRecords");
        Integer(Property(seed, "schemaVersion"), 1, 1);
        var source = Property(seed, "source");
        if (Encoding.UTF8.GetByteCount(source.GetRawText()) > MaxSourceBytes) Invalid();
        var hasExtras = seed.TryGetProperty("extrasSchemaVersion", out var extrasVersion);
        if (hasExtras != seed.TryGetProperty("extraRecords", out var extraArray)) Invalid();
        if (hasExtras) Integer(extrasVersion, 1, 1);
        else if (Encoding.UTF8.GetByteCount(seed.GetRawText()) > MaxSourceBytes) Invalid();
        var extras = hasExtras ? Array(extraArray, MaxRecordsPerCollection) : [];
        var extraIds = new HashSet<string>(StringComparer.Ordinal);
        foreach (var extra in extras)
        {
            ExtraRecord(extra);
            if (!extraIds.Add(Property(extra, "id").GetString()!)) Invalid();
        }
        Fields(source, "schemaVersion", "profile", "entries", "careRecords");
        Integer(Property(source, "schemaVersion"), 1, 1);
        var profile = Profile(Property(source, "profile"));
        var entries = Array(Property(source, "entries"), MaxRecordsPerCollection);
        var careRecords = source.TryGetProperty("careRecords", out var care) ? Array(care, MaxRecordsPerCollection) : [];
        var ids = new HashSet<string>(StringComparer.Ordinal);
        foreach (var entry in entries)
        {
            Entry(entry);
            if (!ids.Add(Text(Property(entry, "id"), 128))) Invalid();
            if (entry.TryGetProperty("feedRunning", out _) ||
                Text(Property(entry, "type"), 10) == "sleep" && !entry.TryGetProperty("end", out _))
                throw new ApiException(422, "running_timers");
        }
        ids.Clear();
        foreach (var record in careRecords)
        {
            CareRecord(record);
            if (!ids.Add(Text(Property(record, "id"), 128))) Invalid();
        }
        var emails = Array(Property(seed, "inviteeEmails"), 100).Select(x => PilotConfiguration.NormalizeEmail(Text(x, 254))).ToArray();
        if (emails.Any(x => !PilotConfiguration.IsEmail(x)) || emails.Distinct(StringComparer.Ordinal).Count() != emails.Length) Invalid();
        var counts = Property(seed, "counts");
        Fields(counts, "feed", "diaper", "sleep", "growth", "milestone", "care", "total");
        foreach (var kind in RecordKinds.Where(x => x != "care"))
            Integer(Property(counts, kind), entries.Count(x => Property(x, "type").GetString() == kind), entries.Count(x => Property(x, "type").GetString() == kind));
        Integer(Property(counts, "care"), careRecords.Length, careRecords.Length);
        Integer(Property(counts, "total"), entries.Length + careRecords.Length, entries.Length + careRecords.Length);
        return new(profile, entries, careRecords, emails, extras);
    }

    public static FullFamilyProfile Profile(JsonElement profile)
    {
        Fields(profile, "name", "birthDate", "sex");
        var name = Text(Property(profile, "name"), 100);
        var birth = Text(Property(profile, "birthDate"), 10, true);
        if (birth.Length > 0) Date(birth);
        var sex = Choice(Property(profile, "sex"), "male", "female", "unspecified");
        return new(name, birth, sex);
    }

    public static void Entry(JsonElement entry)
    {
        var type = Choice(Property(entry, "type"), "feed", "diaper", "sleep", "growth", "milestone");
        var fields = new List<string> { "id", "type", "start", "note" };
        Text(Property(entry, "id"), 128);
        var start = Instant(Property(entry, "start"));
        Text(Property(entry, "note"), 10000, true);
        if (type is "feed" or "sleep")
        {
            fields.Add("end");
            if (entry.TryGetProperty("end", out var end) && Instant(end) < start) Invalid();
        }
        if (type == "feed")
        {
            fields.AddRange(["feedKind", "amount", "feedRunning"]);
            var feedKind = Choice(Property(entry, "feedKind"), "formula", "expressed", "breast-left", "breast-right", "breast-both");
            if (entry.TryGetProperty("feedRunning", out var running) &&
                (running.ValueKind != JsonValueKind.True || entry.TryGetProperty("end", out _))) Invalid();
            if (feedKind is "formula" or "expressed") Number(Property(entry, "amount"), 0, 2000);
            else if (entry.TryGetProperty("amount", out _)) Invalid();
        }
        if (type == "diaper")
        {
            fields.Add("diaperKind");
            Choice(Property(entry, "diaperKind"), "wet", "dirty", "mixed");
        }
        if (type == "growth")
        {
            fields.AddRange(["weight", "length", "head"]);
            if (!entry.TryGetProperty("weight", out _) && !entry.TryGetProperty("length", out _) && !entry.TryGetProperty("head", out _)) Invalid();
            if (entry.TryGetProperty("weight", out var weight)) Number(weight, 0.1, 200);
            if (entry.TryGetProperty("length", out var length)) Number(length, 10, 250);
            if (entry.TryGetProperty("head", out var head)) Number(head, 10, 100);
        }
        if (type == "milestone")
        {
            fields.Add("title");
            Text(Property(entry, "title"), 200);
        }
        Fields(entry, fields.ToArray());
    }

    public static void CareRecord(JsonElement record)
    {
        var kind = Choice(Property(record, "kind"), "temperature", "bath", "wash", "oral", "nails", "supplement");
        Text(Property(record, "id"), 128);
        Instant(Property(record, "time"));
        Text(Property(record, "note"), 10000, true);
        if (kind == "temperature")
        {
            Fields(record, "id", "kind", "time", "note", "temperature", "method");
            Number(Property(record, "temperature"), 25, 45);
            Choice(Property(record, "method"), "armpit", "ear", "forehead", "rectal", "other");
        }
        else if (kind == "supplement")
        {
            Fields(record, "id", "kind", "time", "note", "supplements", "otherSupplement");
            var supplements = Array(Property(record, "supplements"), 5)
                .Select(value => Choice(value, "vitamin-d", "probiotics", "iron", "multivitamin", "other")).ToArray();
            if (supplements.Length == 0 || supplements.Distinct(StringComparer.Ordinal).Count() != supplements.Length) Invalid();
            if (supplements.Contains("other")) Text(Property(record, "otherSupplement"), 100);
            else if (record.TryGetProperty("otherSupplement", out _)) Invalid();
        }
        else Fields(record, "id", "kind", "time", "note");
    }

    public static JsonElement? Operation(FullRecordOperation operation)
    {
        if (operation.OperationId == Guid.Empty || operation.MembershipId == Guid.Empty || operation.HistoryId == Guid.Empty ||
            string.IsNullOrWhiteSpace(operation.RecordId) || operation.RecordId.Length > 128 ||
            operation.Kind is not ("create" or "update" or "delete") || operation.Collection is not ("entry" or "care" or "extra")) Invalid();
        if (operation.Kind == "create" ? operation.BaseVersion is not null : !RowVersion(operation.BaseVersion)) Invalid();
        if (operation.ReplacesOperationId is Guid replacement &&
            (replacement == Guid.Empty || replacement == operation.OperationId || operation.Kind != "update" || operation.Collection != "entry")) Invalid();
        if (operation.TimerCompletion is not null &&
            (operation.TimerCompletion is not ("sleep" or "feed") || operation.Kind != "update" || operation.Collection != "entry")) Invalid();
        if (operation.Kind == "delete")
        {
            if (operation.Entry is not null || operation.CareRecord is not null || operation.ExtraRecord is not null ||
                operation.Collection == "extra" && IsExtraSingleton(operation.RecordId) ||
                operation.ReplacesOperationId is not null || operation.TimerCompletion is not null) Invalid();
            return null;
        }
        var value = operation.Collection switch { "entry" => operation.Entry, "care" => operation.CareRecord, _ => operation.ExtraRecord };
        if (value is null || operation.Collection != "entry" && operation.Entry is not null ||
            operation.Collection != "care" && operation.CareRecord is not null ||
            operation.Collection != "extra" && operation.ExtraRecord is not null) Invalid();
        if (operation.Collection == "entry") Entry(value!.Value);
        else if (operation.Collection == "care") CareRecord(value!.Value);
        else ExtraRecord(value!.Value);
        if (Property(value!.Value, "id").GetString() != operation.RecordId) Invalid();
        if (operation.ReplacesOperationId is not null &&
            Property(value.Value, "type").GetString() is not ("feed" or "sleep")) Invalid();
        if (operation.TimerCompletion is { } timer &&
            (Property(value.Value, "type").GetString() != timer || !value.Value.TryGetProperty("end", out _) ||
             value.Value.TryGetProperty("feedRunning", out _))) Invalid();
        return value;
    }

    public static bool RowVersion(string? value) => value is { Length: 12 } &&
        Convert.TryFromBase64String(value, new byte[8], out var bytes) && bytes == 8;

    private static JsonElement Property(JsonElement value, string name)
    {
        if (value.ValueKind != JsonValueKind.Object || !value.TryGetProperty(name, out var property)) return Invalid<JsonElement>();
        return property;
    }
    private static void Fields(JsonElement value, params string[] allowed)
    {
        if (value.ValueKind != JsonValueKind.Object) Invalid();
        var names = new HashSet<string>(StringComparer.Ordinal);
        foreach (var property in value.EnumerateObject())
            if (!allowed.Contains(property.Name, StringComparer.Ordinal) || !names.Add(property.Name)) Invalid();
    }
    private static JsonElement[] Array(JsonElement value, int max)
    {
        if (value.ValueKind != JsonValueKind.Array || value.GetArrayLength() > max) return Invalid<JsonElement[]>();
        return value.EnumerateArray().ToArray();
    }
    private static string Text(JsonElement value, int max, bool empty = false)
    {
        if (value.ValueKind != JsonValueKind.String) return Invalid<string>();
        var text = value.GetString()!;
        if (text.Length > max || !empty && string.IsNullOrWhiteSpace(text)) Invalid();
        return text;
    }
    private static string Choice(JsonElement value, params string[] choices)
    {
        var text = Text(value, 40);
        if (!choices.Contains(text, StringComparer.Ordinal)) Invalid();
        return text;
    }
    private static void Number(JsonElement value, double min, double max)
    {
        if (value.ValueKind != JsonValueKind.Number || !value.TryGetDouble(out var number) || !double.IsFinite(number) || number < min || number > max) Invalid();
    }
    private static void Integer(JsonElement value, int min, int max)
    {
        if (value.ValueKind != JsonValueKind.Number || !value.TryGetInt32(out var number) || number < min || number > max) Invalid();
    }
    private static void Date(string value)
    {
        if (!DateOnly.TryParseExact(value, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date) || date.Year < 1900) Invalid();
    }
    private static DateTimeOffset Instant(JsonElement value)
    {
        var text = Text(value, 40);
        if (!InstantPattern().IsMatch(text)) return Invalid<DateTimeOffset>();
        Date(text[..10]);
        var timeEnd = text.EndsWith('Z') ? text.Length - 1 : text.Length - 6;
        if (!DateTime.TryParseExact(text[..timeEnd], ["yyyy-MM-dd'T'HH:mm:ss", "yyyy-MM-dd'T'HH:mm:ss.FFF"],
            CultureInfo.InvariantCulture, DateTimeStyles.None, out var local)) return Invalid<DateTimeOffset>();
        var offset = TimeSpan.Zero;
        if (!text.EndsWith('Z'))
        {
            var hours = int.Parse(text.AsSpan(timeEnd + 1, 2), CultureInfo.InvariantCulture);
            var minutes = int.Parse(text.AsSpan(timeEnd + 4, 2), CultureInfo.InvariantCulture);
            if (hours > 23 || minutes > 59) Invalid();
            offset = TimeSpan.FromMinutes((hours * 60 + minutes) * (text[timeEnd] == '-' ? -1 : 1));
        }
        try { return new DateTimeOffset(DateTime.SpecifyKind(local, DateTimeKind.Utc)) - offset; }
        catch (ArgumentOutOfRangeException) { return Invalid<DateTimeOffset>(); }
    }
    [GeneratedRegex(@"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$")]
    private static partial Regex InstantPattern();
    private static void Invalid() => throw new ApiException(422, "invalid_input");
    private static T Invalid<T>() => throw new ApiException(422, "invalid_input");
}
