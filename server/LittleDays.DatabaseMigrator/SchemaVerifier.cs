using System.Data;
using System.Runtime.CompilerServices;
using System.Text.RegularExpressions;

[assembly: InternalsVisibleTo("LittleDays.DatabaseMigrator.Tests")]

namespace LittleDays.DatabaseMigrator;

// These are the approved catalog contracts, not a model-generated migration.
// Run through DbUp's command factory so every check shares its transaction/lock.
internal static class SchemaVerifier
{
    private static readonly string[] Versions =
    [
        "0001_LegacySchemaBaseline.sql", "0002_VerifyBaselineAndRuntimeGrants.sql",
        "0003_FamilySharedExtras.sql", "0004_FamilyAvailabilityBounds.sql",
        "0005_QueryIndexesAndOperationCounts.sql", "0006_FamilyPushAndTimerIndex.sql"
    ];

    internal static int Version(IEnumerable<string> applied) => applied
        .Select(name => Array.IndexOf(Versions, name) + 1).DefaultIfEmpty(0).Max();

    internal static void Verify(Func<IDbCommand> factory, int version, bool journal = true, int legacyStage = 3)
    {
        if (version == 0 && journal) return;
        var indexes = ExpectedIndexes(version, journal, legacyStage);
        var tables = indexes.Select(index => index.Table).ToHashSet(StringComparer.Ordinal);
        VerifyColumns(factory, version, legacyStage);
        VerifyIndexes(factory, indexes, tables);
        VerifyForeignKeys(factory, tables);
        VerifyChecks(factory, version, tables);
        VerifyTriggers(factory, version, tables);
        if (version >= 6) VerifyTimerColumn(factory);
    }

    private sealed record Index(string Table, string Name, string[] Keys, bool Unique = false,
        string? Filter = null, string[]? Includes = null, bool Primary = false);

    private sealed record Column(int Type, int Length, int? Precision = null, int? Scale = null);

    private static void VerifyColumns(Func<IDbCommand> factory, int version, int legacyStage)
    {
        // Preserve the baseline's concurrency/amount contract on every check and
        // ensure the scale counter cannot silently permit NULL or a smaller type.
        var expected = new Dictionary<(string Table, string Name), Column>
        {
            [("Feeds", "Version")] = new(189, 8),
            [("Feeds", "Amount")] = new(106, 5, 7, 2)
        };
        if (legacyStage >= 3)
        {
            expected[("Families", "ProfileVersion")] = new(189, 8);
            expected[("FamilyRecords", "Version")] = new(189, 8);
        }
        if (version >= 5)
        {
            expected[("FamilyOperationCounts", "FamilyId")] = new(36, 16);
            expected[("FamilyOperationCounts", "ReceiptCount")] = new(127, 8, 19, 0);
        }
        if (version >= 6)
        {
            foreach (var table in new[] { "PushInstallations", "FamilyNotificationEvents", "NotificationSummaryBuckets" })
                expected[(table, "Id")] = new(36, 16);
            expected[("PushInstallations", "SecretHash")] = new(167, 64);
            expected[("PushInstallations", "ProtectedToken")] = new(167, 1024);
            expected[("PushInstallations", "Generation")] = new(56, 4);
            expected[("NotificationSummaryBuckets", "BucketKey")] = new(167, 64);
            expected[("NotificationSummaryBuckets", "Generation")] = new(56, 4);
            expected[("PushDeliveries", "EventId")] = new(36, 16);
            expected[("PushDeliveries", "BucketId")] = new(36, 16);
        }
        using var command = factory();
        command.CommandText = """
            SELECT t.name, c.name, c.system_type_id, c.max_length, c.precision, c.scale, c.is_nullable, c.is_computed
            FROM sys.columns c JOIN sys.tables t ON t.object_id=c.object_id
            WHERE t.schema_id=SCHEMA_ID(N'dbo');
            """;
        using var rows = command.ExecuteReader();
        while (rows.Read())
        {
            var key = (rows.GetString(0), rows.GetString(1));
            if (!expected.Remove(key, out var column)) continue;
            if (Convert.ToInt32(rows.GetValue(2)) != column.Type || Convert.ToInt32(rows.GetValue(3)) != column.Length ||
                column.Precision is { } precision && Convert.ToInt32(rows.GetValue(4)) != precision ||
                column.Scale is { } scale && Convert.ToInt32(rows.GetValue(5)) != scale || rows.GetBoolean(6) || rows.GetBoolean(7))
                Fail(key.Item1, key.Item2, "critical column type, precision, nullability or computed state differs");
        }
        if (expected.Count != 0)
        {
            var missing = expected.Keys.First();
            Fail(missing.Table, missing.Name, "missing critical column");
        }
    }

