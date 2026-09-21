// Reviewed target state only; NOT imported by main.bicep or the deployment workflow.
// Follow docs/AZURE-SQL-BASIC-MIGRATION.md before provider validation or deployment.
// ARM can create a missing database: the operator must verify that the exact target
// already exists and reject Create/Delete changes. Never use Complete mode.
targetScope = 'resourceGroup'

@description('Existing SQL server. Preserve its identity, Entra administrator and firewall rules.')
@minLength(1)
param sqlServerName string

@description('Existing database name. This is an in-place tier change, not initialization.')
@minLength(1)
param databaseName string

@description('Current database location, obtained from its ARM GET response.')
@minLength(1)
param location string

@description('All current database tags, obtained from its ARM GET response. Preserve the ownership marker.')
param existingDatabaseTags object

@description('Explicit acknowledgement that Basic is paid and conversion cannot return this database to the free offer.')
@allowed([
  true
])
param confirmPaidBasic bool

resource sqlServer 'Microsoft.Sql/servers@2023-08-01' existing = {
  name: sqlServerName
}

resource database 'Microsoft.Sql/servers/databases@2023-08-01' = if (confirmPaidBasic) {
  parent: sqlServer
  name: databaseName
  location: location
  tags: existingDatabaseTags
  sku: {
    name: 'Basic'
    tier: 'Basic'
    capacity: 5
  }
  properties: {
    useFreeLimit: false
    maxSizeBytes: 2147483648
    requestedBackupStorageRedundancy: 'Local'
    zoneRedundant: false
    readScale: 'Disabled'
    // No Gen5 family, minCapacity, autoPauseDelay or freeLimitExhaustionBehavior:
    // those describe serverless/free-offer operation, not the paid Basic target.
    // Do not change collation, compatibility, identities, encryption or data.
  }
}

resource shortTermRetention 'Microsoft.Sql/servers/databases/backupShortTermRetentionPolicies@2023-08-01' = if (confirmPaidBasic) {
  parent: database
  name: 'default'
  properties: {
    retentionDays: 7
    diffBackupIntervalInHours: 12
  }
}
