targetScope = 'resourceGroup'

param sqlServerName string

@description('Exact possible outbound IPv4 addresses reported by the newly created Web App; never operator, GitHub runner or all-Azure addresses.')
@minLength(1)
param outboundIpAddresses string[]

resource sqlServer 'Microsoft.Sql/servers@2023-08-01' existing = {
  name: sqlServerName
}

// Fail closed for wildcard, network, empty and special all-Azure values. The SQL
// resource provider also validates IPv4 syntax. Both endpoints must be identical.
var exactAddresses = filter(outboundIpAddresses, ip => !empty(ip) && ip != '0.0.0.0' && !contains(ip, '*') && !contains(ip, '/') && !contains(ip, ':'))

resource outboundRules 'Microsoft.Sql/servers/firewallRules@2023-08-01' = [for ip in union(exactAddresses, exactAddresses): {
  parent: sqlServer
  name: 'app-${replace(ip, '.', '-')}'
  properties: {
    startIpAddress: ip
    endIpAddress: ip
  }
}]
