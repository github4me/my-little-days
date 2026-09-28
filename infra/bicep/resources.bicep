targetScope = 'resourceGroup'

param location string
param existingPlanResourceId string
param hostingTenantId string
param sqlAdministratorObjectId string
param sqlAdministratorDisplayName string

@allowed([
  'User'
  'Group'
])
param sqlAdministratorPrincipalType string

param webAppAlreadyExists bool
param sqlServerAlreadyExists bool
param tags object

var suffix = uniqueString(resourceGroup().id)
var webAppName = 'little-days-api-${suffix}'
var sqlServerName = 'little-days-sql-${suffix}'
var databaseName = 'little-days-family'

resource newSqlServer 'Microsoft.Sql/servers@2023-08-01' = if (!sqlServerAlreadyExists) {
  name: sqlServerName
  location: location
  tags: tags
  properties: {
    version: '12.0'
    minimalTlsVersion: '1.2'
    // Enabled with exact firewall rules means selected networks, not unrestricted access.
    publicNetworkAccess: 'Enabled'
    administrators: {
      administratorType: 'ActiveDirectory'
      azureADOnlyAuthentication: true
      login: sqlAdministratorDisplayName
      principalType: sqlAdministratorPrincipalType
      sid: sqlAdministratorObjectId
      tenantId: hostingTenantId
    }
  }
}

resource sqlServer 'Microsoft.Sql/servers@2023-08-01' existing = {
  name: sqlServerName
}

// Free-offer eligibility is a deployment prerequisite. There is deliberately no
// paid SKU/fallback or overage switch in this template. Azure must reject an
// ineligible free-offer request rather than deploy an ordinary paid database.
resource database 'Microsoft.Sql/servers/databases@2023-08-01' = {
  parent: sqlServer
  name: databaseName
  location: location
  tags: tags
  sku: {
    name: 'GP_S_Gen5_2'
    tier: 'GeneralPurpose'
    family: 'Gen5'
    capacity: 2
  }
  properties: {
    useFreeLimit: true
    freeLimitExhaustionBehavior: 'AutoPause'
    autoPauseDelay: 60
    // Bicep has no decimal literal; ARM receives the number 0.5.
    minCapacity: json('0.5')
    maxSizeBytes: 34359738368
    requestedBackupStorageRedundancy: 'Local'
    zoneRedundant: false
    readScale: 'Disabled'
  }
  dependsOn: [
    newSqlServer
  ]
}

resource shortTermRetention 'Microsoft.Sql/servers/databases/backupShortTermRetentionPolicies@2023-08-01' = {
  parent: database
  name: 'default'
  properties: {
    retentionDays: 7
  }
}

// The setup script discovers whether this exact owned app already exists.
// Never PUT an existing site's configuration: incremental deployment is not a
// merge guarantee for separately managed app settings or connection strings.
resource newWebApp 'Microsoft.Web/sites@2024-04-01' = if (!webAppAlreadyExists) {
  name: webAppName
  location: location
  kind: 'app,linux'
  tags: tags
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: existingPlanResourceId
    reserved: true
    httpsOnly: true
    publicNetworkAccess: 'Enabled'
    clientAffinityEnabled: false
    siteConfig: {
      linuxFxVersion: 'DOTNETCORE|10.0'
      appCommandLine: 'dotnet LittleDays.FamilyApi.dll'
      alwaysOn: true
      minTlsVersion: '1.2'
      scmMinTlsVersion: '1.2'
      ftpsState: 'Disabled'
      http20Enabled: true
      // App settings/connection strings are configured separately after creation.
    }
  }
}

resource webApp 'Microsoft.Web/sites@2024-04-01' existing = {
  name: webAppName
}

resource scmBasicPublishing 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2024-04-01' = {
  parent: webApp
  name: 'scm'
  properties: {
    allow: false
  }
  dependsOn: [
    newWebApp
  ]
}

resource ftpBasicPublishing 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2024-04-01' = {
  parent: webApp
  name: 'ftp'
  properties: {
    allow: false
  }
  dependsOn: [
    newWebApp
  ]
}

// These runtime properties are read only after the new app exists. A nested
// module permits the firewall resource loop to use the resulting address list.
// There is no operator-IP rule and no 0.0.0.0 AllowAzureServices rule.
module sqlFirewall './sql-firewall.bicep' = {
  name: 'little-days-pilot-sql-firewall'
  params: {
    sqlServerName: sqlServer.name
    outboundIpAddresses: filter(split(webApp.properties.possibleOutboundIpAddresses, ','), ip => !empty(ip))
  }
  dependsOn: [
    newSqlServer
    newWebApp
  ]
}

output apiUrl string = 'https://${webApp.properties.defaultHostName}'
output webAppName string = webApp.name
output webAppResourceId string = webApp.id
output managedIdentityObjectId string = webApp.identity.principalId
output sqlServerName string = sqlServer.name
output sqlServerFqdn string = sqlServer.properties.fullyQualifiedDomainName
output databaseName string = database.name
output managedIdentitySqlConnectionString string = 'Server=tcp:${sqlServer.properties.fullyQualifiedDomainName},1433;Database=${database.name};Authentication=Active Directory Managed Identity;Encrypt=True;TrustServerCertificate=False;Connection Timeout=30;'
