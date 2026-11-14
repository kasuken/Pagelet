// Pagelet private media storage (I01, minimal). One StorageV2 account, private container, TLS 1.2, CORS limited to the app origin.
// Does not create Static Web Apps, PostgreSQL or email resources; see README.md. Not deployed by this change.
@description('Azure region for the storage account.')
param location string = resourceGroup().location

@description('Globally unique storage account name: 3-24 lowercase letters and digits.')
@minLength(3)
@maxLength(24)
param storageAccountName string

@description('Private container for uploads and published files. Never public.')
@minLength(3)
@maxLength(63)
param containerName string = 'private-media'

@description('The single browser origin allowed to call the storage account (the SWA site), for example https://shop.example.com.')
param appOrigin string

@description('Environment label used for tags and retention decisions.')
@allowed([
  'test'
  'production'
])
param environment string = 'test'

@description('Days a deleted blob remains recoverable (soft delete).')
@minValue(1)
@maxValue(365)
param softDeleteDays int = 7

var tags = {
  application: 'pagelet'
  environment: environment
  managedBy: 'bicep'
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageAccountName
  location: location
  tags: tags
  kind: 'StorageV2'
  sku: {
    name: 'Standard_LRS'
  }
  properties: {
    // Account-key SAS (the API signs blob-scoped SAS with an app-setting key) requires shared key access.
    allowSharedKeyAccess: true
    allowBlobPublicAccess: false
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    publicNetworkAccess: 'Enabled'
    networkAcls: {
      defaultAction: 'Allow'
      bypass: 'AzureServices'
    }
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {
    cors: {
      corsRules: [
        {
          allowedOrigins: [
            appOrigin
          ]
          allowedMethods: [
            'GET'
            'HEAD'
            'PUT'
          ]
          allowedHeaders: [
            'content-type'
            'x-ms-blob-type'
            'x-ms-blob-content-type'
            'x-ms-version'
            'range'
          ]
          exposedHeaders: [
            'accept-ranges'
            'content-length'
            'content-range'
            'content-type'
            'etag'
          ]
          maxAgeInSeconds: 600
        }
      ]
    }
    deleteRetentionPolicy: {
      enabled: true
      days: softDeleteDays
    }
    isVersioningEnabled: false
  }
}

resource container 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: containerName
  properties: {
    publicAccess: 'None'
  }
}

output storageAccountId string = storage.id
output storageAccountName string = storage.name
output blobEndpoint string = storage.properties.primaryEndpoints.blob
output containerName string = container.name
