targetScope = 'resourceGroup'

@description('Globally unique App Service and bot name prefix.')
@minLength(3)
@maxLength(32)
param name string
param location string = resourceGroup().location
@description('Azure Bot resource region; align with the selected OAuth origin and Microsoft regionalization requirements.')
param botLocation string = 'global'
@description('Client ID of an existing single-tenant Entra application.')
param botClientId string
param botTenantId string = tenant().tenantId
@description('Bare HTTPS origin, for example https://gitlab.company.com.')
param gitlabOrigin string
@allowed(['link', 'metadata'])
param previewMode string = 'link'
@description('Nonempty approved namespace/project prefixes required for metadata mode.')
param projectAllowlist string = ''
@allowed([
  'https://token.botframework.com'
  'https://europe.token.botframework.com'
  'https://unitedstates.token.botframework.com'
  'https://india.token.botframework.com'
])
param oauthOrigin string = 'https://token.botframework.com'
param oauthConnectionName string = 'gitlab'
@description('Existing dedicated RBAC vault in this resource group. No secret value is passed to this template.')
param vaultName string
param botSecretName string = 'bot-password'
@description('Existing delegated App Service subnet, with approved DNS and firewall/default route. This template does not create or certify its egress policy.')
@minLength(1)
param integrationSubnetResourceId string
@description('Corporate deployment/support IPv4 CIDR. SCM and diagnostics are restricted to this source.')
@minLength(1)
param deploymentSourceCidr string
@description('Existing operations action group for monitoring notifications.')
param operationsActionGroupId string
@allowed(['S1', 'P0v3', 'P1v3'])
param planSku string = 'S1'
@minValue(1)
@maxValue(10)
param instanceCount int = 2

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${name}-secrets'
  location: location
}
resource vault 'Microsoft.KeyVault/vaults@2023-07-01' existing = { name: vaultName }
resource vaultAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (previewMode == 'metadata') {
  name: guid(vault.id, identity.id, 'Key Vault Secrets User')
  scope: vault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}
resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: '${name}-plan'
  location: location
  kind: 'linux'
  sku: { name: planSku, capacity: instanceCount }
  properties: { reserved: true }
}
resource app 'Microsoft.Web/sites@2023-12-01' = {
  name: name
  location: location
  kind: 'app,linux'
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${identity.id}': {} }
  }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    publicNetworkAccess: 'Enabled'
    keyVaultReferenceIdentity: identity.id
    virtualNetworkSubnetId: integrationSubnetResourceId
    siteConfig: {
      linuxFxVersion: 'NODE|22-lts'
      appCommandLine: 'node /home/site/wwwroot/app.mjs'
      alwaysOn: true
      minTlsVersion: '1.2'
      scmMinTlsVersion: '1.2'
      ftpsState: 'Disabled'
      http20Enabled: true
      vnetRouteAllEnabled: true
      healthCheckPath: '/readyz'
      ipSecurityRestrictionsDefaultAction: 'Deny'
      ipSecurityRestrictions: [
        { name: 'Bot-Service', action: 'Allow', priority: 100, tag: 'ServiceTag', ipAddress: 'AzureBotService' }
        { name: 'Corporate-support', action: 'Allow', priority: 200, ipAddress: deploymentSourceCidr }
      ]
      scmIpSecurityRestrictionsDefaultAction: 'Deny'
      scmIpSecurityRestrictionsUseMain: false
      scmIpSecurityRestrictions: [
        { name: 'Corporate-deployment', action: 'Allow', priority: 100, ipAddress: deploymentSourceCidr }
      ]
      appSettings: concat([
        { name: 'NODE_ENV', value: 'production' }
        { name: 'WEBSITE_RUN_FROM_PACKAGE', value: '1' }
        { name: 'SCM_DO_BUILD_DURING_DEPLOYMENT', value: 'false' }
        { name: 'BOT_ID', value: botClientId }
        { name: 'BOT_TENANT_ID', value: botTenantId }
        { name: 'GITLAB_ORIGIN', value: gitlabOrigin }
        { name: 'PREVIEW_MODE', value: previewMode }
        { name: 'PROJECT_ALLOWLIST', value: projectAllowlist }
        { name: 'OAUTH_CONNECTION_NAME', value: oauthConnectionName }
        { name: 'OAUTH_ORIGIN', value: oauthOrigin }
        { name: 'WEBSITE_HEALTHCHECK_MAXPINGFAILURES', value: '2' }
      ], previewMode == 'metadata' ? [
        { name: 'BOT_PASSWORD', value: '@Microsoft.KeyVault(SecretUri=${vault.properties.vaultUri}secrets/${botSecretName}/)' }
      ] : [])
    }
  }
}
resource ftpPolicy 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2023-12-01' = {
  parent: app
  name: 'ftp'
  properties: { allow: false }
}
resource scmPolicy 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2023-12-01' = {
  parent: app
  name: 'scm'
  properties: { allow: false }
}
resource bot 'Microsoft.BotService/botServices@2022-09-15' = {
  name: '${name}-bot'
  location: botLocation
  kind: 'azurebot'
  sku: { name: 'F0' }
  properties: {
    displayName: 'GitLab Unfurl'
    endpoint: 'https://${app.properties.defaultHostName}/api/messages'
    msaAppId: botClientId
    msaAppTenantId: botTenantId
    msaAppType: 'SingleTenant'
  }
}
resource teams 'Microsoft.BotService/botServices/channels@2022-09-15' = {
  parent: bot
  name: 'MsTeamsChannel'
  location: botLocation
  properties: {
    channelName: 'MsTeamsChannel'
    properties: { isEnabled: true }
  }
}
resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${name}-logs'
  location: location
  properties: { retentionInDays: 30, sku: { name: 'PerGB2018' } }
}
resource diagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'application-operations'
  scope: app
  properties: {
    workspaceId: logs.id
    logs: [
      { category: 'AppServiceConsoleLogs', enabled: true }
      { category: 'AppServiceHTTPLogs', enabled: true }
    ]
    metrics: [{ category: 'AllMetrics', enabled: true }]
  }
}
resource errors 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: '${name}-http-errors'
  location: 'global'
  properties: {
    description: 'Investigate request correlation IDs and dependency readiness.'
    severity: 2
    enabled: true
    scopes: [app.id]
    evaluationFrequency: 'PT1M'
    windowSize: 'PT5M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [{ name: 'server-errors', metricNamespace: 'Microsoft.Web/sites', metricName: 'Http5xx', operator: 'GreaterThan', threshold: 5, timeAggregation: 'Total', criterionType: 'StaticThresholdCriterion' }]
    }
    actions: [{ actionGroupId: operationsActionGroupId }]
  }
}
resource health 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: '${name}-health'
  location: 'global'
  properties: {
    description: 'Readiness has failed; check JWKS and bot credential access.'
    severity: 1
    enabled: true
    scopes: [app.id]
    evaluationFrequency: 'PT1M'
    windowSize: 'PT5M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [{ name: 'readiness', metricNamespace: 'Microsoft.Web/sites', metricName: 'HealthCheckStatus', operator: 'LessThan', threshold: 100, timeAggregation: 'Average', criterionType: 'StaticThresholdCriterion' }]
    }
    actions: [{ actionGroupId: operationsActionGroupId }]
  }
}
output appName string = app.name
output botName string = bot.name
output messagingEndpoint string = bot.properties.endpoint
output readyEndpoint string = 'https://${app.properties.defaultHostName}/readyz'
output logWorkspaceName string = logs.name
output secretReaderPrincipalId string = identity.properties.principalId