    private static List<Index> ExpectedIndexes(int version, bool journal, int legacyStage)
    {
        var indexes = new List<Index>
        {
            new("__EFMigrationsHistory", "PK___EFMigrationsHistory", ["MigrationId"], true, Primary: true),
            new("Families", "PK_Families", ["Id"], true, Primary: true),
            new("Feeds", "PK_Feeds", ["FamilyId", "Id"], true, Primary: true),
            new("Invitations", "PK_Invitations", ["Id"], true, Primary: true),
            new("Memberships", "PK_Memberships", ["Id"], true, Primary: true),
            new("Operations", "PK_Operations", ["UserId", "OperationId"], true, Primary: true),
            new("Memberships", "IX_Memberships_FamilyId_UserId_Active", ["FamilyId", "UserId", "Active"]),
            new("Memberships", "IX_Memberships_UserId", ["UserId"], true, "Active = 1"),
            new("Operations", "IX_Operations_FamilyId", ["FamilyId"])
        };
        if (journal) indexes.Add(new("DatabaseMigrations", "PK_DatabaseMigrations", ["ScriptName"], true, Primary: true));
        if (legacyStage == 1)
        {
            indexes.Add(new("Invitations", "IX_Invitations_FamilyId_RecipientUserId", ["FamilyId", "RecipientUserId"], true, "Status = N'pending'"));
            indexes.Add(new("Invitations", "IX_Invitations_TokenHash", ["TokenHash"], true));
        }
        else
        {
            indexes.AddRange([
                new("AccountDeletions", "PK_AccountDeletions", ["UserId"], true, Primary: true),
                new("OwnershipTransfers", "PK_OwnershipTransfers", ["Id"], true, Primary: true),
                new("Invitations", "IX_Invitations_FamilyId_Email", ["FamilyId", "Email"], true, "Status = N'pending'"),
                new("OwnershipTransfers", "IX_OwnershipTransfers_FamilyId", ["FamilyId"], true, "Status = N'pending'"),
                new("AccountDeletions", "IX_AccountDeletions_OperationId", ["OperationId"], true)
            ]);
        }
        if (legacyStage >= 3)
            indexes.Add(new("FamilyRecords", "PK_FamilyRecords", ["FamilyId", "Collection", "IdHash"], true, Primary: true));
        if (version >= 4)
            indexes.AddRange([
                new("Families", "IX_Families_DeletedAt", ["DeletedAt"], Filter: "DeletedAt IS NOT NULL AND PurgedAt IS NULL",
                    Includes: version >= 5 ? ["PurgedAt"] : []),
                new("Families", "IX_Families_DeletedBy_DeletedAt", ["DeletedBy", "DeletedAt"]),
                new("AccountDeletions", "IX_AccountDeletions_Status_RequestedAt", ["Status", "LastIdentityAttemptAt", "RequestedAt"])
            ]);
        if (version >= 5)
            indexes.AddRange([
                new("FamilyOperationCounts", "PK_FamilyOperationCounts", ["FamilyId"], true, Primary: true),
                new("Invitations", "IX_Invitations_Email_Status_ExpiresAt", ["Email", "Status", "ExpiresAt"], Includes: ["FamilyId", "CreatedAt"]),
                new("Invitations", "IX_Invitations_FamilyId_CreatedAt", ["FamilyId", "CreatedAt DESC"]),
                new("Invitations", "IX_Invitations_RecipientUserId", ["RecipientUserId"], Includes: ["FamilyId"]),
                new("OwnershipTransfers", "IX_OwnershipTransfers_FamilyId_All", ["FamilyId"]),
                new("OwnershipTransfers", "IX_OwnershipTransfers_FromUserId", ["FromUserId"], Includes: ["FamilyId"]),
                new("OwnershipTransfers", "IX_OwnershipTransfers_ToUserId", ["ToUserId"], Includes: ["FamilyId"]),
                new("Memberships", "IX_Memberships_UserId_FamilyId", ["UserId", "FamilyId"]),
                new("Feeds", "IX_Feeds_RecordedBy", ["RecordedBy"]),
                new("Feeds", "IX_Feeds_LastEditedBy", ["LastEditedBy"]),
                new("FamilyRecords", "IX_FamilyRecords_RecordedBy", ["RecordedBy"]),
                new("FamilyRecords", "IX_FamilyRecords_LastEditedBy", ["LastEditedBy"])
            ]);
        if (version >= 6)
            indexes.AddRange([
                new("PushInstallations", "PK_PushInstallations", ["Id"], true, Primary: true),
                new("FamilyNotificationEvents", "PK_FamilyNotificationEvents", ["Id"], true, Primary: true),
                new("NotificationSummaryBuckets", "PK_NotificationSummaryBuckets", ["Id"], true, Primary: true),
                new("PushDeliveries", "PK_PushDeliveries", ["EventId", "BucketId"], true, Primary: true),
                new("PushInstallations", "IX_PushInstallations_ProjectId_Environment_TokenHash", ["ProjectId", "Environment", "TokenHash"], true, Filter: "TokenHash IS NOT NULL"),
                new("PushInstallations", "IX_PushInstallations_UserId_Enabled", ["UserId", "Enabled"]),
                new("PushInstallations", "IX_PushInstallations_FamilyId", ["FamilyId"]),
                new("PushInstallations", "IX_PushInstallations_MembershipId", ["MembershipId"]),
                new("PushInstallations", "IX_PushInstallations_ExpiresAt", ["ExpiresAt"]),
                new("FamilyNotificationEvents", "IX_FamilyNotificationEvents_HistoryId_ActorUserId_OperationId_Category", ["HistoryId", "ActorUserId", "OperationId", "Category"], true),
                new("FamilyNotificationEvents", "IX_FamilyNotificationEvents_FamilyId_CreatedAt", ["FamilyId", "CreatedAt"]),
                new("FamilyNotificationEvents", "IX_FamilyNotificationEvents_FamilyId_RecordIdHash", ["FamilyId", "RecordIdHash"]),
                new("FamilyNotificationEvents", "IX_FamilyNotificationEvents_ActorUserId", ["ActorUserId"]),
                new("FamilyNotificationEvents", "IX_FamilyNotificationEvents_ExpiresAt", ["ExpiresAt"]),
                new("PushDeliveries", "IX_PushDeliveries_BucketId", ["BucketId"]),
                new("PushDeliveries", "IX_PushDeliveries_ExpiresAt", ["ExpiresAt"]),
                new("NotificationSummaryBuckets", "IX_NotificationSummaryBuckets_BucketKey", ["BucketKey"], true),
                new("NotificationSummaryBuckets", "IX_NotificationSummaryBuckets_State_DueAt_Id", ["State", "DueAt", "Id"]),
                new("NotificationSummaryBuckets", "IX_NotificationSummaryBuckets_State_LeaseUntil", ["State", "LeaseUntil"]),
                new("NotificationSummaryBuckets", "IX_NotificationSummaryBuckets_InstallationId_Generation", ["InstallationId", "Generation"]),
                new("NotificationSummaryBuckets", "IX_NotificationSummaryBuckets_MembershipId_State", ["MembershipId", "State"]),
                new("NotificationSummaryBuckets", "IX_NotificationSummaryBuckets_FamilyId_State", ["FamilyId", "State"]),
                new("NotificationSummaryBuckets", "IX_NotificationSummaryBuckets_RecipientUserId_State", ["RecipientUserId", "State"]),
                new("NotificationSummaryBuckets", "IX_NotificationSummaryBuckets_ExpiresAt", ["ExpiresAt"]),
                new("FamilyRecords", "IX_FamilyRecords_FamilyId_ActiveTimerKind", ["FamilyId", "ActiveTimerKind"])
            ]);
        return indexes;
    }

