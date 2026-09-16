#requires -Version 7.3
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$helper = Join-Path $PSScriptRoot '../github-database.ps1'
$names = @('GITHUB_ACTIONS','GITHUB_EVENT_NAME','GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','GITHUB_ENV',
    'AZURE_SUBSCRIPTION_ID','AZURE_TENANT_ID','AZURE_DB_MIGRATION_CLIENT_ID','FAMILY_DB_RESOURCE_GROUP',
    'FAMILY_DB_SERVER_NAME','FAMILY_DB_NAME','FAMILY_DB_MIGRATIONS_ENABLED','FAMILY_DB_RULE_CREATED','FAMILY_DB_SERVER','FAMILY_DB_TENANT_ID',
    'FAMILY_DB_APPROVED_FIREWALL_RULES_JSON')
$saved = @{}
foreach ($name in $names) { $saved[$name] = [Environment]::GetEnvironmentVariable($name) }
$temp = Join-Path ([IO.Path]::GetTempPath()) ('little-days-db-tests-' + [Guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $temp
$null = New-Item -ItemType File -Path (Join-Path $temp 'env')
$script:caseCount = 0
function Assert($condition, [string]$message) { if (!$condition) { throw $message } }
function Reset-Test {
    $global:dbTest = @{ Rules=@(); Calls=[Collections.Generic.List[string]]::new(); FailApply=$false; FailCreate=$false; FailCleanup=$false; FailCheck=$false; WrongIdentity=$false; Ip='20.30.40.50'; DriftOnCreate=$false }
    $env:GITHUB_ACTIONS='true'; $env:GITHUB_EVENT_NAME='workflow_dispatch'
    $env:GITHUB_RUN_ID='123'; $env:GITHUB_RUN_ATTEMPT='2'; $env:GITHUB_ENV=Join-Path $temp 'env'
    $env:AZURE_SUBSCRIPTION_ID='4768a858-f23f-4a39-bb64-eabc9c142627'
    $env:AZURE_TENANT_ID='7b7e6e31-a778-4334-aee2-e969fa27fd0e'
    $env:AZURE_DB_MIGRATION_CLIENT_ID='11111111-1111-1111-1111-111111111111'
    $env:FAMILY_DB_RESOURCE_GROUP='my-little-days-pilot-rg'
    $env:FAMILY_DB_SERVER_NAME='little-days-sql-522fpstfbtds2'
    $env:FAMILY_DB_NAME='little-days-family'; $env:FAMILY_DB_MIGRATIONS_ENABLED='true'
    $env:FAMILY_DB_RULE_CREATED=$null
    $env:FAMILY_DB_APPROVED_FIREWALL_RULES_JSON=$null
}
function global:az {
    $global:LASTEXITCODE=0
    $call = $args -join ' '
    $global:dbTest.Calls.Add($call)
    if ($call -match '^account show') {
        $identity = if ($global:dbTest.WrongIdentity) { 'unexpected' } else { $env:AZURE_DB_MIGRATION_CLIENT_ID }
        return @{tenantId=$env:AZURE_TENANT_ID;user=@{type='servicePrincipal';name=$identity}} | ConvertTo-Json -Depth 4
    }
    if ($call -match '^sql server show') {
        return @{id="/subscriptions/$env:AZURE_SUBSCRIPTION_ID/resourceGroups/$env:FAMILY_DB_RESOURCE_GROUP/providers/Microsoft.Sql/servers/$env:FAMILY_DB_SERVER_NAME";fullyQualifiedDomainName="$env:FAMILY_DB_SERVER_NAME.database.windows.net";tags=@{managedBy='my-little-days-family-pilot'}} | ConvertTo-Json -Depth 4
    }
    if ($call -match 'firewall-rule list') { return ConvertTo-Json -InputObject @($global:dbTest.Rules) -Depth 4 }
    if ($call -match 'firewall-rule create') {
        Assert ($call -match '--start-ip-address 20.30.40.50 --end-ip-address 20.30.40.50') 'Must add only exact runner IP'
        $global:dbTest.Rules += @{name='github-db-123-2'; startIpAddress='20.30.40.50'; endIpAddress='20.30.40.50'}
        if ($global:dbTest.DriftOnCreate) { $global:dbTest.Rules += @{name='unknown-range';startIpAddress='1.0.0.0';endIpAddress='223.255.255.255'} }
        if ($global:dbTest.FailCreate) { $global:LASTEXITCODE=1 }
        return '{}'
    }
    if ($call -match 'firewall-rule delete') {
        Assert ($call -match '--name github-db-123-2 ') 'Must delete only own run rule'
        if ($global:dbTest.FailCleanup) { $global:LASTEXITCODE=1; return '{}' }
        $global:dbTest.Rules = @($global:dbTest.Rules | Where-Object name -CNE 'github-db-123-2')
        return ''
    }
    throw "Unexpected mocked Azure operation: $call"
}
function global:dotnet {
    $global:dbTest.Calls.Add('dotnet ' + ($args -join ' '))
    $global:LASTEXITCODE = if (($args -contains '--apply' -and $global:dbTest.FailApply) -or ($args -contains '--check' -and $global:dbTest.FailCheck)) { 1 } else { 0 }
}
function global:Invoke-RestMethod { param($Uri,$TimeoutSec) Assert ($Uri -ceq 'https://api.ipify.org') 'Unexpected IP service'; return $global:dbTest.Ip }
function global:Start-Sleep { param($Seconds) }
function Run-Case([scriptblock]$configure, [bool]$shouldFail, [scriptblock]$verify) {
    Reset-Test
    $script:caseCount++
    & $configure
    $failure=$null
    try { & $helper -Mode Migrate -MigratorPath $helper } catch { $failure=$_ }
    Assert (($null -ne $failure) -eq $shouldFail) "Unexpected helper outcome: $failure"
    & $verify
}
function Assert-NoMigrationWrites {
    Assert (@($global:dbTest.Calls | Where-Object { $_ -match 'firewall-rule (create|delete)|^dotnet ' }).Count -eq 0) 'Invalid preflight reached migration or changed firewall rules'
}
try {
    Run-Case {} $false {
        Assert ($global:dbTest.Rules.Count -eq 0) 'Successful run did not clean up'
        $calls = $global:dbTest.Calls -join "`n"
        Assert ($calls.IndexOf('--check') -lt $calls.IndexOf('--apply')) 'Check must precede apply'
        Assert ($calls.IndexOf('--apply') -lt $calls.IndexOf('firewall-rule delete')) 'Cleanup must follow apply'
    }
    Run-Case { $global:dbTest.FailApply=$true } $true { Assert ($global:dbTest.Rules.Count -eq 0) 'Failed migration leaked firewall rule' }
    Run-Case { $global:dbTest.FailCreate=$true } $true { Assert ($global:dbTest.Rules.Count -eq 0) 'Uncertain creation leaked rule' }
    Run-Case { $global:dbTest.FailCheck=$true } $true {
        Assert ($global:dbTest.Rules.Count -eq 0) 'Failed check leaked rule'
        Assert (@($global:dbTest.Calls | Where-Object { $_ -match '--apply' }).Count -eq 0) 'Apply ran after failed checks'
    }
    Run-Case { $global:dbTest.FailCleanup=$true } $true { Assert ($global:dbTest.Rules.Count -eq 1) 'Expected cleanup failure to block release' }
    $global:dbTest.FailCleanup=$false
    & $helper -Mode Cleanup
    Assert ($global:dbTest.Rules.Count -eq 0) 'Always cleanup did not recover'
    Run-Case { $global:dbTest.WrongIdentity=$true } $true { Assert (@($global:dbTest.Calls | Where-Object { $_ -match 'firewall-rule create' }).Count -eq 0) 'Wrong identity wrote firewall' }
    Run-Case { $global:dbTest.Ip='192.168.1.2' } $true { Assert ($global:dbTest.Rules.Count -eq 0) 'Private IP opened rule' }
    foreach ($address in @('20.30.40.050','20.30.40','100.64.1.2','198.18.0.1','203.0.113.1','::ffff:20.30.40.50')) {
        Run-Case { $global:dbTest.Ip=$address } $true { Assert-NoMigrationWrites }
    }
    Run-Case { $env:FAMILY_DB_MIGRATIONS_ENABLED='false' } $true { Assert ($global:dbTest.Rules.Count -eq 0) 'Disabled migration opened rule' }
    Run-Case { $global:dbTest.Rules=@(@{name='github-db-previous';startIpAddress='20.20.20.20';endIpAddress='20.20.20.20'}) } $true {
        Assert ($global:dbTest.Rules[0].name -ceq 'github-db-previous') 'Touched previous run rule'
        Assert-NoMigrationWrites
    }
    Run-Case { $global:dbTest.Rules=@(@{name='AllowAzure';startIpAddress='0.0.0.0';endIpAddress='0.0.0.0'}) } $true { Assert-NoMigrationWrites }
    Run-Case {
        $global:dbTest.Rules=@(@{name='app-outbound';startIpAddress='20.21.22.23';endIpAddress='20.21.22.23'},
            @{name='ClientIPAddress_2026-9-15_22-43-19';startIpAddress='20.21.22.24';endIpAddress='20.21.22.24'})
    } $false {
        Assert ($global:dbTest.Rules.Count -eq 2) 'Changed retained exact-IP rules'
        Assert ($global:dbTest.Rules[0].name -ceq 'app-outbound' -and $global:dbTest.Rules[0].startIpAddress -ceq '20.21.22.23') 'Changed unrelated app firewall rule'
        Assert ($global:dbTest.Rules[1].name -ceq 'ClientIPAddress_2026-9-15_22-43-19' -and $global:dbTest.Rules[1].startIpAddress -ceq '20.21.22.24') 'Changed retained operator firewall rule'
    }
    Run-Case { $global:dbTest.Rules=@(@{name='legacy-range';startIpAddress='1.0.0.0';endIpAddress='223.255.255.255'}) } $true { Assert-NoMigrationWrites }
    Run-Case { $global:dbTest.Rules=@(@{name='existing-exact';startIpAddress='20.21.22.23';endIpAddress='20.21.22.23'}) } $false {
        Assert ($global:dbTest.Rules.Count -eq 1 -and $global:dbTest.Rules[0].name -ceq 'existing-exact') 'Changed existing exact-IP rule without a policy'
    }
    Run-Case { $global:dbTest.Rules=@(@{name='app-outbound';startIpAddress='20.21.22.23';endIpAddress='20.21.22.24'}) } $true { Assert-NoMigrationWrites }
    foreach ($address in @('192.168.1.2','10.0.0.1','172.16.0.1','127.0.0.1','169.254.1.2','100.64.1.2','198.18.0.1','203.0.113.1','20.21.22.023','::ffff:20.21.22.23')) {
        Run-Case { $global:dbTest.Rules=@(@{name='invalid-exact';startIpAddress=$address;endIpAddress=$address}) } $true { Assert-NoMigrationWrites }
    }
    Run-Case {
        $global:dbTest.Rules=@(@{name='app-outbound';startIpAddress='20.21.22.23';endIpAddress='20.21.22.23'},
            @{name='APP-OUTBOUND';startIpAddress='20.21.22.23';endIpAddress='20.21.22.23'})
    } $true { Assert-NoMigrationWrites }
    foreach ($policy in @('', '[]', '{', '{"app-outbound":"20.21.22.24"}')) {
        Run-Case {
            $env:FAMILY_DB_APPROVED_FIREWALL_RULES_JSON=$policy
            $global:dbTest.Rules=@(@{name='app-outbound';startIpAddress='20.21.22.23';endIpAddress='20.21.22.23'})
        } $false {
            Assert ($global:dbTest.Rules.Count -eq 1 -and $global:dbTest.Rules[0].startIpAddress -ceq '20.21.22.23') 'Obsolete approval variable blocked migration or changed an existing rule'
            Assert (@($global:dbTest.Calls | Where-Object { $_ -match '--apply' }).Count -eq 1) 'Migration did not apply when obsolete approval variable was present'
        }
    }
    Run-Case { $global:dbTest.DriftOnCreate=$true } $true {
        Assert ($global:dbTest.Rules.Count -eq 1 -and $global:dbTest.Rules[0].name -ceq 'unknown-range') 'Deleted an unrelated drift rule'
        Assert (@($global:dbTest.Calls | Where-Object { $_ -match '^dotnet ' }).Count -eq 0) 'Migration ran after firewall drift'
    }
    Reset-Test
    $env:FAMILY_DB_RULE_CREATED='github-db-123-2'
    $env:FAMILY_DB_APPROVED_FIREWALL_RULES_JSON=$null
    $global:dbTest.Rules=@(@{name='github-db-123-2';startIpAddress='20.30.40.50';endIpAddress='20.30.40.50'},
        @{name='unrelated';startIpAddress='1.0.0.0';endIpAddress='223.255.255.255'})
    & $helper -Mode Cleanup
    Assert ($global:dbTest.Rules.Count -eq 1 -and $global:dbTest.Rules[0].name -ceq 'unrelated') 'Cleanup must ignore unrelated rule safety and remove only its own run rule'
    Write-Output "PASS: $script:caseCount migration firewall cases plus two cleanup recovery checks; no Azure requests were made."
} finally {
    foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name,$saved[$name]) }
    foreach ($name in @('az','dotnet','Invoke-RestMethod','Start-Sleep')) { Remove-Item -LiteralPath "Function:\$name" }
    Remove-Variable -Name dbTest -Scope Global -ErrorAction SilentlyContinue
    $resolved = [IO.Path]::GetFullPath($temp)
    if ($resolved.StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath()),[StringComparison]::OrdinalIgnoreCase) -and
        [IO.Path]::GetFileName($resolved) -match '^little-days-db-tests-[a-f0-9]{32}$') { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
