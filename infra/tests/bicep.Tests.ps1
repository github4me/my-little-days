#requires -Version 7.0
# Compile and inspect the actual ARM resources. No sign-in, Azure reads/writes or Pester dependency.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$templatePath = Join-Path $PSScriptRoot '../bicep/main.bicep'
$null = Get-Command az -ErrorAction Stop
$null = & az bicep version --only-show-errors
if ($LASTEXITCODE -ne 0) { throw 'Install the local Bicep compiler before running these checks.' }
$compiled = & az bicep build --file $templatePath --stdout --only-show-errors
if ($LASTEXITCODE -ne 0) { throw 'Bicep compilation failed.' }
$template = $compiled -join "`n" | ConvertFrom-Json -AsHashtable

function Get-TemplateResources([System.Collections.IDictionary]$Template) {
    $items = if ($Template.resources -is [System.Collections.IDictionary]) { $Template.resources.Values } else { $Template.resources }
    foreach ($resource in $items) {
        $resource
        if ($resource.type -eq 'Microsoft.Resources/deployments') {
            Get-TemplateResources $resource.properties.template
        }
    }
}
function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}
function Single-Resource([string]$Type) {
    $matches = @($script:resources | Where-Object type -eq $Type)
    Assert-True ($matches.Count -eq 1) "Expected exactly one resource definition of type $Type"
    return $matches[0]
}