    private sealed record CatalogIndex(int Type, bool Unique, bool Primary, bool UniqueConstraint, bool Disabled,
        bool Hypothetical, bool Filtered, string? Filter)
    {
        public SortedDictionary<int, string> Keys { get; } = [];
        public HashSet<string> Includes { get; } = new(StringComparer.Ordinal);
    }

    private static void VerifyIndexes(Func<IDbCommand> factory, List<Index> expected, HashSet<string> tables)
    {
        using var command = factory();
        command.CommandText = """
            SELECT t.name, i.name, i.type, i.is_unique, i.is_primary_key, i.is_unique_constraint,
                i.is_disabled, i.is_hypothetical, i.has_filter, i.filter_definition,
                ic.key_ordinal, ic.is_descending_key, ic.is_included_column, c.name
            FROM sys.tables t JOIN sys.indexes i ON i.object_id=t.object_id
            LEFT JOIN sys.index_columns ic ON ic.object_id=i.object_id AND ic.index_id=i.index_id
            LEFT JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id
            WHERE t.schema_id=SCHEMA_ID(N'dbo') AND i.index_id>0;
            """;
        var actual = new Dictionary<(string Table, string Name), CatalogIndex>();
        using (var rows = command.ExecuteReader())
        {
            while (rows.Read())
            {
                var table = rows.GetString(0);
                if (!tables.Contains(table)) continue;
                var key = (table, rows.GetString(1));
                if (!actual.TryGetValue(key, out var index))
                    actual[key] = index = new(Convert.ToInt32(rows.GetValue(2)), rows.GetBoolean(3), rows.GetBoolean(4),
                        rows.GetBoolean(5), rows.GetBoolean(6), rows.GetBoolean(7), rows.GetBoolean(8),
                        rows.IsDBNull(9) ? null : rows.GetString(9));
                if (rows.IsDBNull(13)) continue;
                if (rows.GetBoolean(12)) index.Includes.Add(rows.GetString(13));
                else if (Convert.ToInt32(rows.GetValue(10)) > 0)
                    index.Keys.Add(Convert.ToInt32(rows.GetValue(10)), rows.GetString(13) + (rows.GetBoolean(11) ? " DESC" : ""));
            }
        }
        foreach (var index in expected)
        {
            if (!actual.Remove((index.Table, index.Name), out var found)) Fail(index.Table, index.Name, "missing index");
            if (found!.Type != (index.Primary ? 1 : 2) || found.Unique != index.Unique || found.Primary != index.Primary ||
                found.UniqueConstraint || found.Disabled || found.Hypothetical || found.Filtered != (index.Filter != null) ||
                !found.Keys.Values.SequenceEqual(index.Keys, StringComparer.Ordinal) ||
                !found.Includes.SetEquals(index.Includes ?? []) || !Equivalent(found.Filter, index.Filter))
                Fail(index.Table, index.Name, "index keys, direction, type, uniqueness, includes, filter or enabled state differ");
        }
        if (actual.Count != 0)
        {
            var extra = actual.Keys.First();
            Fail(extra.Table, extra.Name, "unexpected index for the applied schema version");
        }
    }

