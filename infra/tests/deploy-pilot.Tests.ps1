#requires -Version 7.0
# Standalone tests. All az calls resolve to the fake below; no Azure login, network or Pester dependency.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$script:passed = 0
$script:subscription = '4768a858-f23f-4a39-bb64-eabc9c142627'
$script:tenant = '11111111-2222-4333-8444-555555555555'
$script:administrator = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
$script:groupId = "/subscriptions/$script:subscription/resourceGroups/my-little-days-pilot-rg"
$script:planId = "/subscriptions/$script:subscription/resourceGroups/ProdRG/providers/Microsoft.Web/serverfarms/reticelASP"
$script:appName = 'little-days-api-abcdefghijklm'
$script:serverName = 'little-days-sql-abcdefghijklm'
$script:appId = "$script:groupId/providers/Microsoft.Web/sites/$script:appName"
$script:serverId = "$script:groupId/providers/Microsoft.Sql/servers/$script:serverName"
$script:databaseId = "$script:serverId/databases/little-days-family"
$script:fixtureDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ('little-days-deploy-tests-' + [guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path (Join-Path $script:fixtureDirectory 'bicep')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot '../deploy-pilot.ps1') -Destination (Join-Path $script:fixtureDirectory 'deploy-pilot.ps1')
Set-Content -LiteralPath (Join-Path $script:fixtureDirectory 'bicep/main.bicep') -Value '// Fake compiler fixture; no Azure resources.'
$script:fixtureScript = Join-Path $script:fixtureDirectory 'deploy-pilot.ps1'
$script:fixtureParameters = Join-Path $script:fixtureDirectory 'bicep/pilot.parameters.example.json'

function Assert-True([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Set-Parameters([hashtable]$Overrides = @{}) {
    $parameters = @{
        sqlAdministratorObjectId = @{ value = $script:administrator }
        sqlAdministratorDisplayName = @{ value = 'Synthetic SQL Admin' }
    }
    foreach ($key in $Overrides.Keys) { $parameters[$key] = @{ value = $Overrides[$key] } }
    @{ '$schema' = 'https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#'; contentVersion = '1.0.0.0'; parameters = $parameters } |
        ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $script:fixtureParameters
}
function Reset-Fake {
    $global:pilotAzCalls = [System.Collections.Generic.List[object]]::new()
    $global:pilotFake = @{
        failedCommand = ''; badJsonCommand = ''; groupExists = $false; registered = 'Registered'
        mutateParametersDuringWhatIf = $false; parameterSource = $script:fixtureParameters
        mutateTemplateDuringWhatIf = $false; templateSource = (Join-Path $script:fixtureDirectory 'bicep/main.bicep')
        simulateSnapshotCleanupFailure = $false; retainedSnapshot = ''
        observedParameterGroups = [System.Collections.Generic.List[string]]::new()
        observedTemplates = [System.Collections.Generic.List[string]]::new()
        account = @{ id = $script:subscription; tenantId = $script:tenant; state = 'Enabled' }
        plan = @{ id = $script:planId; location = 'Australia Southeast'; reserved = $true;
            sku = @{ name = 'B1'; tier = 'Basic'; capacity = 1 }; numberOfSites = 1; provisioningState = 'Succeeded' }
        group = @{ id = $script:groupId; location = 'australiasoutheast'; tags = @{ managedBy = 'my-little-days-family-pilot' } }
        resources = @(); appPlanId = $script:planId; appId = $script:appId; serverId = $script:serverId
        runtimes = @('DOTNETCORE:10.0'); httpsOnly = $true; reserved = $true
        identity = @{ type = 'SystemAssigned'; principalId = $script:administrator }
        siteConfig = @{ linuxFxVersion = 'DOTNETCORE|10.0'; alwaysOn = $true; minTlsVersion = '1.2'; scmMinTlsVersion = '1.2'; ftpsState = 'Disabled' }
        sqlTls = '1.2'; sqlNetwork = 'Enabled'; firewallRules = @()
        administrators = @{ sid = $script:administrator; tenantId = $script:tenant; principalType = 'User'; azureADOnlyAuthentication = $true }
        free = @{ useFreeLimit = $true; freeLimitExhaustionBehavior = 'AutoPause' }
        changes = @(
            @{ resourceId = $script:groupId; changeType = 'Create' },
            @{ resourceId = $script:appId; changeType = 'Create' },
            @{ resourceId = $script:serverId; changeType = 'Create' },
            @{ resourceId = $script:databaseId; changeType = 'Create' }
        )
        outputs = @{
            resourceGroupName = @{ value = 'my-little-days-pilot-rg' }; webAppName = @{ value = $script:appName }
            apiUrl = @{ value = "https://$script:appName.azurewebsites.net" }; sqlServerName = @{ value = $script:serverName }
            databaseName = @{ value = 'little-days-family' }; managedIdentityObjectId = @{ value = $script:administrator }
            managedIdentitySqlConnectionString = @{ value = "Server=tcp:$script:serverName.database.windows.net,1433;Database=little-days-family;Authentication=Active Directory Managed Identity;Encrypt=True;TrustServerCertificate=False;Connection Timeout=30;" }
            unexpectedOutput = @{ value = 'must-not-be-returned' }
        }
    }
    Set-Parameters
}
function Set-ExistingPilot {
    $global:pilotFake.groupExists = $true
    $global:pilotFake.resources = @(
        @{ id = $script:appId; name = $script:appName; type = 'Microsoft.Web/sites'; tags = @{ managedBy = 'my-little-days-family-pilot' } },
        @{ id = $script:serverId; name = $script:serverName; type = 'Microsoft.Sql/servers'; tags = @{ managedBy = 'my-little-days-family-pilot' } },
        @{ id = $script:databaseId; name = "$script:serverName/little-days-family"; type = 'Microsoft.Sql/servers/databases'; tags = @{ managedBy = 'my-little-days-family-pilot' } }
    )
}
function global:az {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
    $global:pilotAzCalls.Add([string[]]$Arguments)
    $global:LASTEXITCODE = 0
    $command = $Arguments[0..1] -join ' '
    if ($command -eq $global:pilotFake.failedCommand) { $global:LASTEXITCODE = 17; return 'Untrusted CLI diagnostic must not be echoed.' }
    if ($command -eq $global:pilotFake.badJsonCommand) { return 'not-json' }
    $result = switch ($command) {
        'bicep version' { return 'Bicep CLI version 0.99.0 (fake)' }
        'bicep build' { @{ resources = @() } }
        'account show' { $global:pilotFake.account }
        'provider show' { $global:pilotFake.registered }
        'appservice plan' { $global:pilotFake.plan }
        'group exists' { $global:pilotFake.groupExists }
        'group show' { $global:pilotFake.group }
        'webapp list-runtimes' { ,$global:pilotFake.runtimes }
        'webapp config' { $global:pilotFake.siteConfig }
        'sql server' { ,$global:pilotFake.firewallRules }
        'resource list' { ,$global:pilotFake.resources }
        'resource show' {
            $id = $Arguments[[array]::IndexOf($Arguments, '--ids') + 1]
            if ($id -match '/databases/') { $global:pilotFake.free }
            elseif ($id -match '/Microsoft.Sql/servers/') { throw 'Ordinary SQL server GET does not include administrators; use the expanded REST request.' }
            elseif ($id -match '/Microsoft.Web/sites/') { @{ serverFarmId = $global:pilotFake.appPlanId; httpsOnly = $global:pilotFake.httpsOnly; reserved = $global:pilotFake.reserved; identity = $global:pilotFake.identity } }
            else { throw "Unexpected fake resource query: $id" }
        }
        'rest --method' {
            $url = $Arguments[[array]::IndexOf($Arguments, '--url') + 1]
            $expectedUrl = 'https://management.azure.com' + $global:pilotFake.serverId + '?api-version=2023-08-01&$expand=administrators/activedirectory'
            if ($Arguments[2] -cne 'get' -or $url -cne $expectedUrl) {
                throw 'SQL administrator read must use the exact selected server GET with administrators/activedirectory expansion.'
            }
            @{ administrators = $global:pilotFake.administrators; minimalTlsVersion = $global:pilotFake.sqlTls; publicNetworkAccess = $global:pilotFake.sqlNetwork }
        }
        'deployment sub' {
            $parametersPath = $Arguments[[array]::IndexOf($Arguments, '--parameters') + 1].Substring(1)
            $parameterSnapshot = Get-Content -LiteralPath $parametersPath -Raw | ConvertFrom-Json -AsHashtable
            $global:pilotFake.observedParameterGroups.Add($parameterSnapshot.parameters.resourceGroupName.value)
            $templatePath = $Arguments[[array]::IndexOf($Arguments, '--template-file') + 1]
            $global:pilotFake.observedTemplates.Add((Get-Content -LiteralPath $templatePath -Raw))
            if ($Arguments[2] -eq 'what-if') {
                if ($global:pilotFake.mutateParametersDuringWhatIf) {
                    $source = Get-Content -LiteralPath $global:pilotFake.parameterSource -Raw | ConvertFrom-Json -AsHashtable
                    $source.parameters.resourceGroupName = @{ value = 'ProdRG' }
                    $source | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $global:pilotFake.parameterSource
                }
                if ($global:pilotFake.mutateTemplateDuringWhatIf) {
                    Set-Content -LiteralPath $global:pilotFake.templateSource -Value 'tampered-source-after-compilation'
                }
                $changes = @($global:pilotFake.changes | Where-Object {
                    -not (($_.resourceId -eq $global:pilotFake.appId -and $Arguments -contains 'webAppAlreadyExists=true') -or
                          ($_.resourceId -eq $global:pilotFake.serverId -and $Arguments -contains 'sqlServerAlreadyExists=true'))
                })
                @{ status = 'Succeeded'; changes = $changes }
            } elseif ($Arguments[2] -eq 'create') { $global:pilotFake.outputs }
            else { throw 'Unexpected fake deployment operation.' }
        }
        default { throw "Unexpected az invocation: $command" }
    }
    ConvertTo-Json -InputObject $result -Depth 20 -Compress
}
function global:Remove-Item {
    [CmdletBinding()]
    param([string]$LiteralPath, [switch]$Recurse, [switch]$Force)
    if ($global:pilotFake.simulateSnapshotCleanupFailure -and (Split-Path $LiteralPath -Leaf) -match '^little-days-infra-[0-9a-f]{32}$') {
        $global:pilotFake.retainedSnapshot = $LiteralPath
        throw 'Simulated temporary-file cleanup failure.'
    }
    Microsoft.PowerShell.Management\Remove-Item @PSBoundParameters
}
function Invoke-Pilot([string]$Mode = 'Validate', [switch]$Approve, [switch]$Capacity) {
    & $script:fixtureScript -Mode $Mode -ParametersFile $script:fixtureParameters -ApproveDeployment:$Approve -ConfirmExistingPlanCapacity:$Capacity 3>$null
}
function Assert-Rejected([scriptblock]$Action, [string]$Expected) {
    $rejected = $false
    try { $null = & $Action } catch {
        $rejected = $true
        Assert-True ($_.Exception.Message -match $Expected) "Expected rejection '$Expected', got '$($_.Exception.Message)'."
    }
    Assert-True $rejected 'Expected the operation to reject.'
    Assert-True (@($global:pilotAzCalls | Where-Object { $_[0..2] -join ' ' -eq 'deployment sub create' }).Count -eq 0) 'A rejected preflight must not deploy.'
}
function Test-Case([string]$Name, [scriptblock]$Action) {
    Reset-Fake
    & $Action
    $script:passed++
    Write-Output "PASS $Name"
}

try {
    Test-Case 'Validate compiles locally and never accesses an Azure account or resource' {
        $result = Invoke-Pilot
        Assert-True ($result.mode -eq 'Validate') 'Validate should return local status.'
        Assert-True ($global:pilotAzCalls.Count -eq 2 -and @($global:pilotAzCalls | Where-Object { $_[0] -ne 'bicep' }).Count -eq 0) 'Validate made a cloud call.'
        Assert-True ($global:pilotAzCalls[1] -contains '--stdout') 'Compilation must not generate tracked JSON.'
    }
    Test-Case 'WhatIf is read-only, uses resource IDs only, and selects the subscription on every cloud call' {
        $result = Invoke-Pilot 'WhatIf'
        foreach ($call in $global:pilotAzCalls) {
            if ($call[0] -eq 'bicep') { continue }
            Assert-True ($call -contains '--subscription') 'A cloud call omitted --subscription.'
            Assert-True ($call[[array]::IndexOf($call, '--subscription') + 1] -eq $script:subscription) 'Wrong subscription.'
            Assert-True ($call -notcontains 'appsettings') 'App settings must never be read.'
            Assert-True ($call -notcontains 'register' -and $call -notcontains 'set') 'Unexpected account/provider mutation.'
        }
        Assert-True ($global:pilotAzCalls[-1] -contains 'ResourceIdOnly') 'What-if must use ResourceIdOnly.'
        Assert-True ($result.mode -eq 'WhatIf') 'WhatIf should return a preview.'
    }
    Test-Case 'Deploy rejects absent approvals before invoking az' {
        Assert-Rejected { Invoke-Pilot 'Deploy' } 'requires both'
        Assert-True ($global:pilotAzCalls.Count -eq 0) 'Missing approval must stop before any az call.'
    }
    Test-Case 'Deploy rejects missing capacity confirmation' { Assert-Rejected { Invoke-Pilot 'Deploy' -Approve } 'requires both' }
    Test-Case 'Deploy rejects missing deployment approval' { Assert-Rejected { Invoke-Pilot 'Deploy' -Capacity } 'requires both' }
    Test-Case 'Approved deployment performs one create, verifies free SQL and returns only safe outputs' {
        $result = Invoke-Pilot 'Deploy' -Approve -Capacity
        $creates = @($global:pilotAzCalls | Where-Object { $_[0..2] -join ' ' -eq 'deployment sub create' })
        Assert-True ($creates.Count -eq 1) 'Expected exactly one deployment mutation.'
        Assert-True ($creates[0] -contains 'webAppAlreadyExists=false' -and $creates[0] -contains 'sqlServerAlreadyExists=false') 'Fresh deployment flags are wrong.'
        Assert-True ($result.freeSqlVerified -eq $true) 'Free SQL was not verified.'
        Assert-True ($null -eq $result.PSObject.Properties['unexpectedOutput']) 'Unknown deployment outputs leaked.'
        Assert-True ($result.managedIdentitySqlConnectionString -match 'Authentication=Active Directory Managed Identity') 'Missing password-free SQL connection string.'
        $frozenTemplate = $creates[0][[array]::IndexOf($creates[0], '--template-file') + 1]
        Assert-True (-not (Test-Path -LiteralPath $frozenTemplate)) 'Generated deployment snapshot was not cleaned up.'
    }
    Test-Case 'Source parameter changes during preview cannot change the reviewed deployment' {
        $global:pilotFake.mutateParametersDuringWhatIf = $true
        $null = Invoke-Pilot 'Deploy' -Approve -Capacity
        Assert-True ($global:pilotFake.observedParameterGroups.Count -eq 2) 'Expected preview and deployment to read the frozen parameters.'
        Assert-True (@($global:pilotFake.observedParameterGroups | Where-Object { $_ -ne 'my-little-days-pilot-rg' }).Count -eq 0) 'Mutable source parameters reached deployment.'
    }
    Test-Case 'Source template changes during preview cannot change the compiled deployment' {
        $global:pilotFake.mutateTemplateDuringWhatIf = $true
        $null = Invoke-Pilot 'Deploy' -Approve -Capacity
        Assert-True ($global:pilotFake.observedTemplates.Count -eq 2) 'Expected preview and deployment to read the frozen template.'
        Assert-True ($global:pilotFake.observedTemplates[0] -ceq $global:pilotFake.observedTemplates[1]) 'Mutable source template reached deployment.'
        Assert-True ($global:pilotFake.observedTemplates[1] -notmatch 'tampered-source') 'Deployment used changed source.'
    }
    Test-Case 'Disabled subscription is rejected' {
        $global:pilotFake.account.state = 'Disabled'
        Assert-Rejected { Invoke-Pilot 'Deploy' -Approve -Capacity } 'not enabled'
    }
    Test-Case 'Unregistered provider is rejected without registering it' {
        $global:pilotFake.registered = 'NotRegistered'
        Assert-Rejected { Invoke-Pilot 'Deploy' -Approve -Capacity } 'not registered'
    }
    Test-Case 'Wrong operating system is rejected' {
        $global:pilotFake.plan.reserved = $false
        Assert-Rejected { Invoke-Pilot 'Deploy' -Approve -Capacity } 'Linux B1'
    }
    Test-Case 'Unexpected plan tier is rejected' {
        $global:pilotFake.plan.sku.name = 'P1v3'
        Assert-Rejected { Invoke-Pilot 'Deploy' -Approve -Capacity } 'Linux B1'
    }
    Test-Case 'Unexpected instance count is rejected' {
        $global:pilotFake.plan.sku.capacity = 2
        Assert-Rejected { Invoke-Pilot 'Deploy' -Approve -Capacity } 'one instance'
    }
    Test-Case 'Wrong plan region is rejected' {
        $global:pilotFake.plan.location = 'Australia East'
        Assert-Rejected { Invoke-Pilot 'Deploy' -Approve -Capacity } 'requested region'
    }
    Test-Case 'Unavailable .NET 10 runtime blocks deployment' {
        $global:pilotFake.runtimes = @('DOTNETCORE:8.0')
        Assert-Rejected { Invoke-Pilot 'Deploy' -Approve -Capacity } 'runtime'
    }
    Test-Case 'Unowned existing resource group is rejected' {
        $global:pilotFake.groupExists = $true
        $global:pilotFake.group.tags = @{}
        Assert-Rejected { Invoke-Pilot 'Deploy' -Approve -Capacity } 'not marked'
    }
    Test-Case 'An unrelated resource in an owned group is rejected' {
        Set-ExistingPilot
        $global:pilotFake.resources += @{ id = "$script:groupId/providers/Microsoft.Storage/storageAccounts/other"; name = 'other'; type = 'Microsoft.Storage/storageAccounts'; tags = @{ managedBy = 'my-little-days-family-pilot' } }
        Assert-Rejected { Invoke-Pilot 'Deploy' -Approve -Capacity } 'outside this pilot'
    }
    Test-Case 'A paid SQL database cannot be converted by rerun' {
        Set-ExistingPilot
        $global:pilotFake.free.useFreeLimit = $false
        Assert-Rejected { Invoke-Pilot 'Deploy' -Approve -Capacity } 'will not convert a paid'
    }
    Test-Case 'Overage billing cannot be selected on rerun' {
        Set-ExistingPilot
        $global:pilotFake.free.freeLimitExhaustionBehavior = 'BillOverUsage'
        Assert-Rejected { Invoke-Pilot 'Deploy' -Approve -Capacity } 'overage billing'
    }
    Test-Case 'SQL administrator drift blocks rerun' {
        Set-ExistingPilot
        $global:pilotFake.administrators.sid = $script:tenant
        Assert-Rejected { Invoke-Pilot 'Deploy' -Approve -Capacity } 'administrator'
    }
    Test-Case 'Rerun requests the documented expanded SQL server GET with explicit subscription' {
        Set-ExistingPilot
        $null = Invoke-Pilot 'WhatIf'
        $reads = @($global:pilotAzCalls | Where-Object { $_[0] -eq 'rest' })
        Assert-True ($reads.Count -eq 1) 'Expected one expanded SQL server read.'
        Assert-True ($reads[0] -contains '--subscription' -and $reads[0] -contains $script:subscription) 'REST request did not select the subscription.'
        Assert-True ($reads[0][2] -ceq 'get') 'SQL administrator REST request must be read-only.'
        $expectedUrl = 'https://management.azure.com' + $script:serverId + '?api-version=2023-08-01&$expand=administrators/activedirectory'
        Assert-True ($reads[0] -ccontains $expectedUrl) 'SQL server administrator expansion was omitted or targeted the wrong server.'
    }
    Test-Case 'Missing administrator data still fails closed after an expanded GET' {
        Set-ExistingPilot
        $global:pilotFake.administrators = $null
        Assert-Rejected { Invoke-Pilot 'Deploy' -Approve -Capacity } 'administrator'
    }
    Test-Case 'Entra-only authentication drift blocks rerun' {
        Set-ExistingPilot
        $global:pilotFake.administrators.azureADOnlyAuthentication = $false
        Assert-Rejected { Invoke-Pilot 'Deploy' -Approve -Capacity } 'Entra-only'
    }
    Test-Case 'Existing app on another plan is rejected' {
        Set-ExistingPilot
        $global:pilotFake.appPlanId = '/another-plan'
        Assert-Rejected { Invoke-Pilot 'Deploy' -Approve -Capacity } 'different App Service plan'
    }
    Test-Case 'Existing app without HTTPS-only is rejected' {
        Set-ExistingPilot
        $global:pilotFake.httpsOnly = $false
        Assert-Rejected { Invoke-Pilot 'Deploy' -Approve -Capacity } 'HTTPS-only'
    }
    Test-Case 'Existing app without a system-assigned identity is rejected' {
        Set-ExistingPilot
        $global:pilotFake.identity.type = 'UserAssigned'
        Assert-Rejected { Invoke-Pilot 'Deploy' -Approve -Capacity } 'system-assigned'
    }
    Test-Case 'Existing app runtime drift is rejected' {
        Set-ExistingPilot
        $global:pilotFake.siteConfig.linuxFxVersion = 'DOTNETCORE|8.0'
        Assert-Rejected { Invoke-Pilot 'Deploy' -Approve -Capacity } 'runtime, Always On'
    }
    Test-Case 'Existing app Always On drift is rejected' {
        Set-ExistingPilot
        $global:pilotFake.siteConfig.alwaysOn = $false
        Assert-Rejected { Invoke-Pilot 'Deploy' -Approve -Capacity } 'Always On'
    }
    Test-Case 'Existing app TLS drift is rejected' {
        Set-ExistingPilot
        $global:pilotFake.siteConfig.minTlsVersion = '1.0'
        Assert-Rejected { Invoke-Pilot 'Deploy' -Approve -Capacity } 'TLS'
    }
    Test-Case 'Existing app FTPS drift is rejected' {
        Set-ExistingPilot
        $global:pilotFake.siteConfig.ftpsState = 'AllAllowed'
        Assert-Rejected { Invoke-Pilot 'Deploy' -Approve -Capacity } 'FTPS'
    }
    Test-Case 'Existing SQL TLS drift is rejected' {
        Set-ExistingPilot
        $global:pilotFake.sqlTls = '1.0'
        Assert-Rejected { Invoke-Pilot 'Deploy' -Approve -Capacity } 'SQL TLS'
    }
    foreach ($rule in @(
        @{ name = 'AllowAllWindowsAzureIps'; startIpAddress = '0.0.0.0'; endIpAddress = '0.0.0.0' },
        @{ name = 'app-10-1-2-3'; startIpAddress = '10.1.2.3'; endIpAddress = '10.1.2.9' },
        @{ name = 'manual-operator'; startIpAddress = '10.1.2.3'; endIpAddress = '10.1.2.3' },
        @{ name = 'app-invalid'; startIpAddress = 'not-an-ip'; endIpAddress = 'not-an-ip' }
    )) {
        Test-Case "Unsafe existing SQL firewall rule is rejected: $($rule.name)" {
            Set-ExistingPilot
            $global:pilotFake.firewallRules = @($rule)
            Assert-Rejected { Invoke-Pilot 'Deploy' -Approve -Capacity } 'SQL firewall'
        }
    }
    Test-Case 'A similarly named but different owned app is rejected by deterministic template expansion' {
        Set-ExistingPilot
        $global:pilotFake.resources[0].name = 'little-days-api-zzzzzzzzzzzzz'
        $global:pilotFake.resources[0].id = "$script:groupId/providers/Microsoft.Web/sites/little-days-api-zzzzzzzzzzzzz"
        Assert-Rejected { Invoke-Pilot 'Deploy' -Approve -Capacity } 'does not match this template'
    }
    Test-Case 'Rerun derives both skip-existing flags and performs a separate name-discovery preview' {
        Set-ExistingPilot
        $null = Invoke-Pilot 'Deploy' -Approve -Capacity
        $previews = @($global:pilotAzCalls | Where-Object { $_[0..2] -join ' ' -eq 'deployment sub what-if' })
        Assert-True ($previews.Count -eq 2) 'Rerun should validate deterministic IDs and preview actual changes.'
        $create = @($global:pilotAzCalls | Where-Object { $_[0..2] -join ' ' -eq 'deployment sub create' })[0]
        Assert-True ($create -contains 'webAppAlreadyExists=true' -and $create -contains 'sqlServerAlreadyExists=true') 'Rerun must skip PUT of existing app/server.'
    }
    Test-Case 'Partial retry skips only the existing Web App' {
        Set-ExistingPilot
        $global:pilotFake.resources = @($global:pilotFake.resources[0])
        $null = Invoke-Pilot 'Deploy' -Approve -Capacity
        $create = @($global:pilotAzCalls | Where-Object { $_[0..2] -join ' ' -eq 'deployment sub create' })[0]
        Assert-True ($create -contains 'webAppAlreadyExists=true' -and $create -contains 'sqlServerAlreadyExists=false') 'Partial retry flags are wrong.'
    }
    Test-Case 'Partial retry skips only the existing SQL server' {
        Set-ExistingPilot
        $global:pilotFake.resources = @($global:pilotFake.resources[1])
        $null = Invoke-Pilot 'Deploy' -Approve -Capacity
        $create = @($global:pilotAzCalls | Where-Object { $_[0..2] -join ' ' -eq 'deployment sub create' })[0]
        Assert-True ($create -contains 'webAppAlreadyExists=false' -and $create -contains 'sqlServerAlreadyExists=true') 'SQL-server-only retry flags are wrong.'
    }
    Test-Case 'What-if deletion stops deployment' {
        $global:pilotFake.changes[0].changeType = 'Delete'
        Assert-Rejected { Invoke-Pilot 'Deploy' -Approve -Capacity } 'proposes deletion'
    }
    Test-Case 'Local compilation failure stops before Azure reads' {
        $global:pilotFake.failedCommand = 'bicep build'
        Assert-Rejected { Invoke-Pilot 'Deploy' -Approve -Capacity } 'command failed'
        Assert-True (@($global:pilotAzCalls | Where-Object { $_[0] -ne 'bicep' }).Count -eq 0) 'Compile failure contacted Azure.'
    }
    Test-Case 'Azure command failure stops without fallback or raw diagnostics' {
        $global:pilotFake.failedCommand = 'provider show'
        Assert-Rejected { Invoke-Pilot 'Deploy' -Approve -Capacity } 'stopped without fallback'
    }
    Test-Case 'Snapshot cleanup failure preserves the original Azure command failure' {
        $global:pilotFake.failedCommand = 'provider show'
        $global:pilotFake.simulateSnapshotCleanupFailure = $true
        try {
            Assert-Rejected { Invoke-Pilot 'Deploy' -Approve -Capacity } 'Azure CLI command failed'
        } finally {
            $retained = [System.IO.Path]::GetFullPath($global:pilotFake.retainedSnapshot)
            Assert-True ($retained.StartsWith([System.IO.Path]::GetTempPath(), [StringComparison]::OrdinalIgnoreCase) -and
                (Split-Path $retained -Leaf) -match '^little-days-infra-[0-9a-f]{32}$') 'Unsafe retained test snapshot path.'
            Microsoft.PowerShell.Management\Remove-Item -LiteralPath $retained -Recurse -Force
        }
    }
    Test-Case 'Malformed Azure response stops deployment' {
        $global:pilotFake.badJsonCommand = 'account show'
        Assert-Rejected { Invoke-Pilot 'Deploy' -Approve -Capacity } 'invalid JSON'
    }
    foreach ($guid in @('00000000-0000-0000-0000-000000000000', 'REPLACE_OBJECT_ID', "{$script:administrator}", " $script:administrator")) {
        Test-Case "Invalid administrator GUID rejected: $guid" {
            Set-Parameters @{ sqlAdministratorObjectId = $guid }
            Assert-Rejected { Invoke-Pilot } 'nonzero GUID'
            Assert-True ($global:pilotAzCalls.Count -eq 0) 'Invalid inputs should fail before invoking az.'
        }
    }
    Test-Case 'Unknown parameter is rejected' {
        Set-Parameters @{ allowPaidFallback = $true }
        Assert-Rejected { Invoke-Pilot } 'Unknown deployment parameter'
    }
    Test-Case 'Internal existence flags cannot be supplied by parameter files' {
        Set-Parameters @{ webAppAlreadyExists = $true }
        Assert-Rejected { Invoke-Pilot } 'Unknown deployment parameter'
    }
    Test-Case 'Empty administrator display name is rejected' {
        Set-Parameters @{ sqlAdministratorDisplayName = ' ' }
        Assert-Rejected { Invoke-Pilot } 'checked Entra administrator'
    }
    Test-Case 'Existing production group cannot become the pilot group' {
        Set-Parameters @{ resourceGroupName = 'ProdRG' }
        Assert-Rejected { Invoke-Pilot } 'must be separate'
    }
    Test-Case 'Ownership tag cannot be replaced' {
        Set-Parameters @{ tags = @{ managedBy = 'another-application' } }
        Assert-Rejected { Invoke-Pilot } 'cannot be overridden'
    }
    Write-Output "$script:passed mocked deployment tests passed. No Azure commands were executed."
} finally {
    Microsoft.PowerShell.Management\Remove-Item -LiteralPath Function:\az
    Microsoft.PowerShell.Management\Remove-Item -LiteralPath Function:\Remove-Item
    Remove-Variable -Name pilotAzCalls, pilotFake -Scope Global -ErrorAction SilentlyContinue
    # Only generated fixtures below the exact GUID-named temp directory are removed.
    $resolvedFixtureDirectory = [System.IO.Path]::GetFullPath($script:fixtureDirectory)
    $resolvedTemp = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
    if (-not $resolvedFixtureDirectory.StartsWith($resolvedTemp, [StringComparison]::OrdinalIgnoreCase) -or
        (Split-Path $resolvedFixtureDirectory -Leaf) -notmatch '^little-days-deploy-tests-[0-9a-f]{32}$') {
        throw 'Refusing cleanup outside the generated test fixture directory.'
    }
    Microsoft.PowerShell.Management\Remove-Item -LiteralPath $resolvedFixtureDirectory -Recurse -Force
}
