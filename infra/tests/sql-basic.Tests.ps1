#requires -Version 7.0
# Local compilation/contract checks only. No login, provider validation or SQL access.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$templatePath = Join-Path $PSScriptRoot '../bicep/sql-basic.bicep'
$compiled = & az bicep build --file $templatePath --stdout --only-show-errors
if ($LASTEXITCODE -ne 0) { throw 'SQL Basic Bicep compilation failed.' }
$template = $compiled -join "`n" | ConvertFrom-Json -AsHashtable
$resources = @($template.resources | Where-Object { $_['existing'] -ne $true })
function Assert-Basic([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}
Assert-Basic ($resources.Count -eq 2) 'Only the database and its backup policy may be managed.'
$dbs = @($resources | Where-Object type -eq 'Microsoft.Sql/servers/databases')
$policies = @($resources | Where-Object type -eq 'Microsoft.Sql/servers/databases/backupShortTermRetentionPolicies')
Assert-Basic ($dbs.Count -eq 1 -and $policies.Count -eq 1) 'Unexpected Basic target resource types.'
$db = $dbs[0]
Assert-Basic ($db.sku.name -ceq 'Basic' -and $db.sku.tier -ceq 'Basic' -and $db.sku.capacity -eq 5) 'Basic must be exactly 5 DTU.'
Assert-Basic (-not $db.sku.ContainsKey('family')) 'Basic cannot retain a serverless hardware family.'
Assert-Basic ($db.properties.useFreeLimit -eq $false -and $db.properties.maxSizeBytes -eq 2147483648) 'Paid Basic must be capped at 2 GiB.'
Assert-Basic ($db.properties.requestedBackupStorageRedundancy -ceq 'Local' -and $db.properties.readScale -ceq 'Disabled' -and $db.properties.zoneRedundant -eq $false) 'Unexpected paid redundancy/read replica.'
Assert-Basic ($db.properties.Count -eq 5) 'Review every additional database property for unintended resets.'
foreach ($name in @('autoPauseDelay', 'minCapacity', 'freeLimitExhaustionBehavior', 'createMode', 'sourceDatabaseId', 'collation')) {
    Assert-Basic (-not $db.properties.ContainsKey($name)) "Unexpected Basic property $name."
}
Assert-Basic ($policies[0].properties.retentionDays -eq 7) 'Preserve seven-day retention.'
Assert-Basic ($policies[0].properties.diffBackupIntervalInHours -eq 12) 'Preserve twelve-hour differential backups.'
foreach ($resource in $resources) {
    Assert-Basic ($resource.condition -ceq "[parameters('confirmPaidBasic')]") 'Explicit paid-tier acknowledgement is required.'
}
$confirmation = $template.parameters.confirmPaidBasic
Assert-Basic ($confirmation.type -ceq 'bool' -and @($confirmation.allowedValues).Count -eq 1 -and $confirmation.allowedValues[0] -eq $true) 'Paid acknowledgement must only accept true.'
foreach ($name in @('sqlServerName', 'databaseName', 'location', 'existingDatabaseTags', 'confirmPaidBasic')) {
    Assert-Basic (-not $template.parameters[$name].ContainsKey('defaultValue')) "Target/consent must not be defaulted: $name."
}
Assert-Basic ($db.tags -ceq "[parameters('existingDatabaseTags')]") 'Preserve existing database tags.'
Assert-Basic ($db.location -ceq "[parameters('location')]") 'Preserve database region.'
$mainSource = Get-Content -LiteralPath (Join-Path $PSScriptRoot '../bicep/main.bicep') -Raw
Assert-Basic (-not $mainSource.Contains('sql-basic.bicep')) 'Do not wire paid conversion into the automatic infrastructure path.'
Write-Host 'PASS: isolated Basic target compiles; two resources, explicit paid consent, 2 GiB/5 DTU, seven-day backups and no server/app/firewall writes.'