    private static void VerifyForeignKeys(Func<IDbCommand> factory, HashSet<string> tables)
    {
        var expected = new HashSet<string>(new[] { "Feeds", "Invitations", "Memberships", "Operations", "OwnershipTransfers", "FamilyRecords", "FamilyOperationCounts" }
            .Where(tables.Contains).Select(table => table + ".FK_" + table + "_Families_FamilyId"), StringComparer.Ordinal);
        using var command = factory();
        command.CommandText = """
            SELECT t.name, fk.name, fk.is_disabled, fk.is_not_trusted, fk.is_not_for_replication,
                fk.delete_referential_action, fk.update_referential_action,
                SCHEMA_NAME(rt.schema_id), rt.name, fkc.constraint_column_id, pc.name, rc.name
            FROM sys.foreign_keys fk JOIN sys.tables t ON t.object_id=fk.parent_object_id
            JOIN sys.tables rt ON rt.object_id=fk.referenced_object_id
            JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id=fk.object_id
            JOIN sys.columns pc ON pc.object_id=t.object_id AND pc.column_id=fkc.parent_column_id
            JOIN sys.columns rc ON rc.object_id=rt.object_id AND rc.column_id=fkc.referenced_column_id
            WHERE t.schema_id=SCHEMA_ID(N'dbo');
            """;
        using var rows = command.ExecuteReader();
        while (rows.Read())
        {
            var table = rows.GetString(0);
            if (!tables.Contains(table)) continue;
            var name = rows.GetString(1);
            if (!expected.Remove(table + "." + name) || rows.GetBoolean(2) || rows.GetBoolean(3) || rows.GetBoolean(4) ||
                Convert.ToInt32(rows.GetValue(5)) != 0 || Convert.ToInt32(rows.GetValue(6)) != 0 || rows.GetString(7) != "dbo" ||
                rows.GetString(8) != "Families" || Convert.ToInt32(rows.GetValue(9)) != 1 ||
                rows.GetString(10) != "FamilyId" || rows.GetString(11) != "Id")
                Fail(table, name, "foreign key columns, actions or trusted/enabled state differ");
        }
        if (expected.Count != 0) throw new InvalidOperationException("Schema verification failed: missing foreign key dbo." + expected.First() + ".");
    }

