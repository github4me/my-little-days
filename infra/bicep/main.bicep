targetScope = 'subscription'

@description('Dedicated resource group for this pilot. The existing App Service plan stays in its current resource group.')
@minLength(1)
@maxLength(90)
param resourceGroupName string = 'my-little-days-pilot-rg'

@description('Must match the existing Linux App Service plan location; the setup script verifies this before deployment.')
param location string = 'australiasoutheast'

@description('Resource group containing the existing plan. This template never creates or updates that plan.')
param existingPlanResourceGroup string = 'ProdRG'

@description('Existing Linux App Service plan to share without changing its size or configuration.')
param existingPlanName string = 'reticelASP'

@description('Object ID of the existing SQL administrator user or group in the hosting subscription tenant, not the customer tenant.')
@minLength(36)
@maxLength(36)
param sqlAdministratorObjectId string

@description('Login/display name of the selected existing SQL administrator.')
@minLength(1)
param sqlAdministratorDisplayName string

@allowed([
  'User'
  'Group'
])
param sqlAdministratorPrincipalType string = 'User'

@description('Internal setup-script flag from read-only resource discovery. Existing apps are referenced without PUT so separately managed configuration remains intact.')
param webAppAlreadyExists bool

@description('Internal setup-script flag from read-only resource discovery. Existing SQL servers and their administrator configuration are referenced without PUT.')
param sqlServerAlreadyExists bool

@description('Optional resource tags. The pilot ownership marker cannot be overridden.')
param tags object = {}

var managedTags = union(tags, {
  managedBy: 'my-little-days-family-pilot'
})

resource existingPlan 'Microsoft.Web/serverfarms@2024-04-01' existing = {
  name: existingPlanName
  scope: resourceGroup(existingPlanResourceGroup)
}

resource pilotResourceGroup 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: resourceGroupName
  location: location
  tags: managedTags
}

module pilot './resources.bicep' = {
  name: 'little-days-pilot-resources'
  scope: pilotResourceGroup
  params: {
    location: location
    existingPlanResourceId: existingPlan.id
    hostingTenantId: subscription().tenantId
    sqlAdministratorObjectId: sqlAdministratorObjectId
    sqlAdministratorDisplayName: sqlAdministratorDisplayName
    sqlAdministratorPrincipalType: sqlAdministratorPrincipalType
    webAppAlreadyExists: webAppAlreadyExists
    sqlServerAlreadyExists: sqlServerAlreadyExists
    tags: managedTags
  }
}

output apiUrl string = pilot.outputs.apiUrl
output webAppName string = pilot.outputs.webAppName
output webAppResourceId string = pilot.outputs.webAppResourceId
output managedIdentityObjectId string = pilot.outputs.managedIdentityObjectId
output sqlServerName string = pilot.outputs.sqlServerName
output sqlServerFqdn string = pilot.outputs.sqlServerFqdn
output databaseName string = pilot.outputs.databaseName
output resourceGroupName string = pilotResourceGroup.name
output existingPlanResourceId string = existingPlan.id

@description('Contains no password or client secret. SQL contained-user bootstrap and grants are still required before this identity can connect.')
output managedIdentitySqlConnectionString string = pilot.outputs.managedIdentitySqlConnectionString
