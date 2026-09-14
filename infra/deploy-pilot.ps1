#requires -Version 7.0
[CmdletBinding()]
param(
    [ValidateSet('Validate', 'WhatIf', 'Deploy')]
    [string]$Mode = 'Validate',
    [string]$ParametersFile = (Join-Path $PSScriptRoot 'bicep/pilot.parameters.example.json'),
    [string]$SubscriptionId = '4768a858-f23f-4a39-bb64-eabc9c142627',
    [string]$DeploymentName = 'my-little-days-pilot',
    [switch]$ApproveDeployment,
    [switch]$ConfirmExistingPlanCapacity,
    [switch]$ReadOnlyPreview
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$ownerMarker = 'my-little-days-family-pilot'
$templateFile = Join-Path $PSScriptRoot 'bicep/main.bicep'

function Assert-Guid([object]$Value, [string]$Label) {
    $parsed = [guid]::Empty
    if ($Value -isnot [string] -or $Value -notmatch '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$' -or
        -not [guid]::TryParseExact($Value, 'D', [ref]$parsed) -or $parsed -eq [guid]::Empty) {
        throw "$Label must be a nonzero GUID without placeholders, braces or surrounding whitespace."
    }
}

function Invoke-AzJson([string[]]$Arguments) {
    # All ARM reads/writes select the subscription explicitly. Bicep commands are local-only.
    $result = & az @Arguments --only-show-errors 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw "Azure CLI command failed ($($Arguments[0..1] -join ' ')); stopped without fallback or cleanup."
    }
    try { return ($result -join "`n" | ConvertFrom-Json -AsHashtable -ErrorAction Stop) }
    catch { throw "Azure CLI returned invalid JSON ($($Arguments[0..1] -join ' ')); stopped. Follow up without exporting credentials." }
}

function Invoke-CloudJson([string[]]$Arguments) {
    return Invoke-AzJson ($Arguments + @('--subscription', $SubscriptionId, '--output', 'json'))
}

function Assert-Owned([System.Collections.IDictionary]$Resource) {
    if ($null -eq $Resource['tags'] -or $Resource['tags']['managedBy'] -cne $ownerMarker) {
        throw 'An existing target resource is not marked as this pilot. Choose a new resource group; existing resources were not changed.'
    }
}

function Normalize-Location([string]$Value) { return ($Value -replace '\s', '').ToLowerInvariant() }

Assert-Guid $SubscriptionId 'SubscriptionId'
if ($DeploymentName -notmatch '^[A-Za-z0-9][A-Za-z0-9._()-]{0,63}$') { throw 'DeploymentName is invalid.' }
if ($ReadOnlyPreview -and $Mode -ne 'WhatIf') { throw '-ReadOnlyPreview is supported only with -Mode WhatIf.' }
if ($Mode -eq 'Deploy' -and (-not $ApproveDeployment -or -not $ConfirmExistingPlanCapacity)) {
    throw 'Deploy requires both -ApproveDeployment and -ConfirmExistingPlanCapacity. Run WhatIf and review the shared plan capacity first.'
}
if (-not (Test-Path -LiteralPath $ParametersFile -PathType Leaf)) { throw 'ParametersFile does not exist.' }
if (-not (Test-Path -LiteralPath $templateFile -PathType Leaf)) { throw 'The pilot Bicep template does not exist.' }
$resolvedParametersFile = (Resolve-Path -LiteralPath $ParametersFile).Path
try { $document = Get-Content -LiteralPath $resolvedParametersFile -Raw | ConvertFrom-Json -AsHashtable -ErrorAction Stop }
catch { throw 'ParametersFile must contain a valid ARM deployment-parameters JSON document.' }
if ($document -isnot [System.Collections.IDictionary] -or $document['parameters'] -isnot [System.Collections.IDictionary]) {
    throw 'ParametersFile must contain an ARM parameters object.'
}
foreach ($key in $document.Keys) {
    if ($key -notin @('$schema', 'contentVersion', 'parameters')) { throw "Unknown parameters-file field: $key" }
}
$values = @{
    resourceGroupName = 'my-little-days-pilot-rg'
    location = 'australiasoutheast'
    existingPlanResourceGroup = 'ProdRG'
    existingPlanName = 'reticelASP'
    sqlAdministratorPrincipalType = 'User'
    tags = @{}
}
$allowedParameters = @('resourceGroupName', 'location', 'existingPlanResourceGroup', 'existingPlanName',
    'sqlAdministratorObjectId', 'sqlAdministratorDisplayName', 'sqlAdministratorPrincipalType', 'tags')