    private static void VerifyChecks(Func<IDbCommand> factory, int version, HashSet<string> tables)
    {
        var expected = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["Feeds.CK_Feeds_Amount"] = "Amount >= 0 AND Amount <= 2000",
            ["Feeds.CK_Feeds_Interval"] = "[End] >= [Start]"
        };
        if (tables.Contains("FamilyRecords"))
        {
            expected["FamilyRecords.CK_FamilyRecords_Collection"] = version >= 3
                ? "Collection IN ('entry', 'care', 'extra')" : "Collection IN ('entry', 'care')";
            expected["FamilyRecords.CK_FamilyRecords_Json"] = version >= 3
                ? """
                    ISJSON(RecordJson) = 1 AND (DATALENGTH(RecordJson) <= 131072 OR
                        (Collection = 'extra' AND Id = 'avatar' AND COALESCE(JSON_VALUE(RecordJson, '$.kind'), '') = 'avatar'
                         AND DATALENGTH(RecordJson) <= 35651584))
                    """
                : "ISJSON(RecordJson) = 1 AND DATALENGTH(RecordJson) <= 131072";
        }
        if (version >= 5) expected["FamilyOperationCounts.CK_FamilyOperationCounts_ReceiptCount"] = "ReceiptCount >= 0";
        if (version >= 6)
        {
            expected["PushInstallations.CK_PushInstallations_Generation"] = "Generation >= 0";
            expected["PushInstallations.CK_PushInstallations_CategoryMask"] = "CategoryMask >= 0 AND CategoryMask <= 7";
            expected["FamilyNotificationEvents.CK_FamilyNotificationEvents_Category"] = "Category IN ('feed', 'diaper', 'sleep')";
            expected["NotificationSummaryBuckets.CK_NotificationSummaryBuckets_State"] = "State IN ('pending', 'leased', 'receipt', 'sent', 'cancelled', 'failed')";
            expected["NotificationSummaryBuckets.CK_NotificationSummaryBuckets_Attempts"] = "Attempts >= 0";
        }
        using var command = factory();
        command.CommandText = """
            SELECT t.name, cc.name, cc.definition, cc.is_disabled, cc.is_not_trusted, cc.is_not_for_replication
            FROM sys.check_constraints cc JOIN sys.tables t ON t.object_id=cc.parent_object_id
            WHERE t.schema_id=SCHEMA_ID(N'dbo');
            """;
        using var rows = command.ExecuteReader();
        while (rows.Read())
        {
            var table = rows.GetString(0);
            if (!tables.Contains(table)) continue;
            var name = rows.GetString(1);
            if (!expected.Remove(table + "." + name, out var definition) || rows.GetBoolean(3) || rows.GetBoolean(4) || rows.GetBoolean(5) ||
                !Equivalent(rows.GetString(2), definition))
                Fail(table, name, "check definition or trusted/enabled state differs");
        }
        if (expected.Count != 0) throw new InvalidOperationException("Schema verification failed: missing check dbo." + expected.First().Key + ".");
    }

    private static void VerifyTimerColumn(Func<IDbCommand> factory)
    {
        using var command = factory();
        command.CommandText = "SELECT system_type_id, max_length, is_persisted, definition FROM sys.computed_columns WHERE object_id=OBJECT_ID('dbo.FamilyRecords') AND name='ActiveTimerKind'";
        using var rows = command.ExecuteReader();
        // This approved CASE uses only AND predicates, no arithmetic/OR. SQL adds
        // grouping parentheses; removing them here cannot change its precedence.
        static string Canonical(string sql) => NormalizeModule(sql.Replace("(", " ").Replace(")", " "));
        const string expected = "CONVERT(varchar(5), CASE WHEN Deleted = 0 AND Collection = 'entry' AND JSON_VALUE(RecordJson, '$.type') = 'sleep' AND JSON_VALUE(RecordJson, '$.end') IS NULL THEN 'sleep' WHEN Deleted = 0 AND Collection = 'entry' AND JSON_VALUE(RecordJson, '$.type') = 'feed' AND JSON_VALUE(RecordJson, '$.feedRunning') = 'true' THEN 'feed' END)";
        if (!rows.Read() || Convert.ToInt32(rows.GetValue(0)) != 167 || Convert.ToInt32(rows.GetValue(1)) != 5 ||
            !rows.GetBoolean(2) || Canonical(rows.GetString(3)) != Canonical(expected))
            Fail("FamilyRecords", "ActiveTimerKind", "persisted computed timer definition differs");
    }

    private static void Fail(string table, string name, string reason) =>
        throw new InvalidOperationException($"Schema verification failed for dbo.{table}.{name}: {reason}.");

    private static void VerifyTriggers(Func<IDbCommand> factory, int version, HashSet<string> tables)
    {
        const string name = "TR_Operations_MaintainFamilyOperationCounts";
        var required = version >= 5;
        using var command = factory();
        command.CommandText = """
            SELECT t.name, tr.name, tr.is_disabled, tr.is_instead_of_trigger, tr.is_not_for_replication,
                OBJECT_DEFINITION(tr.object_id),
                (SELECT COUNT(*) FROM sys.trigger_events e WHERE e.object_id=tr.object_id AND e.type_desc IN ('INSERT','UPDATE','DELETE')),
                (SELECT COUNT(*) FROM sys.trigger_events e WHERE e.object_id=tr.object_id)
            FROM sys.triggers tr JOIN sys.tables t ON t.object_id=tr.parent_id
            WHERE t.schema_id=SCHEMA_ID(N'dbo');
            """;
        using var rows = command.ExecuteReader();
        while (rows.Read())
        {
            var table = rows.GetString(0);
            if (!tables.Contains(table)) continue;
            if (!required || table != "Operations" || rows.GetString(1) != name || rows.GetBoolean(2) || rows.GetBoolean(3) ||
                rows.GetBoolean(4) || rows.IsDBNull(5) || Convert.ToInt32(rows.GetValue(6)) != 3 || Convert.ToInt32(rows.GetValue(7)) != 3 ||
                NormalizeModule(rows.GetString(5)) != NormalizeModule(ExpectedCounterTrigger()))
                Fail(table, rows.GetString(1), "trigger definition, events or enabled state differs");
            required = false;
        }
        if (required) Fail("Operations", name, "missing operation counter trigger");
    }

    private static string ExpectedCounterTrigger()
    {
        var script = MigrationRunner.Scripts().Single(script => script.Name == Versions[4]).Contents;
        var match = Regex.Match(script, @"(?im)^CREATE(?: OR ALTER)? TRIGGER\s+dbo\.TR_Operations_MaintainFamilyOperationCounts\b[\s\S]*?(?=^GO\s*$|\z)");
        if (!match.Success) throw new InvalidOperationException("Approved operation counter trigger definition is missing.");
        return match.Value;
    }

    // Compare a module's token stream, preserving punctuation, token boundaries,
    // literals and all parentheses. Only formatting/comments/identifier case vary.
    private static string NormalizeModule(string sql)
    {
        var tokens = Regex.Matches(sql, @"N?'(?:''|[^'])*'|\[(?:\]\]|[^\]])*\]|--[^\r\n]*|/\*[\s\S]*?\*/|[A-Za-z_@][A-Za-z0-9_@]*|[0-9]+|[^\s]", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)
            .Select(match => match.Value).Where(token => !token.StartsWith("--") && !token.StartsWith("/*"))
            .Select(token => token.StartsWith('\'') ? token : token.StartsWith("N'", StringComparison.OrdinalIgnoreCase) ? "N" + token[1..]
                : (token.StartsWith('[') ? token[1..^1].Replace("]]", "]") : token).ToUpperInvariant());
        return string.Join("", tokens.Select(token => token.Length + ":" + token));
    }

    private static bool Equivalent(string? actual, string? expected)
    {
        if (actual == null || expected == null) return actual == expected;
        try { return NormalizeExpression(actual) == NormalizeExpression(expected); }
        catch (FormatException) { return false; }
    }

    // A deliberately small, fail-closed SQL expression parser. SQL Server expands
    // IN into OR and adds parentheses. Preserve precedence and string contents;
    // deleting punctuation/whitespace from the entire definition is not safe.
    internal static string NormalizeExpression(string expression) => new ExpressionParser(expression).Parse();

    private sealed record Node(string Kind, string Value, Node[] Children)
    {
        public string Canonical => Children.Length == 0 ? Kind + Value.Length + ":" + Value
            : Kind + "(" + string.Join(",", Children.Select(child => child.Canonical)) + ")";
        public static Node Logical(string kind, IEnumerable<Node> children) => new(kind, "", children
            .SelectMany(child => child.Kind == kind ? child.Children : [child])
            .OrderBy(child => child.Canonical, StringComparer.Ordinal).ToArray());
    }

    private sealed class ExpressionParser
    {
        private static readonly Regex TokenPattern = new(@"\G\s*(?<token>N?'(?:''|[^'])*'|\[(?:\]\]|[^\]])*\]|[A-Za-z_][A-Za-z0-9_]*|[0-9]+|<=|>=|<>|!=|[(),=<>])", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        private readonly List<string> tokens = [];
        private int position;

        public ExpressionParser(string text)
        {
            var offset = 0;
            while (offset < text.Length)
            {
                if (string.IsNullOrWhiteSpace(text[offset..])) break;
                var match = TokenPattern.Match(text, offset);
                if (!match.Success) throw new FormatException("Unsupported SQL constraint expression.");
                tokens.Add(match.Groups["token"].Value);
                offset += match.Length;
            }
        }

        public string Parse()
        {
            var expression = Or();
            if (position != tokens.Count) throw new FormatException("Trailing SQL expression tokens.");
            return expression.Canonical;
        }
        private bool Take(string token)
        {
            if (position >= tokens.Count || !string.Equals(tokens[position], token, StringComparison.OrdinalIgnoreCase)) return false;
            position++;
            return true;
        }
        private void Require(string token)
        {
            if (!Take(token)) throw new FormatException("Unexpected SQL expression token.");
        }
        private Node Or()
        {
            var terms = new List<Node> { And() };
            while (Take("OR")) terms.Add(And());
            return terms.Count == 1 ? terms[0] : Node.Logical("OR", terms);
        }
        private Node And()
        {
            var terms = new List<Node> { Predicate() };
            while (Take("AND")) terms.Add(Predicate());
            return terms.Count == 1 ? terms[0] : Node.Logical("AND", terms);
        }
        private Node Predicate()
        {
            var left = Atom();
            if (Take("IS"))
            {
                var not = Take("NOT");
                Require("NULL");
                return new(not ? "ISNOTNULL" : "ISNULL", "", [left]);
            }
            if (Take("IN"))
            {
                Require("(");
                var terms = new List<Node>();
                do { terms.Add(new("=", "", [left, Atom()])); } while (Take(","));
                Require(")");
                return terms.Count == 1 ? terms[0] : Node.Logical("OR", terms);
            }
            foreach (var op in new[] { "=", "<=", ">=", "<>", "!=", "<", ">" })
                if (Take(op)) return new(op == "!=" ? "<>" : op, "", [left, Atom()]);
            return left;
        }
        private Node Atom()
        {
            if (Take("("))
            {
                var nested = Or();
                Require(")");
                return nested;
            }
            if (position == tokens.Count) throw new FormatException("Incomplete SQL expression.");
            var token = tokens[position++];
            if (token.StartsWith('\'') || token.StartsWith("N'", StringComparison.OrdinalIgnoreCase))
                return new("LITERAL", token.StartsWith('\'') ? token : "N" + token[1..], []);
            if (token.All(char.IsAsciiDigit)) return new("NUMBER", token, []);
            var identifier = token.StartsWith('[') ? token[1..^1].Replace("]]", "]") : token;
            if (!Regex.IsMatch(identifier, "^[A-Za-z_][A-Za-z0-9_]*$")) throw new FormatException("Unsupported SQL identifier.");
            identifier = identifier.ToUpperInvariant();
            if (!Take("(")) return new("IDENTIFIER", identifier, []);
            var arguments = new List<Node>();
            do { arguments.Add(Or()); } while (Take(","));
            Require(")");
            return new("FUNCTION:" + identifier, "", arguments.ToArray());
        }
    }
}
