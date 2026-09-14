#requires -Version 7.3
# Exercises the real GitHub helper with fake git, az and deployment wrapper commands.
# No Azure account/resource calls, GitHub calls, installations or Pester dependency.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$script:passed = 0
$script:fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ('little-days-github-tests-' + [guid]::NewGuid().ToString('N'))
$script:fixtureInfra = Join-Path $script:fixtureRoot 'infra'
$script:runnerTemp = Join-Path $script:fixtureRoot 'runner-temp'
$script:outputFile = Join-Path $script:fixtureRoot 'github-output.txt'
$script:summaryFile = Join-Path $script:fixtureRoot 'github-summary.md'
$script:fixtureHelper = Join-Path $script:fixtureInfra 'github-infra.ps1'
$script:fixtureParameters = Join-Path $script:fixtureInfra 'bicep/pilot.parameters.example.json'
$script:originalParameterJson = Get-Content -LiteralPath (Join-Path $PSScriptRoot '../bicep/pilot.parameters.example.json') -Raw
$script:baseEnvironment = @{
    GITHUB_ACTIONS = 'true'; GITHUB_EVENT_NAME = 'push'; FAMILY_INFRA_BRANCH = 'main'; GITHUB_REF = 'refs/heads/main'
    FAMILY_INFRA_ENABLED = 'true'; GITHUB_SHA = ('a' * 40)
    AZURE_SUBSCRIPTION_ID = '11111111-2222-4333-8444-555555555555'
    AZURE_TENANT_ID = '22222222-3333-4444-8555-666666666666'
    AZURE_INFRA_PREVIEW_CLIENT_ID = '33333333-4444-4555-8666-777777777777'
    AZURE_INFRA_DEPLOY_CLIENT_ID = '44444444-5555-4666-8777-888888888888'
    SQL_ADMIN_OBJECT_ID = '55555555-6666-4777-8888-999999999999'
    SQL_ADMIN_DISPLAY_NAME = 'Synthetic private administrator'; SQL_ADMIN_PRINCIPAL_TYPE = 'User'
    FAMILY_INFRA_APPLY_ENABLED = 'true'; FAMILY_INFRA_CAPACITY_CONFIRMED = 'true'; EXPECTED_CONFIGURATION_HASH = $null
    RUNNER_TEMP = $script:runnerTemp; GITHUB_OUTPUT = $script:outputFile; GITHUB_STEP_SUMMARY = $script:summaryFile
}
$script:savedEnvironment = @{}
foreach ($name in $script:baseEnvironment.Keys) { $script:savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name) }
$script:savedFunctions = @{}
foreach ($name in @('az', 'git')) {
    $item = Get-Item -LiteralPath "Function:\$name" -ErrorAction SilentlyContinue
    if ($null -ne $item) { $script:savedFunctions[$name] = $item.ScriptBlock }
}
$script:savedFake = Get-Variable -Name littleDaysGithubFake -Scope Global -ErrorAction SilentlyContinue