foreach ($key in $document.parameters.Keys) {
    if ($key -notin $allowedParameters) { throw "Unknown deployment parameter: $key" }
    $entry = $document.parameters[$key]
    if ($entry -isnot [System.Collections.IDictionary] -or $entry.Count -ne 1 -or -not $entry.Contains('value')) {
        throw "Parameter $key must have exactly one literal value; secret references are not accepted."
    }
    $values[$key] = $entry.value
}
foreach ($key in @('resourceGroupName', 'existingPlanResourceGroup', 'existingPlanName')) {
    if ($values[$key] -isnot [string] -or $values[$key] -notmatch '^[A-Za-z0-9][A-Za-z0-9._()-]{0,89}$' -or
        $values[$key] -match '(?i)REPLACE|PLACEHOLDER') { throw "Parameter $key is invalid or still a placeholder." }
}
if ($values.resourceGroupName -eq $values.existingPlanResourceGroup -or $values.resourceGroupName -eq 'ProdRG') {
    throw 'The pilot resource group must be separate from the existing plan resource group and ProdRG.'
}
if ($values.location -isnot [string] -or $values.location -notmatch '^[a-z][a-z0-9]{2,39}$') { throw 'location must be an Azure region code.' }
Assert-Guid $values['sqlAdministratorObjectId'] 'sqlAdministratorObjectId'
if ($values['sqlAdministratorDisplayName'] -isnot [string] -or
    [string]::IsNullOrWhiteSpace($values.sqlAdministratorDisplayName) -or
    $values.sqlAdministratorDisplayName.Length -gt 128 -or
    $values.sqlAdministratorDisplayName -match '[\x00-\x1f\x7f<>]|(?i:REPLACE|PLACEHOLDER)') {
    throw 'sqlAdministratorDisplayName must be the checked Entra administrator display name, without placeholders or control characters.'
}
if ($values.sqlAdministratorPrincipalType -cnotin @('User', 'Group')) { throw 'sqlAdministratorPrincipalType must be User or Group.' }
if ($values.tags -isnot [System.Collections.IDictionary]) { throw 'tags must be an object of string values.' }
foreach ($key in $values.tags.Keys) {
    if ($values.tags[$key] -isnot [string]) { throw 'Tag values must be strings.' }
    if ($key -ieq 'managedBy' -and ($key -cne 'managedBy' -or $values.tags[$key] -cne $ownerMarker)) {
        throw 'The pilot ownership tag cannot be overridden.'
    }
}

$null = Get-Command az -ErrorAction Stop
# Version checks do not install Bicep; fail before build if the local compiler is unavailable.
$null = & az bicep version --only-show-errors 2>$null
if ($LASTEXITCODE -ne 0) { throw 'A local Bicep compiler is required. No dependency was installed.' }
$compiled = Invoke-AzJson @('bicep', 'build', '--file', $templateFile, '--stdout')
if ($compiled -isnot [System.Collections.IDictionary] -or $null -eq $compiled.resources) { throw 'Bicep did not produce an ARM template.' }
if ($Mode -eq 'Validate') {
    [pscustomobject]@{ mode = $Mode; resourceGroupName = $values.resourceGroupName; location = $values.location;
        status = 'Local inputs and Bicep compilation passed. No Azure account or resource access performed.' }
    return
}

$snapshotDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ('little-days-infra-' + [guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $snapshotDirectory
$primaryFailure = $null
try {
# Freeze the validated inputs and compiled template once; source edits during a preview cannot alter deployment.
$frozenTemplateFile = Join-Path $snapshotDirectory 'compiled.json'
$frozenParametersFile = Join-Path $snapshotDirectory 'parameters.json'
$compiled | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $frozenTemplateFile -Encoding utf8
$frozenParameters = @{}
foreach ($key in $values.Keys) { $frozenParameters[$key] = @{ value = $values[$key] } }
@{ '$schema' = 'https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#'; contentVersion = '1.0.0.0'; parameters = $frozenParameters } |
    ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $frozenParametersFile -Encoding utf8

$account = Invoke-CloudJson @('account', 'show', '--query', '{id:id,state:state,tenantId:tenantId}')
if ($account.id -ine $SubscriptionId -or $account.state -cne 'Enabled') { throw 'The selected subscription is not enabled or does not match.' }
Assert-Guid $account.tenantId 'Selected subscription tenant'
foreach ($namespace in @('Microsoft.Web', 'Microsoft.Sql', 'Microsoft.Resources')) {
    $registration = Invoke-CloudJson @('provider', 'show', '--namespace', $namespace, '--query', 'registrationState')
    if ($registration -cne 'Registered') { throw "Provider $namespace is not registered. No provider registration was performed." }
}
$plan = Invoke-CloudJson @('appservice', 'plan', 'show', '--resource-group', $values.existingPlanResourceGroup,
    '--name', $values.existingPlanName, '--query', '{id:id,location:location,reserved:reserved,sku:sku,numberOfSites:numberOfSites,provisioningState:provisioningState}')
$planId = "/subscriptions/$SubscriptionId/resourceGroups/$($values.existingPlanResourceGroup)/providers/Microsoft.Web/serverfarms/$($values.existingPlanName)"
if ($plan.id -ine $planId -or $plan.reserved -ne $true -or $plan.sku.name -cne 'B1' -or
    $plan.sku.tier -cne 'Basic' -or $plan.sku.capacity -ne 1 -or
    (Normalize-Location $plan.location) -ne $values.location -or $plan.provisioningState -cne 'Succeeded') {
    throw 'The existing plan must be a healthy Linux B1 Basic plan with one instance in the requested region. No plan changes were made.'
}
Write-Warning "The existing B1 instance hosts $($plan.numberOfSites) app(s). Little Days shares its CPU and memory; this script does not resize the plan."
$runtimes = @(Invoke-CloudJson @('webapp', 'list-runtimes', '--os', 'linux'))
if ($runtimes -notcontains 'DOTNETCORE:10.0') { throw 'The selected subscription does not advertise the .NET 10 Linux App Service runtime. Deployment stopped.' }

$existing = @()
$sites = @()
$servers = @()
$groupExists = Invoke-CloudJson @('group', 'exists', '--name', $values.resourceGroupName)
if ($groupExists -isnot [bool]) { throw 'Could not determine whether the target resource group exists.' }
if ($groupExists) {
    $group = Invoke-CloudJson @('group', 'show', '--name', $values.resourceGroupName, '--query', '{id:id,location:location,tags:tags}')
    Assert-Owned $group
    if ((Normalize-Location $group.location) -ne $values.location) { throw 'The existing pilot resource group is in a different region.' }
    $existing = @(Invoke-CloudJson @('resource', 'list', '--resource-group', $values.resourceGroupName,
        '--query', '[].{id:id,name:name,type:type,tags:tags}'))
    $sites = @($existing | Where-Object { $_.type -ieq 'Microsoft.Web/sites' })
    $servers = @($existing | Where-Object { $_.type -ieq 'Microsoft.Sql/servers' })
    $databases = @($existing | Where-Object { $_.type -ieq 'Microsoft.Sql/servers/databases' -and $_.name -notmatch '/master$' })
    if ($sites.Count -gt 1 -or $servers.Count -gt 1 -or $databases.Count -gt 1) { throw 'The target resource group contains more resources than this pilot manages.' }
    foreach ($resource in $existing) {
        if ($resource.type -ieq 'Microsoft.Sql/servers/databases' -and $resource.name -match '/master$' -and
            $servers.Count -eq 1 -and $resource.name -ieq "$($servers[0].name)/master") { continue }
        # These fixed child-resource types do not support ownership tags; require the owned parent.
        if ($sites.Count -eq 1 -and $resource.type -ieq 'Microsoft.Web/sites/basicPublishingCredentialsPolicies' -and
            $resource.name -in @("$($sites[0].name)/scm", "$($sites[0].name)/ftp")) { continue }
        if ($servers.Count -eq 1 -and $resource.type -ieq 'Microsoft.Sql/servers/databases/backupShortTermRetentionPolicies' -and
            $resource.name -ieq "$($servers[0].name)/little-days-family/default") { continue }
        if ($servers.Count -eq 1 -and $resource.type -ieq 'Microsoft.Sql/servers/firewallRules' -and
            $resource.name -match "^$([regex]::Escape($servers[0].name))/app-([0-9]{1,3}-){3}[0-9]{1,3}$") { continue }
        Assert-Owned $resource
        switch ($resource.type.ToLowerInvariant()) {
            'microsoft.web/sites' {
                if ($resource.name -notmatch '^little-days-api-[a-z0-9]{13}$') { throw 'Unexpected Web App in the target group.' }
                $app = Invoke-CloudJson @('resource', 'show', '--ids', $resource.id, '--api-version', '2023-12-01',
                    '--query', '{serverFarmId:properties.serverFarmId,reserved:properties.reserved,httpsOnly:properties.httpsOnly,identity:identity}')
                if ($app.serverFarmId -ine $planId) { throw 'The existing pilot Web App uses a different App Service plan.' }
                if ($app.reserved -ne $true -or $app.httpsOnly -ne $true -or $null -eq $app['identity'] -or
                    $app.identity.type -notmatch '(^|,\s*)SystemAssigned(\s*,|$)') {
                    throw 'The existing Web App must remain Linux, HTTPS-only and use a system-assigned managed identity.'
                }
                Assert-Guid $app.identity.principalId 'Existing Web App managed identity'
                $siteConfig = Invoke-CloudJson @('webapp', 'config', 'show', '--resource-group', $values.resourceGroupName,
                    '--name', $resource.name, '--query', '{linuxFxVersion:linuxFxVersion,alwaysOn:alwaysOn,minTlsVersion:minTlsVersion,scmMinTlsVersion:scmMinTlsVersion,ftpsState:ftpsState}')
                if ($siteConfig.linuxFxVersion -cne 'DOTNETCORE|10.0' -or $siteConfig.alwaysOn -ne $true -or
                    $siteConfig.minTlsVersion -notin @('1.2', '1.3') -or $siteConfig.scmMinTlsVersion -notin @('1.2', '1.3') -or
                    $siteConfig.ftpsState -cne 'Disabled') {
                    throw 'Existing Web App runtime, Always On, TLS or FTPS configuration has drifted. Review it separately; this deployment does not rewrite existing app configuration.'
                }
            }
            'microsoft.sql/servers' {
                if ($resource.name -notmatch '^little-days-sql-[a-z0-9]{13}$') { throw 'Unexpected SQL server in the target group.' }
                # Ordinary server GET omits administrators. Request the documented child expansion explicitly.
                # https://learn.microsoft.com/rest/api/sql/servers/get?view=rest-sql-2023-08-01
                $expectedServerId = "/subscriptions/$SubscriptionId/resourceGroups/$($values.resourceGroupName)/providers/Microsoft.Sql/servers/$($resource.name)"
                if ($resource.id -ine $expectedServerId) { throw 'Unexpected SQL server resource ID outside the selected pilot target.' }
                $sqlServerUrl = 'https://management.azure.com' + $expectedServerId + '?api-version=2023-08-01&$expand=administrators/activedirectory'
                $sql = Invoke-CloudJson @('rest', '--method', 'get', '--url', $sqlServerUrl,
                    '--query', '{administrators:properties.administrators,minimalTlsVersion:properties.minimalTlsVersion,publicNetworkAccess:properties.publicNetworkAccess}')
                $admin = $sql.administrators
                if ($null -eq $admin -or $admin.sid -ine $values.sqlAdministratorObjectId -or
                    $admin.tenantId -ine $account.tenantId -or $admin.principalType -cne $values.sqlAdministratorPrincipalType -or
                    $admin.azureADOnlyAuthentication -ne $true) {
                    throw 'The existing SQL administrator or Entra-only authentication differs or cannot be verified. Stop and review; no administrator changes were made.'
                }
                if ($sql.minimalTlsVersion -cne '1.2' -or $sql.publicNetworkAccess -cne 'Enabled') {
                    throw 'Existing SQL TLS or network configuration differs from the selected-network pilot. Review it separately; the server is not rewritten.'
                }
                $rules = @(Invoke-CloudJson @('sql', 'server', 'firewall-rule', 'list', '--resource-group', $values.resourceGroupName,
                    '--server', $resource.name, '--query', '[].{name:name,startIpAddress:startIpAddress,endIpAddress:endIpAddress}'))
                foreach ($rule in $rules) {
                    $address = $null
                    if (-not [System.Net.IPAddress]::TryParse($rule.startIpAddress, [ref]$address) -or
                        $address.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork -or
                        $address.ToString() -cne $rule.startIpAddress -or $rule.startIpAddress -eq '0.0.0.0' -or
                        $rule.startIpAddress -cne $rule.endIpAddress -or
                        $rule.name -cne ('app-' + $rule.startIpAddress.Replace('.', '-'))) {
                        throw 'Existing SQL firewall has an unknown manual rule, invalid address, range or all-Azure rule. Review it separately; no rule was removed.'
                    }
                }
            }
            'microsoft.sql/servers/databases' {
                if ($servers.Count -ne 1 -or $resource.name -ine "$($servers[0].name)/little-days-family") { throw 'Unexpected SQL database in the target group.' }
                $db = Invoke-CloudJson @('resource', 'show', '--ids', $resource.id, '--api-version', '2023-08-01',
                    '--query', '{useFreeLimit:properties.useFreeLimit,freeLimitExhaustionBehavior:properties.freeLimitExhaustionBehavior}')
                if ($db.useFreeLimit -ne $true -or $db.freeLimitExhaustionBehavior -cne 'AutoPause') {
                    throw 'Existing SQL database is not using the free offer with AutoPause at its free limit. This script will not convert a paid database or opt into overage billing.'
                }
            }
            default { throw 'The target resource group contains a resource outside this pilot. Nothing was changed.' }
        }
    }
}

$deploymentArguments = @('--name', $DeploymentName, '--location', $values.location, '--template-file', $frozenTemplateFile,
    '--parameters', "@$frozenParametersFile")
function Get-PreviewChanges([string[]]$Arguments) {
    $previewArguments = @('deployment', 'sub', 'what-if') + $Arguments + @('--no-pretty-print', '--result-format', 'ResourceIdOnly')
    if ($ReadOnlyPreview) { $previewArguments += @('--validation-level', 'ProviderNoRbac') }
    $preview = Invoke-CloudJson $previewArguments
    if ($preview['status'] -cne 'Succeeded' -or $null -eq $preview['changes']) { throw 'Azure what-if did not return a successful resource preview. Deployment stopped.' }
    if (@($preview.changes | Where-Object { $_.changeType -eq 'Delete' }).Count -gt 0) { throw 'What-if proposes deletion. Deployment stopped for review.' }
    return $preview.changes
}
if ($existing.Count -gt 0) {
    # A read-only expansion identifies deterministic names even though the real deployment skips existing apps/servers.
    $discoveryChanges = @(Get-PreviewChanges ($deploymentArguments + @('webAppAlreadyExists=false', 'sqlServerAlreadyExists=false')))
    foreach ($resource in @($sites) + @($servers) + @($databases)) {
        if (@($discoveryChanges | Where-Object { $_.resourceId -ieq $resource.id -and $_.changeType -ne 'Ignore' }).Count -ne 1) {
            throw 'An existing pilot resource does not match this template expansion. Deployment stopped.'
        }
    }
}
$deploymentArguments += @(('webAppAlreadyExists=' + ($sites.Count -eq 1).ToString().ToLowerInvariant()),
    ('sqlServerAlreadyExists=' + ($servers.Count -eq 1).ToString().ToLowerInvariant()))
$changes = @(Get-PreviewChanges $deploymentArguments)
if ($Mode -eq 'WhatIf') {
    [pscustomobject]@{ mode = $Mode; resourceGroupName = $values.resourceGroupName; planId = $planId;
        existingAppCount = $plan.numberOfSites; changes = @($changes | ForEach-Object {
            [pscustomobject]@{ resourceId = $_.resourceId; changeType = $_.changeType }
        }); status = 'Read-only preflight and resource-ID-only what-if completed. No deployment performed.' }
    return
}

# This is the only cloud mutation. No app settings, API package, SQL schema, permissions or credentials are provisioned by the script.
$outputs = Invoke-CloudJson (@('deployment', 'sub', 'create') + $deploymentArguments + @('--query', 'properties.outputs'))
$safeOutputs = [ordered]@{ mode = $Mode; status = 'Infrastructure deployment returned successfully. API code, credentials and SQL initialization remain separate.' }
foreach ($name in @('resourceGroupName', 'webAppName', 'webAppResourceId', 'apiUrl', 'sqlServerName', 'sqlServerFqdn',
    'databaseName', 'managedIdentityObjectId', 'existingPlanResourceId', 'managedIdentitySqlConnectionString')) {
    if ($outputs.Contains($name)) {
        $value = $outputs[$name].value
        if ($name -eq 'managedIdentitySqlConnectionString' -and
            ($value -notmatch 'Authentication=Active Directory Managed Identity;' -or $value -match '(?i)(Password|Pwd|Access.Token)\s*=')) {
            throw 'Deployment returned an unexpected connection string; output withheld.'
        }
        $safeOutputs[$name] = $value
    }
}
$databaseId = "/subscriptions/$SubscriptionId/resourceGroups/$($values.resourceGroupName)/providers/Microsoft.Sql/servers/$($safeOutputs.sqlServerName)/databases/$($safeOutputs.databaseName)"
$freeStatus = Invoke-CloudJson @('resource', 'show', '--ids', $databaseId, '--api-version', '2023-08-01',
    '--query', '{useFreeLimit:properties.useFreeLimit,freeLimitExhaustionBehavior:properties.freeLimitExhaustionBehavior}')
if ($freeStatus.useFreeLimit -ne $true -or $freeStatus.freeLimitExhaustionBehavior -cne 'AutoPause') {
    throw 'Deployment completed, but free SQL with AutoPause could not be verified. Resources were retained; review before use. No paid fallback or cleanup was attempted.'
}
$safeOutputs['freeSqlVerified'] = $true
[pscustomobject]$safeOutputs
} catch {
    $primaryFailure = $_
    throw
} finally {
    # The only cleanup is this run's generated local files, including when preflight/deployment fails.
    try {
        $resolvedSnapshotDirectory = [System.IO.Path]::GetFullPath($snapshotDirectory)
        $resolvedTemporaryRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
        if (-not $resolvedSnapshotDirectory.StartsWith($resolvedTemporaryRoot, [StringComparison]::OrdinalIgnoreCase) -or
            (Split-Path $resolvedSnapshotDirectory -Leaf) -notmatch '^little-days-infra-[0-9a-f]{32}$') {
            throw 'Refusing cleanup outside the generated infrastructure snapshot directory.'
        }
        Remove-Item -LiteralPath $resolvedSnapshotDirectory -Recurse -Force
    } catch {
        if ($null -ne $primaryFailure) {
            Write-Warning "The local snapshot could not be removed at $snapshotDirectory. The original operation failure is preserved." -WarningAction Continue
        } else {
            throw "The operation finished, but its generated local snapshot could not be removed at $snapshotDirectory."
        }
    }
}
