targetScope = 'subscription'

@description('Name of the resource group')
param resourceGroupName string = 'SSLTracker-RG'

@description('Azure region for all resources')
param location string = 'centralindia'

@description('Name of the web app')
param appName string = 'ssltracker'

@description('Name of the SQL Server')
param sqlServerName string = 'ssltracker'

@description('Name of the SQL Database')
param sqlDatabaseName string = 'ssl-tracker-db'

@description('SQL admin username')
param sqlAdminLogin string

@secure()
@description('SQL admin password')
param sqlAdminPassword string

resource rg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: resourceGroupName
  location: location
}

module appService 'modules/appservice.bicep' = {
  name: 'appservice-deployment'
  scope: rg
  params: {
    location: location
    appName: appName
  }
}

module sql 'modules/sql.bicep' = {
  name: 'sql-deployment'
  scope: rg
  params: {
    location: location
    sqlServerName: sqlServerName
    sqlDatabaseName: sqlDatabaseName
    sqlAdminLogin: sqlAdminLogin
    sqlAdminPassword: sqlAdminPassword
  }
}

output webAppUrl string = appService.outputs.webAppUrl
output webAppName string = appService.outputs.webAppName
output sqlServerFqdn string = sql.outputs.sqlServerFqdn
output sqlDatabaseName string = sql.outputs.sqlDatabaseName