function Assert-True([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Set-FixtureEnvironment([string]$Name, [AllowNull()][string]$Value) {
    [Environment]::SetEnvironmentVariable($Name, $Value, [EnvironmentVariableTarget]::Process)
}
function Reset-Fixture {
    foreach ($name in $script:baseEnvironment.Keys) { Set-FixtureEnvironment $name $script:baseEnvironment[$name] }
    $global:littleDaysGithubFake = @{
        gitHead = $script:baseEnvironment.GITHUB_SHA; gitExitCode = 0; cliVersion = '2.76.0'; azExitCode = 0; invalidVersionJson = $false
        failWrapper = $false
        gitCalls = [System.Collections.Generic.List[object]]::new()
        azCalls = [System.Collections.Generic.List[object]]::new()
        wrapperCalls = [System.Collections.Generic.List[object]]::new()
    }
    Set-Content -LiteralPath $script:fixtureParameters -Value $script:originalParameterJson -Encoding utf8
    Set-Content -LiteralPath $script:outputFile -Value '' -Encoding utf8
    Set-Content -LiteralPath $script:summaryFile -Value '' -Encoding utf8
}
function Invoke-Helper([string]$Mode = 'WhatIf', [switch]$CheckOnly) {
    & $script:fixtureHelper -Mode $Mode -CheckOnly:$CheckOnly 3>$null
}
function Read-ConfigurationHash {
    $lines = @(Get-Content -LiteralPath $script:outputFile | Where-Object { $_ -match '^configuration_hash=[0-9a-f]{64}$' })
    Assert-True ($lines.Count -gt 0) 'The helper did not publish a configuration fingerprint to GITHUB_OUTPUT.'
    return $lines[-1].Substring('configuration_hash='.Length)
}
function Assert-Rejected([scriptblock]$Action, [string]$Expected) {
    $rejected = $false
    try { $null = & $Action } catch {
        $rejected = $true
        Assert-True ($_.Exception.Message -match $Expected) "Expected rejection '$Expected', got '$($_.Exception.Message)'."
    }
    Assert-True $rejected 'The helper should have rejected this invocation.'
}
function Test-Case([string]$Name, [scriptblock]$Action) {
    Reset-Fixture
    & $Action
    $script:passed++
    Write-Output "PASS $Name"
}

$wrapperStub = @'
param(
    [string]$Mode,
    [string]$ParametersFile,
    [string]$SubscriptionId,
    [switch]$ReadOnlyPreview,
    [switch]$ApproveDeployment,
    [switch]$ConfirmExistingPlanCapacity
)
$document = Get-Content -LiteralPath $ParametersFile -Raw | ConvertFrom-Json -AsHashtable
$global:littleDaysGithubFake.wrapperCalls.Add(@{
    mode = $Mode; parametersFile = $ParametersFile; subscription = $SubscriptionId; document = $document
    readOnlyPreview = $ReadOnlyPreview.IsPresent; approved = $ApproveDeployment.IsPresent; capacityConfirmed = $ConfirmExistingPlanCapacity.IsPresent
})
if ($global:littleDaysGithubFake.failWrapper) { throw 'Simulated deployment wrapper failure.' }
[pscustomobject]@{
    mode = $Mode
    resourceGroupName = 'synthetic-pilot-rg'
    status = 'Synthetic wrapper output; no external operation.'
}
'@

try {
    $null = New-Item -ItemType Directory -Path (Join-Path $script:fixtureInfra 'bicep'), $script:runnerTemp
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot '../github-infra.ps1') -Destination $script:fixtureHelper
    Set-Content -LiteralPath (Join-Path $script:fixtureInfra 'deploy-pilot.ps1') -Value $wrapperStub -Encoding utf8

    function global:git {
        param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
        $global:littleDaysGithubFake.gitCalls.Add([string[]]$Arguments)
        if (($Arguments -join ' ') -cne 'rev-parse HEAD') { throw 'Unexpected git command in the isolated GitHub-helper tests.' }
        $global:LASTEXITCODE = $global:littleDaysGithubFake.gitExitCode
        return $global:littleDaysGithubFake.gitHead
    }
    function global:az {
        param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
        $global:littleDaysGithubFake.azCalls.Add([string[]]$Arguments)
        if (($Arguments -join ' ') -cne 'version --output json --only-show-errors') {
            throw 'Only local az version is permitted in these tests; no Azure resource commands are allowed.'
        }
        $global:LASTEXITCODE = $global:littleDaysGithubFake.azExitCode
        if ($global:littleDaysGithubFake.invalidVersionJson) { return 'not-json' }
        return (@{ 'azure-cli' = $global:littleDaysGithubFake.cliVersion } | ConvertTo-Json -Compress)
    }

    Test-Case 'CheckOnly validates trusted configuration without deployment, output files or runner-temp access' {
        foreach ($name in @('RUNNER_TEMP', 'GITHUB_OUTPUT', 'GITHUB_STEP_SUMMARY')) { Set-FixtureEnvironment $name $null }
        $result = Invoke-Helper -CheckOnly
        Assert-True ($result -match 'No Azure resource calls performed') 'CheckOnly should return its local validation status.'
        Assert-True ($global:littleDaysGithubFake.wrapperCalls.Count -eq 0) 'CheckOnly invoked the resource wrapper.'
        Assert-True ($global:littleDaysGithubFake.azCalls.Count -eq 1) 'CheckOnly should perform only the local CLI version check.'
        Assert-True (@(Get-ChildItem -LiteralPath $script:runnerTemp -Force).Count -eq 0) 'CheckOnly created a parameter directory.'
        Assert-True ([string]::IsNullOrWhiteSpace((Get-Content -LiteralPath $script:outputFile -Raw))) 'CheckOnly wrote GitHub outputs.'
        Reset-Fixture
        $null = Invoke-Helper
        Set-FixtureEnvironment 'EXPECTED_CONFIGURATION_HASH' (Read-ConfigurationHash)
        $publishedBefore = Get-Content -LiteralPath $script:outputFile -Raw
        foreach ($name in @('RUNNER_TEMP', 'GITHUB_OUTPUT', 'GITHUB_STEP_SUMMARY')) { Set-FixtureEnvironment $name $null }
        $result = Invoke-Helper 'Deploy' -CheckOnly
        Assert-True ($result -match 'Configuration checked for Deploy' -and $global:littleDaysGithubFake.wrapperCalls.Count -eq 1) 'Deploy CheckOnly invoked the deployment wrapper.'
        Assert-True ((Get-Content -LiteralPath $script:outputFile -Raw) -ceq $publishedBefore -and
            @(Get-ChildItem -LiteralPath $script:runnerTemp -Force).Count -eq 0) 'Deploy CheckOnly created parameters or published outputs.'
    }
    Test-Case 'WhatIf passes ReadOnlyPreview and the explicit subscription without deployment approvals' {
        $null = Invoke-Helper
        $call = $global:littleDaysGithubFake.wrapperCalls[0]
        Assert-True ($call.mode -ceq 'WhatIf' -and $call.readOnlyPreview) 'Preview must use the read-only wrapper flag.'
        Assert-True (-not $call.approved -and -not $call.capacityConfirmed) 'Preview must not grant deployment approvals.'
        Assert-True ($call.subscription -ceq $script:baseEnvironment.AZURE_SUBSCRIPTION_ID) 'The wrapper subscription was not explicit.'
        Assert-True ((Read-ConfigurationHash) -match '^[0-9a-f]{64}$') 'Preview did not produce the handoff hash.'
    }
    Test-Case 'Deploy requires and accepts the fingerprint produced by the completed preview' {
        $null = Invoke-Helper
        Set-FixtureEnvironment 'EXPECTED_CONFIGURATION_HASH' (Read-ConfigurationHash)
        $null = Invoke-Helper 'Deploy'
        $call = $global:littleDaysGithubFake.wrapperCalls[1]
        Assert-True ($call.mode -ceq 'Deploy' -and $call.approved -and $call.capacityConfirmed) 'Deployment approvals were not passed to the wrapper.'
        Assert-True (-not $call.readOnlyPreview) 'Deployment must not use the preview validation flag.'
    }
    Test-Case 'Pull requests and untrusted events are rejected before git or Azure CLI' {
        foreach ($event in @('pull_request', 'pull_request_target', 'workflow_run')) {
            Reset-Fixture
            Set-FixtureEnvironment 'GITHUB_EVENT_NAME' $event
            Assert-Rejected { Invoke-Helper } 'never pull requests'
            Assert-True ($global:littleDaysGithubFake.gitCalls.Count -eq 0 -and $global:littleDaysGithubFake.azCalls.Count -eq 0) 'Untrusted event reached command execution.'
        }
    }
    Test-Case 'Tags, other branches and differently cased branches are rejected' {
        foreach ($ref in @('refs/tags/main', 'refs/heads/other', 'refs/heads/Main')) {
            Reset-Fixture
            Set-FixtureEnvironment 'GITHUB_REF' $ref
            Assert-Rejected { Invoke-Helper } 'configured infrastructure deployment branch'
            Assert-True ($global:littleDaysGithubFake.gitCalls.Count -eq 0 -and $global:littleDaysGithubFake.wrapperCalls.Count -eq 0) 'Untrusted ref reached the checkout or deployment wrapper.'
        }
    }
    Test-Case 'GitHub Actions and enable flags require exact lowercase true' {
        foreach ($case in @(
            @{ name = 'GITHUB_ACTIONS'; value = 'True' }, @{ name = 'GITHUB_ACTIONS'; value = '1' },
            @{ name = 'FAMILY_INFRA_ENABLED'; value = 'TRUE' }, @{ name = 'FAMILY_INFRA_ENABLED'; value = 'true ' }
        )) {
            Reset-Fixture
            Set-FixtureEnvironment $case.name $case.value
            Assert-Rejected { Invoke-Helper } 'trusted pushes|not enabled'
            Assert-True ($global:littleDaysGithubFake.azCalls.Count -eq 0 -and $global:littleDaysGithubFake.wrapperCalls.Count -eq 0) 'An inexact enable flag reached Azure validation.'
        }
    }
    Test-Case 'Malformed or placeholder GUIDs are rejected across every identity setting' {
        foreach ($case in @(
            @{ name = 'AZURE_SUBSCRIPTION_ID'; value = '00000000-0000-0000-0000-000000000000' },
            @{ name = 'AZURE_TENANT_ID'; value = 'REPLACE_TENANT' },
            @{ name = 'AZURE_INFRA_PREVIEW_CLIENT_ID'; value = ('{' + $script:baseEnvironment.AZURE_INFRA_PREVIEW_CLIENT_ID + '}') },
            @{ name = 'AZURE_INFRA_DEPLOY_CLIENT_ID'; value = (' ' + $script:baseEnvironment.AZURE_INFRA_DEPLOY_CLIENT_ID) },
            @{ name = 'SQL_ADMIN_OBJECT_ID'; value = 'not-a-guid' }
        )) {
            Reset-Fixture
            Set-FixtureEnvironment $case.name $case.value
            Assert-Rejected { Invoke-Helper } 'nonzero GUID'
            Assert-True ($global:littleDaysGithubFake.azCalls.Count -eq 0 -and $global:littleDaysGithubFake.wrapperCalls.Count -eq 0) 'Invalid identity reached Azure validation.'
        }
    }
    Test-Case 'Preview and deployment cannot use the same Azure identity' {
        Set-FixtureEnvironment 'AZURE_INFRA_DEPLOY_CLIENT_ID' $script:baseEnvironment.AZURE_INFRA_PREVIEW_CLIENT_ID
        Assert-Rejected { Invoke-Helper } 'distinct Azure identities'
        Assert-True ($global:littleDaysGithubFake.azCalls.Count -eq 0) 'Identity separation was checked too late.'
    }
    Test-Case 'Disabled apply and absent or inexact capacity confirmation block deployment' {
        foreach ($case in @(
            @{ name = 'FAMILY_INFRA_APPLY_ENABLED'; value = 'false' }, @{ name = 'FAMILY_INFRA_APPLY_ENABLED'; value = 'True' },
            @{ name = 'FAMILY_INFRA_CAPACITY_CONFIRMED'; value = $null }, @{ name = 'FAMILY_INFRA_CAPACITY_CONFIRMED'; value = '1' }
        )) {
            Reset-Fixture
            Set-FixtureEnvironment $case.name $case.value
            Assert-Rejected { Invoke-Helper 'Deploy' } 'enable apply and confirm shared-plan capacity'
            Assert-True ($global:littleDaysGithubFake.azCalls.Count -eq 0 -and $global:littleDaysGithubFake.wrapperCalls.Count -eq 0) 'Disabled deployment reached Azure validation.'
        }
    }
    Test-Case 'Azure CLI older than 2.76 is rejected without a permission fallback' {
        $global:littleDaysGithubFake.cliVersion = '2.75.0'
        Assert-Rejected { Invoke-Helper } '2.76.0 or later'
        Assert-True ($global:littleDaysGithubFake.azCalls.Count -eq 1 -and $global:littleDaysGithubFake.wrapperCalls.Count -eq 0) 'Old CLI triggered a retry or resource operation.'
    }
    Test-Case 'CLI failure or malformed version output stops before parameter creation' {
        $global:littleDaysGithubFake.azExitCode = 17
        Assert-Rejected { Invoke-Helper } 'version could not be checked'
        Reset-Fixture
        $global:littleDaysGithubFake.invalidVersionJson = $true
        Assert-Rejected { Invoke-Helper } 'invalid version'
        Assert-True (@(Get-ChildItem -LiteralPath $script:runnerTemp -Force).Count -eq 0) 'Version failure left parameter files.'
    }
    Test-Case 'A mismatching checkout or failed git lookup blocks cloud work' {
        $global:littleDaysGithubFake.gitHead = 'b' * 40
        Assert-Rejected { Invoke-Helper } 'checkout differs'
        Assert-True ($global:littleDaysGithubFake.azCalls.Count -eq 0) 'Mismatching checkout reached Azure CLI.'
        Reset-Fixture
        $global:littleDaysGithubFake.gitExitCode = 1
        Assert-Rejected { Invoke-Helper } 'checkout differs'
        Assert-True ($global:littleDaysGithubFake.azCalls.Count -eq 0) 'Failed git lookup reached Azure CLI.'
    }
    Test-Case 'Quoted administrator names are passed as JSON values without corruption' {
        $name = 'Synthetic "quoted" \ administrator'
        Set-FixtureEnvironment 'SQL_ADMIN_DISPLAY_NAME' $name
        $null = Invoke-Helper
        Assert-True ($global:littleDaysGithubFake.wrapperCalls[0].document.parameters.sqlAdministratorDisplayName.value -ceq $name) 'Administrator name was corrupted by JSON encoding.'
    }
    Test-Case 'Outputs publish only safe wrapper results and a fingerprint, never administrator details or parameter paths' {
        $result = Invoke-Helper
        $published = ($result -join "`n") + (Get-Content -LiteralPath $script:summaryFile -Raw) + (Get-Content -LiteralPath $script:outputFile -Raw)
        $call = $global:littleDaysGithubFake.wrapperCalls[0]
        Assert-True (-not $published.Contains($script:baseEnvironment.SQL_ADMIN_DISPLAY_NAME)) 'Administrator name leaked into published output.'
        Assert-True (-not $published.Contains($call.parametersFile) -and -not $published.Contains('sqlAdministratorObjectId')) 'Raw parameter content or its path leaked.'
        Assert-True ($published.Contains('Synthetic wrapper output') -and $published.Contains('Configuration fingerprint:')) 'Expected safe result and fingerprint were missing.'
    }
    Test-Case 'Generated parameters and their invocation folder are removed after success' {
        $null = Invoke-Helper
        $path = $global:littleDaysGithubFake.wrapperCalls[0].parametersFile
        Assert-True (-not (Test-Path -LiteralPath $path) -and -not (Test-Path -LiteralPath (Split-Path $path -Parent))) 'Successful invocation retained generated parameters.'
        Assert-True (@(Get-ChildItem -LiteralPath $script:runnerTemp -Force).Count -eq 0) 'Unexpected files remain in runner temp.'
    }
    Test-Case 'Wrapper failure removes parameters and publishes no success fingerprint or summary' {
        $global:littleDaysGithubFake.failWrapper = $true
        Assert-Rejected { Invoke-Helper } 'Simulated deployment wrapper failure'
        $path = $global:littleDaysGithubFake.wrapperCalls[0].parametersFile
        Assert-True (-not (Test-Path -LiteralPath $path) -and -not (Test-Path -LiteralPath (Split-Path $path -Parent))) 'Failed invocation retained generated parameters.'
        Assert-True ([string]::IsNullOrWhiteSpace((Get-Content -LiteralPath $script:outputFile -Raw)) -and
            [string]::IsNullOrWhiteSpace((Get-Content -LiteralPath $script:summaryFile -Raw))) 'Failed wrapper published successful GitHub outputs.'
    }
    Test-Case 'Configuration changed after preview is rejected before the deployment wrapper' {
        $null = Invoke-Helper
        Set-FixtureEnvironment 'EXPECTED_CONFIGURATION_HASH' (Read-ConfigurationHash)
        Set-FixtureEnvironment 'SQL_ADMIN_DISPLAY_NAME' 'Changed synthetic administrator'
        Assert-Rejected { Invoke-Helper 'Deploy' } 'Configuration differs from the completed preview'
        Assert-True ($global:littleDaysGithubFake.wrapperCalls.Count -eq 1) 'Changed configuration reached the deployment wrapper.'
    }
    Test-Case 'The generated fingerprint binds the commit, every Azure identity and effective parameters' {
        $null = Invoke-Helper
        $baseline = Read-ConfigurationHash
        foreach ($name in @('GITHUB_SHA', 'AZURE_SUBSCRIPTION_ID', 'AZURE_TENANT_ID', 'AZURE_INFRA_PREVIEW_CLIENT_ID', 'AZURE_INFRA_DEPLOY_CLIENT_ID', 'SQL_ADMIN_OBJECT_ID')) {
            Reset-Fixture
            if ($name -eq 'GITHUB_SHA') {
                Set-FixtureEnvironment $name ('b' * 40)
                $global:littleDaysGithubFake.gitHead = 'b' * 40
            } else { Set-FixtureEnvironment $name 'abcdefab-1234-4567-89ab-cdefabcdefab' }
            $null = Invoke-Helper
            Assert-True ((Read-ConfigurationHash) -cne $baseline) "Fingerprint did not bind $name."
        }
        Reset-Fixture
        $document = Get-Content -LiteralPath $script:fixtureParameters -Raw | ConvertFrom-Json -AsHashtable
        $document.parameters.resourceGroupName.value = 'my-little-days-different-pilot-rg'
        $document | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $script:fixtureParameters -Encoding utf8
        $null = Invoke-Helper
        Assert-True ((Read-ConfigurationHash) -cne $baseline) 'Fingerprint did not bind the effective parameter document.'
    }
    Test-Case 'Missing, malformed or unrelated preview fingerprints never permit deployment' {
        foreach ($hash in @('', ('A' * 64), ('f' * 64))) {
            Reset-Fixture
            Set-FixtureEnvironment 'EXPECTED_CONFIGURATION_HASH' $hash
            Assert-Rejected { Invoke-Helper 'Deploy' } 'Configuration differs from the completed preview'
            Assert-True ($global:littleDaysGithubFake.wrapperCalls.Count -eq 0) 'Invalid handoff hash reached deployment.'
        }
    }
    Test-Case 'Unsafe administrator names and unsupported principal-type casing are rejected' {
        foreach ($case in @(
            @{ name = 'SQL_ADMIN_DISPLAY_NAME'; value = "Synthetic`nAdmin" }, @{ name = 'SQL_ADMIN_DISPLAY_NAME'; value = 'REPLACE_ADMIN' },
            @{ name = 'SQL_ADMIN_PRINCIPAL_TYPE'; value = 'user' }
        )) {
            Reset-Fixture
            Set-FixtureEnvironment $case.name $case.value
            Assert-Rejected { Invoke-Helper } 'SQL_ADMIN_DISPLAY_NAME|SQL_ADMIN_PRINCIPAL_TYPE'
            Assert-True ($global:littleDaysGithubFake.azCalls.Count -eq 0) 'Invalid administrator configuration reached Azure validation.'
        }
    }
    Write-Output "$script:passed GitHub infrastructure helper tests passed. All git, az and deployment calls were fake."
} finally {
    foreach ($name in $script:savedEnvironment.Keys) { Set-FixtureEnvironment $name $script:savedEnvironment[$name] }
    foreach ($name in @('az', 'git')) {
        if ($script:savedFunctions.ContainsKey($name)) {
            Set-Item -Path "Function:global:$name" -Value $script:savedFunctions[$name]
        } else { Remove-Item -LiteralPath "Function:\$name" -ErrorAction SilentlyContinue }
    }
    if ($null -ne $script:savedFake) { Set-Variable -Name littleDaysGithubFake -Scope Global -Value $script:savedFake.Value }
    else { Remove-Variable -Name littleDaysGithubFake -Scope Global -ErrorAction SilentlyContinue }
    $resolvedFixture = [IO.Path]::GetFullPath($script:fixtureRoot)
    $temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if (-not $resolvedFixture.StartsWith($temporaryRoot, [StringComparison]::OrdinalIgnoreCase) -or
        (Split-Path $resolvedFixture -Leaf) -notmatch '^little-days-github-tests-[0-9a-f]{32}$') {
        throw 'Refusing cleanup outside the generated GitHub-helper fixture directory.'
    }
    if (Test-Path -LiteralPath $resolvedFixture) { Remove-Item -LiteralPath $resolvedFixture -Recurse -Force }
}
