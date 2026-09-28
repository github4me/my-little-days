using Azure.Core;
using Azure.Identity;
using LittleDays.DatabaseMigrator;
using Microsoft.Data.SqlClient;

if (args.Length == 1 && args[0] == "--help")
{
    Console.WriteLine("Use --check or --apply; optional --adopt-ef permits a reviewed legacy EF history. Configure FAMILY_DB_SERVER, FAMILY_DB_NAME, FAMILY_DB_TENANT_ID. Authenticate with Azure CLI first. No database is created or dropped.");
    return 0;
}
try
{
    if (args.Length is < 1 or > 2 || args[0] is not ("--apply" or "--check") ||
        (args.Length == 2 && args[1] != "--adopt-ef"))
        throw new InvalidOperationException("Use --check or --apply, optionally followed by --adopt-ef.");
    var server = Environment.GetEnvironmentVariable("FAMILY_DB_SERVER") ?? "";
    var database = Environment.GetEnvironmentVariable("FAMILY_DB_NAME") ?? "";
    var tenant = Environment.GetEnvironmentVariable("FAMILY_DB_TENANT_ID") ?? "";
    MigrationRunner.ValidateAzureTarget(server, database, tenant);
    var credentials = new AzureCliCredential(new AzureCliCredentialOptions { TenantId = tenant });
    var connectionString = new SqlConnectionStringBuilder
    {
        DataSource = "tcp:" + server + ",1433", InitialCatalog = database,
        Encrypt = true, TrustServerCertificate = false, ConnectTimeout = 60, Pooling = false
    }.ConnectionString;
    SqlConnection Connect() => new(connectionString)
    {
        AccessToken = credentials.GetToken(new TokenRequestContext(["https://database.windows.net/.default"])).Token
    };
    var runner = new MigrationRunner(Connect, database, args.Contains("--adopt-ef", StringComparer.Ordinal));
    var pending = runner.Pending();
    Console.WriteLine($"Pending database scripts: {pending.Count}");
    foreach (var script in pending) Console.WriteLine(script);
    if (args[0] == "--apply")
    {
        runner.Apply();
        Console.WriteLine("Database migration completed successfully.");
    }
    return 0;
}
catch (Exception)
{
    // SQL/identity errors can contain tokens, connection details or data values.
    // Never emit exception messages, SQL text or script output into CI logs.
    Console.Error.WriteLine("Database migration failed. API deployment must stop. Check target, network, SQL grants, legacy-adoption approval and migration history privately.");
    return 1;
}
