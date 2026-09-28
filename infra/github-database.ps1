#requires -Version 7.3
[CmdletBinding()]
param(
    [ValidateSet('Migrate', 'Cleanup')][string]$Mode = 'Migrate',
    [string]$MigratorPath = (Join-Path $PSScriptRoot '../artifacts/database/LittleDays.DatabaseMigrator.dll'),
    [switch]$AdoptEf
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Require-Value([string]$Name, [string]$Pattern) {
    $value = [Environment]::GetEnvironmentVariable($Name)
    if ([string]::IsNullOrWhiteSpace($value) -or $value -cnotmatch $Pattern) { throw "Invalid or missing $Name." }
    return $value
}
function Invoke-DatabaseAz([string[]]$Arguments) {
    $result = & az @Arguments --subscription $script:subscription --output json --only-show-errors 2>$null
    if ($LASTEXITCODE -ne 0) { throw 'Azure SQL control-plane command failed. No broad firewall fallback is permitted.' }
    try { return ($result -join "`n" | ConvertFrom-Json -AsHashtable) }
    catch { throw 'Azure returned invalid JSON. Inspect privately; do not dump credentials.' }
}
function Get-Rules {
    return @(Invoke-DatabaseAz @('sql', 'server', 'firewall-rule', 'list', '--resource-group', $script:group, '--server', $script:server))
}
function Test-ExactPublicIPv4([string]$Address) {
    $ip = $null
    if (![System.Net.IPAddress]::TryParse($Address, [ref]$ip) -or
        $ip.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork -or $Address -cne $ip.ToString()) { return $false }
    $bytes = $ip.GetAddressBytes()
    return !($bytes[0] -in @(0,10,127) -or $bytes[0] -ge 224 -or
        ($bytes[0] -eq 100 -and $bytes[1] -ge 64 -and $bytes[1] -le 127) -or
        ($bytes[0] -eq 169 -and $bytes[1] -eq 254) -or
        ($bytes[0] -eq 172 -and $bytes[1] -ge 16 -and $bytes[1] -le 31) -or
        ($bytes[0] -eq 192 -and ($bytes[1] -eq 168 -or ($bytes[1] -eq 0 -and $bytes[2] -in @(0,2)) -or ($bytes[1] -eq 88 -and $bytes[2] -eq 99))) -or
        ($bytes[0] -eq 198 -and ($bytes[1] -in @(18,19) -or ($bytes[1] -eq 51 -and $bytes[2] -eq 100))) -or
        ($bytes[0] -eq 203 -and $bytes[1] -eq 0 -and $bytes[2] -eq 113))
}
function Assert-ExactFirewallRules([object[]]$Rules, [string]$RunnerAddress = '') {
    # Validate live rule shape without duplicating Azure's addresses in GitHub.
    # Existing exact-IP rules are retained; ownership/need remains operator review.
    $names = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $runRules = 0
    foreach ($existing in $Rules) {
        if ($existing.name -isnot [string] -or !$names.Add($existing.name) -or
            $existing.startIpAddress -isnot [string] -or $existing.endIpAddress -isnot [string] -or
            !(Test-ExactPublicIPv4 $existing.startIpAddress) -or $existing.startIpAddress -cne $existing.endIpAddress) {
            throw 'SQL firewall contains an invalid address, duplicate, broad range or all-Azure rule. Review it separately; no unrelated rule was changed.'
        }
        if ($existing.name -like 'github-db-*') {
            if (!$RunnerAddress -or $existing.name -cne $script:rule -or $existing.startIpAddress -cne $RunnerAddress) {
                throw 'A temporary migration firewall rule already exists or differs. Review it before releasing; no unrelated rule was changed.'
            }
            $runRules++
        }
    }
    if ($RunnerAddress -and $runRules -ne 1) { throw 'Exact runner-IP firewall verification failed.' }
}
function Remove-RunRule {
    # Never enumerate and delete other runs' or manually configured rules.
    $null = Invoke-DatabaseAz @('sql', 'server', 'firewall-rule', 'delete', '--resource-group', $script:group, '--server', $script:server, '--name', $script:rule)
    if (@(Get-Rules | Where-Object { $_.name -ceq $script:rule }).Count -ne 0) { throw 'Temporary SQL firewall rule still exists; block release and remove it manually.' }
    Write-Output 'This run temporary SQL firewall rule is removed.'
}

if ($env:GITHUB_ACTIONS -cne 'true' -or $env:GITHUB_EVENT_NAME -cne 'workflow_dispatch') { throw 'Database deployment requires a manually reviewed GitHub release.' }
$subscription = Require-Value 'AZURE_SUBSCRIPTION_ID' '^[a-fA-F0-9-]{36}$'
$tenant = Require-Value 'AZURE_TENANT_ID' '^[a-fA-F0-9-]{36}$'
$client = Require-Value 'AZURE_DB_MIGRATION_CLIENT_ID' '^[a-fA-F0-9-]{36}$'
foreach ($value in @($subscription, $tenant, $client)) {
    $parsed = [Guid]::Empty
    if (![Guid]::TryParseExact($value, 'D', [ref]$parsed) -or $parsed -eq [Guid]::Empty) { throw 'Hosting identity identifiers must be non-empty GUIDs.' }
}
$group = Require-Value 'FAMILY_DB_RESOURCE_GROUP' '^my-little-days-pilot-rg$'
$server = Require-Value 'FAMILY_DB_SERVER_NAME' '^little-days-sql-[a-z0-9]{13}$'
$database = Require-Value 'FAMILY_DB_NAME' '^little-days-family$'
$runId = Require-Value 'GITHUB_RUN_ID' '^[1-9][0-9]*$'
$attempt = Require-Value 'GITHUB_RUN_ATTEMPT' '^[1-9][0-9]*$'
$rule = "github-db-$runId-$attempt"
$account = Invoke-DatabaseAz @('account', 'show', '--query', '{tenantId:tenantId,user:user}')
if ($account.tenantId -ine $tenant -or $account.user.type -ine 'servicePrincipal' -or $account.user.name -ine $client) {
    throw 'Azure CLI is not using the selected hosting migration identity.'
}
$sql = Invoke-DatabaseAz @('sql', 'server', 'show', '--resource-group', $group, '--name', $server,
    '--query', '{id:id,fullyQualifiedDomainName:fullyQualifiedDomainName,tags:tags}')
$expectedId = "/subscriptions/$subscription/resourceGroups/$group/providers/Microsoft.Sql/servers/$server"
if ($sql.id -ine $expectedId -or $sql.fullyQualifiedDomainName -cne "$server.database.windows.net" -or
    $sql.tags.managedBy -cne 'my-little-days-family-pilot') { throw 'SQL server does not match the reviewed owned resource.' }
if ($Mode -eq 'Cleanup') {
    if ($env:FAMILY_DB_RULE_CREATED -ceq $rule -and @(Get-Rules | Where-Object { $_.name -ceq $rule }).Count -gt 0) { Remove-RunRule }
    return
}
if ($env:FAMILY_DB_MIGRATIONS_ENABLED -cne 'true') { throw 'Configure and approve the family-database environment before enabling migrations.' }
if (!(Test-Path -LiteralPath $MigratorPath -PathType Leaf)) { throw 'Reviewed migrator artifact is missing.' }
if ([string]::IsNullOrWhiteSpace($env:GITHUB_ENV)) { throw 'GitHub environment file is required for cleanup recovery.' }
Assert-ExactFirewallRules -Rules (Get-Rules)
$address = [string](Invoke-RestMethod -Uri 'https://api.ipify.org' -TimeoutSec 20)
if (!(Test-ExactPublicIPv4 $address)) { throw 'Refusing a non-public or ambiguous runner IPv4.' }
# Record intent before the request: a timed-out creation can still have succeeded.
Add-Content -LiteralPath $env:GITHUB_ENV -Value "FAMILY_DB_RULE_CREATED=$rule"
$env:FAMILY_DB_RULE_CREATED = $rule
$migrationFailure = $null
try {
    $null = Invoke-DatabaseAz @('sql', 'server', 'firewall-rule', 'create', '--resource-group', $group, '--server', $server,
        '--name', $rule, '--start-ip-address', $address, '--end-ip-address', $address)
    # Recheck all rules so newly introduced broad access or stale runners block apply.
    Assert-ExactFirewallRules -Rules (Get-Rules) -RunnerAddress $address
    $env:FAMILY_DB_SERVER = "$server.database.windows.net"
    $env:FAMILY_DB_TENANT_ID = $tenant
    $extra = @()
    if ($AdoptEf) { $extra += '--adopt-ef' }
    $ready = $false
    for ($i = 0; $i -lt 6; $i++) {
        & dotnet $MigratorPath --check @extra
        if ($LASTEXITCODE -eq 0) { $ready = $true; break }
        if ($i -lt 5) { Start-Sleep -Seconds 10 }
    }
    if (!$ready) { throw 'Database preflight failed. Schema was not applied.' }
    & dotnet $MigratorPath --apply @extra
    if ($LASTEXITCODE -ne 0) { throw 'Database migration failed. Do not deploy the API.' }
} catch { $migrationFailure = $_; throw }
finally {
    try { Remove-RunRule }
    catch {
        Write-Warning "SQL firewall cleanup requires operator attention: remove only $rule from $server."
        if ($null -eq $migrationFailure) { throw }
    }
}
