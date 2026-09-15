using System.Data;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using DbUp;
using DbUp.Engine;
using DbUp.Engine.Transactions;
using Microsoft.Data.SqlClient;

namespace LittleDays.DatabaseMigrator;

public sealed class MigrationRunner
{
    private readonly UpgradeEngine engine;
    public static IReadOnlyList<SqlScript> Scripts() => typeof(MigrationRunner).Assembly.GetManifestResourceNames()
        .Where(x => x.EndsWith(".sql", StringComparison.Ordinal)).Order(StringComparer.Ordinal)
        .Select(name =>
        {
            using var reader = new StreamReader(typeof(MigrationRunner).Assembly.GetManifestResourceStream(name)!);
            return new SqlScript(name, reader.ReadToEnd());
        }).ToArray();

    public MigrationRunner(Func<SqlConnection> connectionFactory, string expectedDatabase, bool adoptEf = false,
        IReadOnlyList<SqlScript>? scripts = null)
    {
        if (string.IsNullOrWhiteSpace(expectedDatabase) || new[] { "master", "model", "msdb", "tempdb" }.Contains(expectedDatabase, StringComparer.OrdinalIgnoreCase))
            throw new InvalidOperationException("A dedicated existing database is required.");
        scripts ??= Scripts();
        if (scripts.Count == 0 || scripts.Any(s => !Regex.IsMatch(s.Name, @"^\d{4}_[A-Za-z0-9_]+\.sql$")) ||
            scripts.Select(s => s.Name[..4]).Distinct(StringComparer.Ordinal).Count() != scripts.Count)
            throw new InvalidOperationException("Migration scripts must have unique numbered names.");
        var ordered = scripts.OrderBy(s => s.Name, StringComparer.Ordinal).ToArray();
        var builder = DeployChanges.To.SqlDatabase(connectionFactory).WithScripts(ordered)
            .WithTransaction().WithExecutionTimeout(TimeSpan.FromMinutes(5)).WithVariablesDisabled();
        builder.Configure(c => c.Journal = new ChecksumJournal(c.ConnectionManager, ordered, expectedDatabase, adoptEf));
        engine = builder.Build();
    }

    public IReadOnlyList<string> Pending() => engine.GetScriptsToExecute().Select(s => s.Name).ToArray();
    public void Apply()
    {
        var result = engine.PerformUpgrade();
        if (!result.Successful) throw new InvalidOperationException("Migration transaction failed.", result.Error);
    }

    public static void ValidateAzureTarget(string server, string database, string tenant)
    {
        if (!Regex.IsMatch(server, @"^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]\.database\.windows\.net$") ||
            database != "little-days-family" || !Guid.TryParseExact(tenant, "D", out var id) || id == Guid.Empty)
            throw new InvalidOperationException("Expected the dedicated Azure SQL database and a hosting tenant GUID.");
    }

    public static string Hash(string text) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text.Replace("\r\n", "\n"))));
}

internal sealed class ChecksumJournal(IConnectionManager manager, IReadOnlyList<SqlScript> scripts, string database, bool adoptEf) : IJournal
{
    private static readonly string[] LegacyIds = ["20260913173137_InitialPilot", "20260914032522_InvitationLifecycleV2", "20260915091021_FullDomainFamiliesV2"];
    public string[] GetExecutedScripts() => manager.ExecuteCommandsWithManagedConnection(factory =>
    {
        using var check = factory();
        check.CommandText = """
            IF DB_NAME() <> @database THROW 51000, 'Unexpected migration target.', 1;
            DECLARE @lock int;
            EXEC @lock = sys.sp_getapplock @Resource=N'MyLittleDays.DatabaseMigrator', @LockMode='Exclusive', @LockOwner='Transaction', @LockTimeout=0;
            IF @lock < 0 THROW 51001, 'Another migration is active.', 1;
            SELECT CASE WHEN OBJECT_ID(N'dbo.DatabaseMigrations', N'U') IS NULL THEN 0 ELSE 1 END;
            """;
        Add(check, "@database", database);
        var journalExists = Convert.ToInt32(check.ExecuteScalar()) == 1;
        if (!journalExists)
        {
            CheckLegacy(factory);
            return [];
        }
        using var command = factory();
        command.CommandText = "SELECT ScriptName, Sha256 FROM dbo.DatabaseMigrations ORDER BY ScriptName COLLATE Latin1_General_100_BIN2;";
        using var rows = command.ExecuteReader();
        var executed = new List<string>();
        while (rows.Read())
        {
            var index = executed.Count;
            if (index >= scripts.Count || rows.GetString(0) != scripts[index].Name || rows.GetString(1) != MigrationRunner.Hash(scripts[index].Contents))
                throw new InvalidOperationException("Applied scripts are missing, reordered or changed. Add a new migration instead.");
            executed.Add(rows.GetString(0));
        }
        if (executed.Count == 0) throw new InvalidOperationException("An empty existing migration journal requires operator review.");
        return executed.ToArray();
    });

