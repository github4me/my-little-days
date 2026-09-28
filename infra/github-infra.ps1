#requires -Version 7.3
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('WhatIf', 'Deploy')][string]$Mode,
    [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Require-Guid([string]$Name) {
    $value = [Environment]::GetEnvironmentVariable($Name)
    $parsed = [guid]::Empty
    if ($value -notmatch '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$' -or
        -not [guid]::TryParseExact($value, 'D', [ref]$parsed) -or $parsed -eq [guid]::Empty) {
        throw "Configure $Name with a nonzero GUID."
    }
    return $parsed.ToString('D')
}

if ($env:GITHUB_ACTIONS -cne 'true' -or $env:GITHUB_EVENT_NAME -cnotin @('push', 'workflow_dispatch')) {
    throw 'Cloud infrastructure runs only on trusted pushes or manual GitHub Actions runs, never pull requests.'
}
if ([string]::IsNullOrWhiteSpace($env:FAMILY_INFRA_BRANCH) -or
    $env:GITHUB_REF -cne ('refs/heads/' + $env:FAMILY_INFRA_BRANCH)) {
    throw 'This is not the configured infrastructure deployment branch.'
}
if ($env:FAMILY_INFRA_ENABLED -cne 'true') { throw 'Infrastructure cloud jobs are not enabled.' }
if ($env:GITHUB_SHA -notmatch '^[0-9a-fA-F]{40}$') { throw 'GitHub must supply an immutable commit SHA.' }
$checkedOut = & git rev-parse HEAD 2>$null
if ($LASTEXITCODE -ne 0 -or $checkedOut -ine $env:GITHUB_SHA) { throw 'The checkout differs from the triggering commit.' }

$subscriptionId = Require-Guid 'AZURE_SUBSCRIPTION_ID'
$tenantId = Require-Guid 'AZURE_TENANT_ID'
$previewClientId = Require-Guid 'AZURE_INFRA_PREVIEW_CLIENT_ID'
$deployClientId = Require-Guid 'AZURE_INFRA_DEPLOY_CLIENT_ID'
if ($previewClientId -eq $deployClientId) { throw 'Preview and deployment must use distinct Azure identities.' }
$adminObjectId = Require-Guid 'SQL_ADMIN_OBJECT_ID'
if ([string]::IsNullOrWhiteSpace($env:SQL_ADMIN_DISPLAY_NAME) -or $env:SQL_ADMIN_DISPLAY_NAME.Length -gt 128 -or
    $env:SQL_ADMIN_DISPLAY_NAME -match '[\x00-\x1f\x7f<>]|(?i:REPLACE|PLACEHOLDER)') {
    throw 'Configure SQL_ADMIN_DISPLAY_NAME with the checked hosting-directory administrator name.'
}
if ($env:SQL_ADMIN_PRINCIPAL_TYPE -cnotin @('User', 'Group')) { throw 'SQL_ADMIN_PRINCIPAL_TYPE must be User or Group.' }
if ($Mode -eq 'Deploy' -and ($env:FAMILY_INFRA_APPLY_ENABLED -cne 'true' -or $env:FAMILY_INFRA_CAPACITY_CONFIRMED -cne 'true')) {
    throw 'Configure the protected environment, enable apply and confirm shared-plan capacity before deployment.'
}

# ProviderNoRbac requires a newer CLI than the original local wrapper. Never silently
# fall back to a preview identity with deployment permissions on an older CLI.
$versionJson = & az version --output json --only-show-errors 2>$null
if ($LASTEXITCODE -ne 0) { throw 'Azure CLI version could not be checked.' }
try { $cliVersion = [version]((($versionJson -join "`n") | ConvertFrom-Json).'azure-cli') }
catch { throw 'Azure CLI returned an invalid version.' }
if ($cliVersion -lt [version]'2.76.0') { throw 'GitHub infrastructure requires Azure CLI 2.76.0 or later for read-only preview.' }

$document = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'bicep/pilot.parameters.example.json') -Raw | ConvertFrom-Json -AsHashtable
$document.parameters.sqlAdministratorObjectId.value = $adminObjectId
$document.parameters.sqlAdministratorDisplayName.value = $env:SQL_ADMIN_DISPLAY_NAME
$document.parameters.sqlAdministratorPrincipalType.value = $env:SQL_ADMIN_PRINCIPAL_TYPE
$configuration = [ordered]@{
    commit = $env:GITHUB_SHA.ToLowerInvariant()
    subscription = $subscriptionId
    tenant = $tenantId
    previewClient = $previewClientId
    deployClient = $deployClientId
    parameters = $document.parameters
}
$bytes = [Text.Encoding]::UTF8.GetBytes(($configuration | ConvertTo-Json -Depth 30 -Compress))
$configurationHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
if ($Mode -eq 'Deploy' -and ($env:EXPECTED_CONFIGURATION_HASH -notmatch '^[0-9a-f]{64}$' -or
    $env:EXPECTED_CONFIGURATION_HASH -cne $configurationHash)) {
    throw 'Configuration differs from the completed preview. Run and review a new preview before deployment.'
}
if ($CheckOnly) {
    Write-Output "Configuration checked for $Mode at $($env:GITHUB_SHA). No Azure resource calls performed."
    return
}

foreach ($name in @('RUNNER_TEMP', 'GITHUB_OUTPUT', 'GITHUB_STEP_SUMMARY')) {
    if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name))) { throw "GitHub did not supply $name." }
}
$temporaryRoot = (Resolve-Path -LiteralPath $env:RUNNER_TEMP).Path
$runDirectory = Join-Path $temporaryRoot ('little-days-actions-' + [guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $runDirectory
$parameterFile = Join-Path $runDirectory 'parameters.json'
$primaryFailure = $null
try {
    $document | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $parameterFile -Encoding utf8
    $arguments = @{ Mode = $Mode; ParametersFile = $parameterFile; SubscriptionId = $subscriptionId }
    if ($Mode -eq 'WhatIf') { $arguments.ReadOnlyPreview = $true }
    else { $arguments.ApproveDeployment = $true; $arguments.ConfirmExistingPlanCapacity = $true }
    $result = & (Join-Path $PSScriptRoot 'deploy-pilot.ps1') @arguments
    # Only the wrapper's resource-ID preview or allow-listed deployment outputs are
    # published. Never log the parameter file, app settings, tokens or CLI debug output.
    $json = $result | ConvertTo-Json -Depth 15
    $summary = @(
        "## Infrastructure $Mode"
        "Commit: $($env:GITHUB_SHA)"
        "Configuration fingerprint: $configurationHash"
        ''
        '```json'
        $json
        '```'
    ) -join "`n"
    Add-Content -LiteralPath $env:GITHUB_STEP_SUMMARY -Value $summary -Encoding utf8
    Add-Content -LiteralPath $env:GITHUB_OUTPUT -Value "configuration_hash=$configurationHash" -Encoding utf8
    Write-Output $json
} catch {
    $primaryFailure = $_
    throw
} finally {
    try {
        # Delete only this invocation's single generated file and then its empty folder.
        if (Test-Path -LiteralPath $parameterFile) { Remove-Item -LiteralPath $parameterFile -Force }
        Remove-Item -LiteralPath $runDirectory
    } catch {
        if ($null -ne $primaryFailure) {
            Write-Warning "Local parameter cleanup failed at $runDirectory; original failure preserved." -WarningAction Continue
        } else { throw "The operation finished, but local parameter cleanup failed at $runDirectory." }
    }
}
