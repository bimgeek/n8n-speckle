# IFC File Upload to Speckle - TypeScript Implementation Guide

## Overview

This document provides a complete guide for implementing IFC file upload functionality to Speckle in TypeScript. It is based on the Python `specklepy` library implementation and the `app.py` Streamlit application.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Authentication](#authentication)
3. [Data Models & Types](#data-models--types)
4. [GraphQL Queries & Mutations](#graphql-queries--mutations)
5. [HTTP Endpoints & Methods](#http-endpoints--methods)
6. [Implementation Steps](#implementation-steps)
7. [Complete Workflow](#complete-workflow)
8. [Error Handling](#error-handling)
9. [Code Examples](#code-examples)

---

## Architecture Overview

The IFC upload process consists of 7 main steps:

1. **Authenticate** with Speckle using a personal access token
2. **Generate Upload URL** - Get a pre-signed S3 URL for file upload
3. **Upload File** - PUT the file to S3
4. **Search for Model** - Check if a model with the filename exists
5. **Create Model** (if needed) - Create a new model if not found
6. **Start Import Job** - Initiate the file import/conversion process
7. **Finish Import Job** - Mark the import as complete (optional/internal)

---

## Authentication

### Client Initialization

The Speckle client connects to a GraphQL endpoint with Bearer token authentication.

**Connection Details:**
- **GraphQL Endpoint:** `https://{host}/graphql`
- **REST API Base:** `https://{host}/api`
- **Default Host:** `app.speckle.systems`

**Required Headers:**
```typescript
{
  "Authorization": `Bearer ${token}`,
  "Content-Type": "application/json",
  "apollographql-client-name": "your-app-name",     // Optional
  "apollographql-client-version": "your-app-version" // Optional
}
```

**Implementation Notes:**
- Use a GraphQL client library (e.g., `graphql-request`, `apollo-client`, or `urql`)
- Set up HTTP transport with retry logic (recommended: 3 retries)
- Certificate verification should be enabled for production

---

## Data Models & Types

### Input Types

#### `GenerateFileUploadUrlInput`
```typescript
interface GenerateFileUploadUrlInput {
  projectId: string;  // Required
  fileName: string;   // Required - original filename with extension
}
```

#### `FileUploadUrl` (Response)
```typescript
interface FileUploadUrl {
  url: string;      // Pre-signed S3 URL for upload
  fileId: string;   // File identifier for later use
}
```

#### `UploadFileResponse`
```typescript
interface UploadFileResponse {
  etag: string;  // ETag from S3 response headers (required for import)
}
```

#### `StartFileImportInput`
```typescript
interface StartFileImportInput {
  projectId: string;  // Required
  modelId: string;    // Required - target model ID
  fileId: string;     // Required - from GenerateFileUploadUrlInput response
  etag: string;       // Required - from S3 upload response
}
```

#### `FileImport` (Response)
```typescript
interface FileImport {
  id: string;                      // Job ID
  projectId: string;
  convertedVersionId: string | null; // Version ID after conversion
  userId: string;
  convertedStatus: number;         // 0=pending, 2=success, 3=error
  convertedMessage: string | null;
  modelId: string | null;
  updatedAt: string;               // ISO 8601 datetime
}
```

#### `FileImportResult`
```typescript
interface FileImportResult {
  durationSeconds: number;
  downloadDurationSeconds: number;
  parseDurationSeconds: number;
  parser: string;                  // "ifc" for IFC files
  versionId: string | null;
}
```

#### `FileImportSuccessInput`
```typescript
interface FileImportSuccessInput {
  projectId: string;
  jobId: string;                   // FileImport.id from start_file_import
  status: "success";               // Literal type
  warnings: string[];              // Array of warning messages (can be empty)
  result: FileImportResult;
}
```

#### `FileImportErrorInput`
```typescript
interface FileImportErrorInput {
  projectId: string;
  jobId: string;
  status: "error";                 // Literal type
  warnings: string[];
  result: FileImportResult;
  reason: string;                  // Error reason/message
}
```

#### `FinishFileImportInput`
```typescript
type FinishFileImportInput = FileImportSuccessInput | FileImportErrorInput;
```

### Project & Model Types

#### `ProjectModelsFilter`
```typescript
interface ProjectModelsFilter {
  contributors?: string[] | null;
  excludeIds?: string[] | null;
  ids?: string[] | null;
  onlyWithVersions?: boolean | null;
  search?: string | null;           // Search by model name
  sourceApps?: string[] | null;
}
```

#### `CreateModelInput`
```typescript
interface CreateModelInput {
  name: string;              // Required
  description?: string | null;
  projectId: string;         // Required
}
```

#### `Model`
```typescript
interface Model {
  id: string;
  name: string;
  displayName: string;
  description: string | null;
  createdAt: string;        // ISO 8601
  updatedAt: string;        // ISO 8601
  previewUrl: string | null;
  author: LimitedUser | null;
}
```

#### `LimitedUser`
```typescript
interface LimitedUser {
  avatar: string | null;
  bio: string | null;
  company: string | null;
  id: string;
  name: string;
  role: string | null;
  verified: boolean;
}
```

#### `ResourceCollection<T>`
```typescript
interface ResourceCollection<T> {
  totalCount: number;
  items: T[];
  cursor: string | null;  // For pagination
}
```

#### `ProjectWithModels`
```typescript
interface ProjectWithModels {
  id: string;
  name: string;
  description: string | null;
  visibility: string;
  allowPublicComments: boolean;
  role: string | null;
  createdAt: string;
  updatedAt: string;
  sourceApps: string[];
  workspaceId: string | null;
  models: ResourceCollection<Model>;
}
```

---

## GraphQL Queries & Mutations

### 1. Generate Upload URL

**Mutation:**
```graphql
mutation GenerateUploadUrl($input: GenerateFileUploadUrlInput!) {
  data: fileUploadMutations {
    data: generateUploadUrl(input: $input) {
      fileId
      url
    }
  }
}
```

**Variables:**
```json
{
  "input": {
    "projectId": "abc123",
    "fileName": "example.ifc"
  }
}
```

**Response Shape:**
```json
{
  "data": {
    "data": {
      "data": {
        "fileId": "file-uuid-here",
        "url": "https://s3.amazonaws.com/presigned-url..."
      }
    }
  }
}
```

**Extraction:** Access nested structure: `response.data.data.data`

---

### 2. Start File Import

**Mutation:**
```graphql
mutation StartFileImport($input: StartFileImportInput!) {
  data: fileUploadMutations {
    data: startFileImport(input: $input) {
      id
      projectId
      convertedVersionId
      userId
      convertedStatus
      convertedMessage
      modelId
      updatedAt
    }
  }
}
```

**Variables:**
```json
{
  "input": {
    "projectId": "abc123",
    "modelId": "model-id",
    "fileId": "file-uuid-from-generate-upload-url",
    "etag": "\"etag-from-s3-upload\""
  }
}
```

**Response Shape:**
```json
{
  "data": {
    "data": {
      "data": {
        "id": "job-uuid",
        "projectId": "abc123",
        "convertedVersionId": null,
        "userId": "user-id",
        "convertedStatus": 0,
        "convertedMessage": null,
        "modelId": "model-id",
        "updatedAt": "2026-01-31T12:00:00.000Z"
      }
    }
  }
}
```

**Extraction:** Access nested structure: `response.data.data.data`

---

### 3. Finish File Import (Optional/Internal)

**Mutation:**
```graphql
mutation FinishFileImport($input: FinishFileImportInput!) {
  data: fileUploadMutations {
    data: finishFileImport(input: $input)
  }
}
```

**Variables (Success):**
```json
{
  "input": {
    "projectId": "abc123",
    "jobId": "job-uuid",
    "status": "success",
    "warnings": [],
    "result": {
      "durationSeconds": 100,
      "downloadDurationSeconds": 100,
      "parseDurationSeconds": 100,
      "parser": "ifc",
      "versionId": "version-id"
    }
  }
}
```

**Variables (Error):**
```json
{
  "input": {
    "projectId": "abc123",
    "jobId": "job-uuid",
    "status": "error",
    "warnings": ["Warning message"],
    "reason": "Error description",
    "result": {
      "durationSeconds": 100,
      "downloadDurationSeconds": 100,
      "parseDurationSeconds": 100,
      "parser": "ifc",
      "versionId": null
    }
  }
}
```

**Note:** This mutation is typically called by Speckle's backend import processors. You may call it to mark jobs complete, but it's optional for basic uploads.

---

### 4. Get Project with Models

**Query:**
```graphql
query ProjectGetWithModels(
  $projectId: String!,
  $modelsLimit: Int!,
  $modelsCursor: String,
  $modelsFilter: ProjectModelsFilter
) {
  data: project(id: $projectId) {
    id
    name
    description
    visibility
    allowPublicComments
    role
    createdAt
    updatedAt
    sourceApps
    workspaceId
    models(
      limit: $modelsLimit,
      cursor: $modelsCursor,
      filter: $modelsFilter
    ) {
      items {
        id
        name
        previewUrl
        updatedAt
        displayName
        description
        createdAt
        author {
          avatar
          bio
          company
          id
          name
          role
          verified
        }
      }
      cursor
      totalCount
    }
  }
}
```

**Variables (Search by Name):**
```json
{
  "projectId": "abc123",
  "modelsLimit": 25,
  "modelsCursor": null,
  "modelsFilter": {
    "search": "example.ifc"
  }
}
```

**Response Shape:**
```json
{
  "data": {
    "data": {
      "id": "abc123",
      "name": "My Project",
      "models": {
        "items": [
          {
            "id": "model-id",
            "name": "example.ifc",
            "displayName": "example.ifc",
            ...
          }
        ],
        "cursor": null,
        "totalCount": 1
      }
    }
  }
}
```

**Extraction:** Access nested structure: `response.data.data`

---

### 5. Create Model

**Mutation:**
```graphql
mutation ModelCreate($input: CreateModelInput!) {
  data: modelMutations {
    data: create(input: $input) {
      id
      displayName
      name
      description
      createdAt
      updatedAt
      previewUrl
      author {
        avatar
        bio
        company
        id
        name
        role
        verified
      }
    }
  }
}
```

**Variables:**
```json
{
  "input": {
    "name": "example.ifc",
    "description": null,
    "projectId": "abc123"
  }
}
```

**Response Shape:**
```json
{
  "data": {
    "data": {
      "data": {
        "id": "new-model-id",
        "name": "example.ifc",
        "displayName": "example.ifc",
        ...
      }
    }
  }
}
```

**Extraction:** Access nested structure: `response.data.data.data`

---

## HTTP Endpoints & Methods

### 1. GraphQL Endpoint (All Queries/Mutations)

**URL:** `https://{host}/graphql`  
**Method:** `POST`  
**Headers:**
```typescript
{
  "Authorization": `Bearer ${token}`,
  "Content-Type": "application/json"
}
```

**Body:**
```json
{
  "query": "mutation GenerateUploadUrl($input: ...) { ... }",
  "variables": { "input": { ... } }
}
```

---

### 2. S3 File Upload

**URL:** Pre-signed URL from `GenerateUploadUrl` response  
**Method:** `PUT`  
**Headers:**
```typescript
{
  "Content-Type": "application/octet-stream",
  "Content-Length": `${fileSize}`  // File size in bytes
}
```

**Body:** Raw file binary (stream or buffer)

**Important:**
- The S3 response includes an `ETag` header which **must** be extracted
- ETag is typically in format: `"abc123def456..."` (with quotes)
- Store the ETag as-is for the `StartFileImport` mutation

**Example with fetch:**
```typescript
const response = await fetch(presignedUrl, {
  method: 'PUT',
  headers: {
    'Content-Type': 'application/octet-stream',
    'Content-Length': fileSize.toString()
  },
  body: fileBuffer // or ReadableStream
});

const etag = response.headers.get('ETag');
if (!etag) {
  throw new Error('Upload failed: No ETag in response');
}
```

---

## Implementation Steps

### Step 1: Setup GraphQL Client

```typescript
import { GraphQLClient } from 'graphql-request';

const client = new GraphQLClient('https://app.speckle.systems/graphql', {
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  // Optional: Add retry logic
  fetch: (url, options) => {
    return retryFetch(url, options, { retries: 3 });
  }
});
```

### Step 2: Generate Upload URL

```typescript
const generateUploadUrlMutation = `
  mutation GenerateUploadUrl($input: GenerateFileUploadUrlInput!) {
    data: fileUploadMutations {
      data: generateUploadUrl(input: $input) {
        fileId
        url
      }
    }
  }
`;

const uploadUrlResponse = await client.request(generateUploadUrlMutation, {
  input: {
    projectId: 'abc123',
    fileName: 'example.ifc'
  }
});

const { fileId, url } = uploadUrlResponse.data.data;
```

### Step 3: Upload File to S3

```typescript
import fs from 'fs';
import path from 'path';

const filePath = '/path/to/example.ifc';
const fileBuffer = fs.readFileSync(filePath);
const fileSize = fs.statSync(filePath).size;

const uploadResponse = await fetch(url, {
  method: 'PUT',
  headers: {
    'Content-Type': 'application/octet-stream',
    'Content-Length': fileSize.toString()
  },
  body: fileBuffer
});

if (!uploadResponse.ok) {
  throw new Error(`Upload failed: ${uploadResponse.statusText}`);
}

const etag = uploadResponse.headers.get('ETag');
if (!etag) {
  throw new Error('No ETag in upload response');
}
```

### Step 4: Search for Existing Model

```typescript
const getProjectWithModelsQuery = `
  query ProjectGetWithModels(
    $projectId: String!,
    $modelsLimit: Int!,
    $modelsCursor: String,
    $modelsFilter: ProjectModelsFilter
  ) {
    data: project(id: $projectId) {
      models(
        limit: $modelsLimit,
        cursor: $modelsCursor,
        filter: $modelsFilter
      ) {
        items {
          id
          name
        }
        totalCount
      }
    }
  }
`;

const projectResponse = await client.request(getProjectWithModelsQuery, {
  projectId: 'abc123',
  modelsLimit: 25,
  modelsCursor: null,
  modelsFilter: {
    search: 'example.ifc'
  }
});

const models = projectResponse.data.models.items;
```

### Step 5: Create Model (if not found)

```typescript
let modelId: string;

if (models.length > 0) {
  modelId = models[0].id;
} else {
  const createModelMutation = `
    mutation ModelCreate($input: CreateModelInput!) {
      data: modelMutations {
        data: create(input: $input) {
          id
        }
      }
    }
  `;

  const createResponse = await client.request(createModelMutation, {
    input: {
      name: 'example.ifc',
      description: null,
      projectId: 'abc123'
    }
  });

  modelId = createResponse.data.data.id;
}
```

### Step 6: Start File Import

```typescript
const startFileImportMutation = `
  mutation StartFileImport($input: StartFileImportInput!) {
    data: fileUploadMutations {
      data: startFileImport(input: $input) {
        id
        convertedVersionId
        convertedStatus
      }
    }
  }
`;

const importResponse = await client.request(startFileImportMutation, {
  input: {
    projectId: 'abc123',
    modelId: modelId,
    fileId: fileId,
    etag: etag
  }
});

const fileImport = importResponse.data.data;
console.log(`Import job started: ${fileImport.id}`);
```

### Step 7: Finish Import (Optional)

```typescript
const finishFileImportMutation = `
  mutation FinishFileImport($input: FinishFileImportInput!) {
    data: fileUploadMutations {
      data: finishFileImport(input: $input)
    }
  }
`;

try {
  await client.request(finishFileImportMutation, {
    input: {
      projectId: 'abc123',
      jobId: fileImport.id,
      status: 'success',
      warnings: [],
      result: {
        durationSeconds: 100,
        downloadDurationSeconds: 100,
        parseDurationSeconds: 100,
        parser: 'ifc',
        versionId: fileImport.convertedVersionId
      }
    }
  });
} catch (error) {
  console.error('Failed to finish import:', error);
}
```

---

## Complete Workflow

Here's the complete flow for uploading a single IFC file:

```typescript
async function uploadIfcToSpeckle(
  ifcPath: string,
  projectId: string,
  token: string
): Promise<{ status: string; file: string }> {
  // 1. Initialize GraphQL client
  const client = new GraphQLClient('https://app.speckle.systems/graphql', {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    }
  });

  // 2. Get filename
  const fileName = path.basename(ifcPath);

  // 3. Generate upload URL
  const uploadUrlResponse = await client.request(
    generateUploadUrlMutation,
    { input: { projectId, fileName } }
  );
  const { fileId, url } = uploadUrlResponse.data.data;

  // 4. Upload file to S3
  const fileBuffer = fs.readFileSync(ifcPath);
  const fileSize = fs.statSync(ifcPath).size;

  const uploadResponse = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': fileSize.toString()
    },
    body: fileBuffer
  });

  const etag = uploadResponse.headers.get('ETag');
  if (!etag) {
    throw new Error('No ETag in upload response');
  }

  // 5. Search for existing model
  const projectResponse = await client.request(
    getProjectWithModelsQuery,
    {
      projectId,
      modelsLimit: 25,
      modelsCursor: null,
      modelsFilter: { search: fileName }
    }
  );

  const models = projectResponse.data.models.items;
  let modelId: string;

  // 6. Create model if not found
  if (models.length > 0) {
    modelId = models[0].id;
  } else {
    const createResponse = await client.request(
      createModelMutation,
      {
        input: {
          name: fileName,
          description: null,
          projectId
        }
      }
    );
    modelId = createResponse.data.data.id;
  }

  // 7. Start file import
  const importResponse = await client.request(
    startFileImportMutation,
    {
      input: {
        projectId,
        modelId,
        fileId,
        etag
      }
    }
  );

  // 8. (Optional) Finish import
  try {
    await client.request(
      finishFileImportMutation,
      {
        input: {
          projectId,
          jobId: importResponse.data.data.id,
          status: 'success',
          warnings: [],
          result: {
            durationSeconds: 100,
            downloadDurationSeconds: 100,
            parseDurationSeconds: 100,
            parser: 'ifc',
            versionId: importResponse.data.data.convertedVersionId
          }
        }
      }
    );
  } catch (error) {
    console.error('Failed to finish import:', error);
  }

  console.log(`Uploaded ${ifcPath} to project ${projectId}, model ${modelId}`);
  return { status: 'ok', file: fileName };
}
```

---

## Error Handling

### Common Errors

#### 1. Authentication Errors
- **Status Code:** 401 or 403
- **GraphQL Error:** `"Unauthorized"` or `"Invalid token"`
- **Solution:** Verify token is valid and has required permissions

#### 2. Project Not Found
- **GraphQL Error:** `"Project not found"`
- **Solution:** Verify project ID exists and user has access

#### 3. S3 Upload Failures
- **No ETag:** Upload succeeded but ETag header missing
- **Network Error:** Connection issues with S3
- **Solution:** Retry upload with exponential backoff

#### 4. Model Creation Failures
- **GraphQL Error:** `"Model with this name already exists"`
- **Solution:** Search more precisely or use different name

#### 5. Import Job Failures
- **Status:** `convertedStatus: 3` (error)
- **Message:** Check `convertedMessage` field
- **Solution:** Verify file is valid IFC format

### Error Handling Pattern

```typescript
async function uploadWithRetry(
  ifcPath: string,
  projectId: string,
  token: string,
  maxRetries: number = 3
): Promise<{ status: string; file: string; error?: string }> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await uploadIfcToSpeckle(ifcPath, projectId, token);
    } catch (error) {
      console.error(`Attempt ${attempt} failed:`, error);
      
      if (attempt === maxRetries) {
        return {
          status: 'error',
          file: path.basename(ifcPath),
          error: error.message
        };
      }
      
      // Exponential backoff
      await new Promise(resolve => 
        setTimeout(resolve, Math.pow(2, attempt) * 1000)
      );
    }
  }
}
```

---

## Code Examples

### Example 1: Basic Single File Upload

```typescript
import { GraphQLClient } from 'graphql-request';
import fs from 'fs';
import path from 'path';

const token = 'your-speckle-token';
const projectId = 'your-project-id';
const ifcPath = '/path/to/file.ifc';

async function main() {
  try {
    const result = await uploadIfcToSpeckle(ifcPath, projectId, token);
    console.log('Upload successful:', result);
  } catch (error) {
    console.error('Upload failed:', error);
  }
}

main();
```

### Example 2: Bulk Upload with Progress

```typescript
import glob from 'glob';

async function bulkUploadIfc(
  folderPath: string,
  projectId: string,
  token: string
): Promise<Array<{ file: string; status: string; error?: string }>> {
  // Find all IFC files
  const ifcFiles = glob.sync(path.join(folderPath, '**/*.ifc'), {
    recursive: true
  });

  console.log(`Found ${ifcFiles.length} IFC files`);

  const results = [];

  for (let i = 0; i < ifcFiles.length; i++) {
    const ifcPath = ifcFiles[i];
    console.log(`[${i + 1}/${ifcFiles.length}] Uploading: ${ifcPath}`);

    try {
      const result = await uploadIfcToSpeckle(ifcPath, projectId, token);
      results.push(result);
      console.log(`✅ Success: ${ifcPath}`);
    } catch (error) {
      console.error(`❌ Failed: ${ifcPath}`, error.message);
      results.push({
        status: 'error',
        file: path.basename(ifcPath),
        error: error.message
      });
    }
  }

  return results;
}

// Usage
const results = await bulkUploadIfc(
  '/path/to/ifc/folder',
  'your-project-id',
  'your-token'
);

console.log('\n=== Upload Summary ===');
const successful = results.filter(r => r.status === 'ok').length;
const failed = results.filter(r => r.status === 'error').length;
console.log(`Successful: ${successful}`);
console.log(`Failed: ${failed}`);
```

### Example 3: Using Node.js Streams (Memory Efficient)

```typescript
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';

async function uploadFileWithStream(
  presignedUrl: string,
  filePath: string
): Promise<string> {
  const fileStats = await stat(filePath);
  const fileSize = fileStats.size;
  const fileStream = createReadStream(filePath);

  const response = await fetch(presignedUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': fileSize.toString()
    },
    body: fileStream,
    duplex: 'half' // Required for streams in fetch
  });

  if (!response.ok) {
    throw new Error(`Upload failed: ${response.statusText}`);
  }

  const etag = response.headers.get('ETag');
  if (!etag) {
    throw new Error('No ETag in response');
  }

  return etag;
}
```

### Example 4: Complete TypeScript Class

```typescript
import { GraphQLClient } from 'graphql-request';
import fs from 'fs';
import path from 'path';

export class SpeckleIfcUploader {
  private client: GraphQLClient;
  private projectId: string;

  constructor(host: string, token: string, projectId: string) {
    this.client = new GraphQLClient(`https://${host}/graphql`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      }
    });
    this.projectId = projectId;
  }

  async generateUploadUrl(fileName: string): Promise<FileUploadUrl> {
    const mutation = `
      mutation GenerateUploadUrl($input: GenerateFileUploadUrlInput!) {
        data: fileUploadMutations {
          data: generateUploadUrl(input: $input) {
            fileId
            url
          }
        }
      }
    `;

    const response = await this.client.request(mutation, {
      input: { projectId: this.projectId, fileName }
    });

    return response.data.data;
  }

  async uploadFile(presignedUrl: string, filePath: string): Promise<string> {
    const fileBuffer = fs.readFileSync(filePath);
    const fileSize = fs.statSync(filePath).size;

    const response = await fetch(presignedUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': fileSize.toString()
      },
      body: fileBuffer
    });

    if (!response.ok) {
      throw new Error(`Upload failed: ${response.statusText}`);
    }

    const etag = response.headers.get('ETag');
    if (!etag) {
      throw new Error('No ETag in response');
    }

    return etag;
  }

  async findOrCreateModel(modelName: string): Promise<string> {
    // Search for model
    const searchQuery = `
      query ProjectGetWithModels(
        $projectId: String!,
        $modelsLimit: Int!,
        $modelsFilter: ProjectModelsFilter
      ) {
        data: project(id: $projectId) {
          models(limit: $modelsLimit, filter: $modelsFilter) {
            items { id name }
            totalCount
          }
        }
      }
    `;

    const searchResponse = await this.client.request(searchQuery, {
      projectId: this.projectId,
      modelsLimit: 25,
      modelsFilter: { search: modelName }
    });

    const models = searchResponse.data.models.items;

    if (models.length > 0) {
      return models[0].id;
    }

    // Create model
    const createMutation = `
      mutation ModelCreate($input: CreateModelInput!) {
        data: modelMutations {
          data: create(input: $input) {
            id
          }
        }
      }
    `;

    const createResponse = await this.client.request(createMutation, {
      input: {
        name: modelName,
        description: null,
        projectId: this.projectId
      }
    });

    return createResponse.data.data.id;
  }

  async startFileImport(
    modelId: string,
    fileId: string,
    etag: string
  ): Promise<FileImport> {
    const mutation = `
      mutation StartFileImport($input: StartFileImportInput!) {
        data: fileUploadMutations {
          data: startFileImport(input: $input) {
            id
            convertedVersionId
            convertedStatus
          }
        }
      }
    `;

    const response = await this.client.request(mutation, {
      input: {
        projectId: this.projectId,
        modelId,
        fileId,
        etag
      }
    });

    return response.data.data;
  }

  async uploadIfc(ifcPath: string): Promise<{ status: string; file: string }> {
    const fileName = path.basename(ifcPath);

    // 1. Generate upload URL
    const { fileId, url } = await this.generateUploadUrl(fileName);

    // 2. Upload file
    const etag = await this.uploadFile(url, ifcPath);

    // 3. Find or create model
    const modelId = await this.findOrCreateModel(fileName);

    // 4. Start import
    await this.startFileImport(modelId, fileId, etag);

    return { status: 'ok', file: fileName };
  }
}

// Usage
const uploader = new SpeckleIfcUploader(
  'app.speckle.systems',
  'your-token',
  'your-project-id'
);

await uploader.uploadIfc('/path/to/file.ifc');
```

---

## Additional Notes

### Field Name Conventions

Speckle's GraphQL API uses **camelCase** for field names:
- `projectId` (not `project_id`)
- `fileName` (not `file_name`)
- `convertedVersionId` (not `converted_version_id`)

When working with TypeScript, use camelCase for all GraphQL inputs and outputs.

### Response Nesting

Many Speckle GraphQL responses have nested `data` fields:
```json
{
  "data": {
    "data": {
      "data": { ... }  // Actual data here
    }
  }
}
```

Always check the response structure and extract the correct nested level.

### ETag Format

The S3 ETag typically includes quotes: `"abc123def456..."`. Store and use it as-is (with quotes).

### Import Job Status Codes

- `0` = Pending
- `2` = Success  
- `3` = Error

Check `convertedStatus` to determine job state.

### Model Name Matching

When searching for models by filename, use exact filename match in the `search` filter. The search is case-insensitive and performs substring matching.

### Pagination

For projects with many models, use `modelsLimit` and `modelsCursor` to paginate through results. Default limit is 25 models per request.

---

## Dependencies

Recommended npm packages:

```json
{
  "dependencies": {
    "graphql": "^16.8.1",
    "graphql-request": "^6.1.0",
    "node-fetch": "^3.3.2"
  },
  "devDependencies": {
    "@types/node": "^20.11.0",
    "typescript": "^5.3.3"
  }
}
```

Alternative GraphQL clients:
- `@apollo/client` - Full-featured client with caching
- `urql` - Lightweight, extensible client
- Native `fetch` with manual GraphQL query construction

---

## Testing

### Test with a Single File

```typescript
import { SpeckleIfcUploader } from './uploader';

async function testUpload() {
  const uploader = new SpeckleIfcUploader(
    'app.speckle.systems',
    process.env.SPECKLE_TOKEN!,
    process.env.SPECKLE_PROJECT_ID!
  );

  try {
    const result = await uploader.uploadIfc('./test-files/sample.ifc');
    console.log('✅ Test passed:', result);
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

testUpload();
```

### Environment Variables

Create a `.env` file:
```env
SPECKLE_TOKEN=your-personal-access-token
SPECKLE_PROJECT_ID=your-project-id
SPECKLE_HOST=app.speckle.systems
```

---

## Summary

This guide provides everything needed to implement IFC file upload to Speckle in TypeScript:

1. ✅ Complete GraphQL queries and mutations
2. ✅ All TypeScript type definitions
3. ✅ Step-by-step implementation workflow
4. ✅ Error handling patterns
5. ✅ Working code examples
6. ✅ Class-based implementation

The core workflow is:
1. Generate pre-signed S3 URL
2. Upload file to S3
3. Find or create target model
4. Start import job with file ID and ETag

Good luck with your implementation! 🚀