    private void CheckLegacy(Func<IDbCommand> factory)
    {
        using var tables = factory();
        tables.CommandText = "SELECT COUNT(*) FROM sys.tables WHERE is_ms_shipped=0;";
        if (Convert.ToInt32(tables.ExecuteScalar()) == 0) return;
        if (!adoptEf) throw new InvalidOperationException("Existing schema requires explicit reviewed EF adoption.");
        using var history = factory();
        history.CommandText = "SELECT MigrationId FROM dbo.__EFMigrationsHistory ORDER BY MigrationId;";
        var count = 0;
        using (var rows = history.ExecuteReader())
        {
            while (rows.Read())
            {
                if (count >= LegacyIds.Length || rows.GetString(0) != LegacyIds[count++])
                    throw new InvalidOperationException("Unrecognised legacy EF history.");
            }
        }
        if (count == 0) throw new InvalidOperationException("Empty legacy EF history cannot authorise adoption.");
        var expected = new HashSet<string>(["dbo.__EFMigrationsHistory", "dbo.Families", "dbo.Feeds", "dbo.Memberships", "dbo.Invitations", "dbo.Operations"], StringComparer.Ordinal);
        if (count >= 2) expected.UnionWith(["dbo.AccountDeletions", "dbo.OwnershipTransfers"]);
        if (count == 3) expected.Add("dbo.FamilyRecords");
        tables.CommandText = "SELECT SCHEMA_NAME(schema_id)+'.'+name FROM sys.tables WHERE is_ms_shipped=0;";
        using var names = tables.ExecuteReader();
        var actual = new HashSet<string>(StringComparer.Ordinal);
        while (names.Read()) actual.Add(names.GetString(0));
        if (!expected.SetEquals(actual)) throw new InvalidOperationException("Legacy tables do not match the recorded migration stage.");
    }

    public void EnsureTableExistsAndIsLatestVersion(Func<IDbCommand> factory)
    {
        using var command = factory();
        command.CommandText = """
            IF OBJECT_ID(N'dbo.DatabaseMigrations', N'U') IS NULL
                CREATE TABLE dbo.DatabaseMigrations (
                    ScriptName nvarchar(255) NOT NULL CONSTRAINT PK_DatabaseMigrations PRIMARY KEY,
                    Sha256 char(64) NOT NULL,
                    AppliedAt datetime2 NOT NULL CONSTRAINT DF_DatabaseMigrations_AppliedAt DEFAULT SYSUTCDATETIME());
            """;
        command.ExecuteNonQuery();
    }

    public void StoreExecutedScript(SqlScript script, Func<IDbCommand> factory)
    {
        using var command = factory();
        command.CommandText = "INSERT dbo.DatabaseMigrations(ScriptName,Sha256) VALUES (@name,@hash);";
        Add(command, "@name", script.Name);
        Add(command, "@hash", MigrationRunner.Hash(script.Contents));
        command.ExecuteNonQuery();
    }

    private static void Add(IDbCommand command, string name, string value)
    {
        var parameter = command.CreateParameter();
        parameter.ParameterName = name;
        parameter.Value = value;
        command.Parameters.Add(parameter);
    }
}