$resources = @(Get-TemplateResources $template | Where-Object { $_['existing'] -ne $true })
$allowedTypes = @(
    'Microsoft.Resources/resourceGroups', 'Microsoft.Resources/deployments',
    'Microsoft.Web/sites', 'Microsoft.Web/sites/basicPublishingCredentialsPolicies',
    'Microsoft.Sql/servers', 'Microsoft.Sql/servers/databases',
    'Microsoft.Sql/servers/databases/backupShortTermRetentionPolicies', 'Microsoft.Sql/servers/firewallRules'
)
$checks = [ordered]@{
    'Only intended resources; no plan, vault, role assignment or paid networking' = {
        foreach ($resource in $resources) {
            Assert-True ($resource.type -in $allowedTypes) "Unexpected resource type: $($resource.type)"
        }
        Assert-True ($template.'$schema' -like '*subscriptionDeploymentTemplate*') 'Expected subscription scope'
    }
    'Resource discovery flags are required and parents are creation-only' = {
        foreach ($flag in @('webAppAlreadyExists', 'sqlServerAlreadyExists')) {
            Assert-True ($template.parameters[$flag].type -eq 'bool') "Missing boolean $flag"
            Assert-True (-not $template.parameters[$flag].ContainsKey('defaultValue')) "$flag must not default to unsafe recreation"
        }
        Assert-True ((Single-Resource 'Microsoft.Web/sites').condition -eq "[not(parameters('webAppAlreadyExists'))]") 'Existing Web App could be PUT again'
        Assert-True ((Single-Resource 'Microsoft.Sql/servers').condition -eq "[not(parameters('sqlServerAlreadyExists'))]") 'Existing SQL server could be PUT again'
    }
    'Web App has independent identity and hardened HTTPS hosting' = {
        $app = Single-Resource 'Microsoft.Web/sites'
        Assert-True ($app.identity.type -eq 'SystemAssigned') 'System identity missing'
        Assert-True ($app.properties.serverFarmId -eq "[parameters('existingPlanResourceId')]") 'Existing plan reference missing'
        Assert-True ($app.properties.httpsOnly -eq $true -and $app.properties.reserved -eq $true) 'HTTPS/Linux settings missing'
        $config = $app.properties.siteConfig
        Assert-True ($config.linuxFxVersion -eq 'DOTNETCORE|10.0' -and $config.alwaysOn -eq $true) 'Runtime/Always On mismatch'
        Assert-True ($config.minTlsVersion -eq '1.2' -and $config.scmMinTlsVersion -eq '1.2' -and $config.ftpsState -eq 'Disabled') 'TLS/FTP settings missing'
        Assert-True (-not $config.ContainsKey('appSettings') -and -not $config.ContainsKey('connectionStrings')) 'Manually managed credentials/settings would be overwritten'
        $policies = @($resources | Where-Object type -eq 'Microsoft.Web/sites/basicPublishingCredentialsPolicies')
        Assert-True ($policies.Count -eq 2) 'Both basic publishing policies are required'
        foreach ($policy in $policies) { Assert-True ($policy.properties.allow -eq $false) 'Basic publishing must be disabled' }
    }
    'SQL has Entra-only administrator and no password configuration' = {
        $sql = Single-Resource 'Microsoft.Sql/servers'
        Assert-True ($sql.properties.minimalTlsVersion -eq '1.2') 'SQL TLS missing'
        Assert-True ($sql.properties.administrators.azureADOnlyAuthentication -eq $true) 'SQL must use Entra-only authentication'
        Assert-True ($sql.properties.administrators.tenantId -eq "[parameters('hostingTenantId')]") 'SQL must use hosting tenant'
        Assert-True (-not $sql.properties.ContainsKey('administratorLoginPassword')) 'SQL password must not be configured'
    }
    'SQL free limits cannot silently become paid overage' = {
        $db = Single-Resource 'Microsoft.Sql/servers/databases'
        Assert-True ($db.sku.name -eq 'GP_S_Gen5_2' -and $db.sku.capacity -eq 2) 'Unexpected SQL SKU/capacity'
        Assert-True ($db.properties.useFreeLimit -eq $true) 'SQL free offer must be requested'
        Assert-True ($db.properties.freeLimitExhaustionBehavior -eq 'AutoPause') 'Paid overage is forbidden'
        Assert-True ($db.properties.autoPauseDelay -eq 60) 'Idle auto-pause must remain enabled'
        Assert-True ($db.properties.maxSizeBytes -eq 34359738368) 'Data storage must be limited to 32 GiB'
        Assert-True ($db.properties.requestedBackupStorageRedundancy -eq 'Local' -and $db.properties.zoneRedundant -eq $false) 'Unexpected paid redundancy'
        Assert-True ((Single-Resource 'Microsoft.Sql/servers/databases/backupShortTermRetentionPolicies').properties.retentionDays -eq 7) 'Unexpected retention'
    }
    'Firewall endpoints are identical and derive only from app outbound addresses' = {
        $rule = Single-Resource 'Microsoft.Sql/servers/firewallRules'
        Assert-True ($rule.properties.startIpAddress -eq $rule.properties.endIpAddress) 'Firewall must not allow ranges'
        $source = Get-Content -LiteralPath (Join-Path $PSScriptRoot '../bicep/resources.bicep') -Raw
        Assert-True ($source.Contains('webApp.properties.possibleOutboundIpAddresses')) 'Firewall addresses must originate from the Web App'
        $firewall = Get-Content -LiteralPath (Join-Path $PSScriptRoot '../bicep/sql-firewall.bicep') -Raw
        Assert-True ($firewall.Contains("ip != '0.0.0.0'") -and $firewall.Contains("!contains(ip, '/')") -and $firewall.Contains("!contains(ip, '*')")) 'Broad addresses must be excluded'
    }
    'No secret inputs/outputs; managed identity handoff remains available' = {
        foreach ($name in $template.parameters.Keys) {
            Assert-True ($name -notmatch 'secret|password|token|connectionString') "Unexpected credential input: $name"
        }
        foreach ($name in $template.outputs.Keys) {
            Assert-True ($name -notmatch 'secret|password|token') "Unexpected secret output: $name"
        }
        Assert-True ($template.outputs.ContainsKey('managedIdentitySqlConnectionString')) 'Missing passwordless SQL handoff'
        Assert-True ($template.outputs.ContainsKey('managedIdentityObjectId')) 'Missing identity output'
        $example = Get-Content -LiteralPath (Join-Path $PSScriptRoot '../bicep/pilot.parameters.example.json') -Raw | ConvertFrom-Json -AsHashtable
        Assert-True ($example.parameters.sqlAdministratorObjectId.value -like 'REPLACE_*') 'Example must not contain a real administrator'
        Assert-True (-not $example.parameters.ContainsKey('webAppAlreadyExists') -and -not $example.parameters.ContainsKey('sqlServerAlreadyExists')) 'Existence flags must be script-discovered'
    }
    'Ownership marker is fixed and names are deterministic' = {
        $mainSource = Get-Content -LiteralPath $templatePath -Raw
        Assert-True ($mainSource.Contains('union(tags, {') -and $mainSource.Contains("managedBy: 'my-little-days-family-pilot'")) 'Fixed ownership marker missing'
        $resourceSource = Get-Content -LiteralPath (Join-Path $PSScriptRoot '../bicep/resources.bicep') -Raw
        Assert-True ($resourceSource.Contains('uniqueString(resourceGroup().id)')) 'Names must be stable for this resource group'
        Assert-True (-not $resourceSource.Contains('newGuid(')) 'Resource names/history must not change on rerun'
    }
}

foreach ($check in $checks.GetEnumerator()) {
    & $check.Value
    Write-Host "PASS: $($check.Key)"
}
Write-Host "Passed $($checks.Count) compiled-template safety checks; no Azure resources accessed."
