import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IHttpRequestOptions,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { ObjectLoader2Factory } from '@speckle/objectloader2';
import { executeGraphQLQuery, QUERIES } from './utils/graphql';
import {
	parseSpeckleModelUrl,
	parseSpeckleIssuesUrl,
	extractProjectId,
} from './utils/urlParsing';
import {
	mapIngestionStatusToLegacyCode,
	extractVersionIdFromIngestionStatus,
	extractErrorMessageFromIngestionStatus,
	extractProgressFromIngestionStatus,
} from './utils/ingestionStatus';
import { SpeckleReferenceResolver } from './utils/referenceResolver';
import { flattenRecord } from './utils/propertyFlattening';
import { SpeckleObjectFilter } from './utils/objectFiltering';
import { httpVerbFields, httpVerbOperations } from './HttpVerbDescription';
import { issuesFields, issuesOperations } from './IssuesDescription';
import { modelFields, modelOperations } from './LoadModelDescription';
import { uploadFileFields } from './UploadFileDescription';

export class Speckle implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Speckle',
		name: 'speckle',
		icon: { light: 'file:speckle.svg', dark: 'file:speckle.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Interact with Speckle API',
		defaults: {
			name: 'Speckle',
		},
		inputs: ['main'],
		outputs: ['main'],
		usableAsTool: true,
		credentials: [
			{
				name: 'speckleApi',
				required: false,
			},
		],
		requestDefaults: {
			baseURL: 'https://app.speckle.systems',
			url: '',
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
			},
		},
		/**
		 * In the properties array we have two mandatory options objects required
		 *
		 * [Resource & Operation]
		 *
		 * https://docs.n8n.io/integrations/creating-nodes/code/create-first-node/#resources-and-operations
		 *
		 * In our example, the operations are separated into their own file (HTTPVerbDescription.ts)
		 * to keep this class easy to read.
		 *
		 */
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Model',
						value: 'model',
					},
					{
						name: 'Issue',
						value: 'issues',
					},
					{
						name: 'HTTP Verb',
						value: 'httpVerb',
					},
				],
				default: 'model',
			},

			...modelOperations,
			...modelFields,
			...uploadFileFields,
			...issuesOperations,
			...issuesFields,
			...httpVerbOperations,
			...httpVerbFields,
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;

		// Handle Model resource with programmatic logic
		if (resource === 'model' && operation === 'loadModel') {
			for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
				let loader: any = null;

				try {
					const modelUrl = this.getNodeParameter('modelUrl', itemIndex) as string;

					let baseUrl: string;
					let projectId: string;
					let modelId: string;
					try {
						const parsed = parseSpeckleModelUrl(modelUrl);
						baseUrl = parsed.baseUrl;
						projectId = parsed.projectId;
						modelId = parsed.modelId!;
					} catch (error) {
						throw new NodeOperationError(this.getNode(), error.message, { itemIndex });
					}

					// Get credentials
					const credentials = await this.getCredentials('speckleApi');
					const token = credentials.token as string;
					let domain = (credentials.domain as string) || baseUrl;

					// Remove trailing slash from domain if present
					domain = domain.replace(/\/$/, '');

					// Step 1: GraphQL query to get model info and rootObjectId
					const graphqlResponse = await executeGraphQLQuery(
						this,
						domain,
						token,
						QUERIES.modelMetadata(projectId, modelId),
						'fetch model metadata',
						itemIndex,
					);

					// Extract rootObjectId from response
					const modelData = graphqlResponse.data?.project?.model;
					if (!modelData || !modelData.versions?.items?.[0]?.referencedObject) {
						throw new NodeOperationError(
							this.getNode(),
							'Failed to fetch model information. Please check the model ID and your permissions.',
							{ itemIndex },
						);
					}

					const rootObjectId = modelData.versions.items[0].referencedObject;

					// Step 2: Initialize ObjectLoader2
					loader = ObjectLoader2Factory.createFromUrl({
						serverUrl: domain,
						streamId: projectId,
						objectId: rootObjectId,
						token: token,
						attributeMask: {
							exclude: [
								'vertices',
								'faces',
								'colors',
								'__closure',
								'encodedValue',
								'displayValue',
								'renderMaterialProxies',
								'instanceDefinitionProxies',
								'transform',
							],
						},
						options: {
							useCache: false,
						},
					});

					// Step 3: Download objects using iterator
					const objects: any[] = [];
					for await (const obj of loader.getObjectIterator()) {
						objects.push(obj);
					}

					// Step 4: Resolve missing references
					const referenceResolver = new SpeckleReferenceResolver(this.logger);
					await referenceResolver.resolveMissingReferences(loader, objects);

					// Return combined array
					returnData.push({
						json: objects as any,
						pairedItem: itemIndex,
					});
				} catch (error) {
					if (this.continueOnFail()) {
						returnData.push({
							json: { error: error.message },
							pairedItem: itemIndex,
						});
					} else {
						throw error;
					}
				} finally {
					// Always cleanup loader resources
					if (loader) {
						try {
							await loader.disposeAsync();
						} catch (disposeError) {
							// Silently ignore disposal errors
						}
					}
				}
			}

			return [returnData];
		}

		// Handle Query Objects operation
		if (resource === 'model' && operation === 'queryObjects') {
			for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
				try {
					// Get input data - expecting array from Load Model
					const inputData = items[itemIndex].json;

					// Validate input is an array
					if (!Array.isArray(inputData)) {
						throw new NodeOperationError(
							this.getNode(),
							'Input must be an array of objects. Connect this to the output of Load Model operation.',
							{ itemIndex },
						);
					}

					// Step 1: Clean objects - remove unwanted fields
					const cleanedObjects = SpeckleObjectFilter.cleanObjects(inputData);

					// Step 2 & 3: Filter objects based on detection
					const filteredObjects = SpeckleObjectFilter.filterObjects(cleanedObjects);

					// Return filtered array (each object becomes a separate item)
					filteredObjects.forEach((obj: any) => {
						returnData.push({
							json: obj,
							pairedItem: itemIndex,
						});
					});
				} catch (error) {
					if (this.continueOnFail()) {
						returnData.push({
							json: { error: error.message },
							pairedItem: itemIndex,
						});
					} else {
						throw error;
					}
				}
			}

			return [returnData];
		}

		// Handle Query Properties operation
		if (resource === 'model' && operation === 'queryProperties') {
			for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
				try {
					// Get input data from previous node
					const inputData = items[itemIndex].json;

					// Validate input (should be an object, not an array)
					if (Array.isArray(inputData)) {
						throw new NodeOperationError(
							this.getNode(),
							'Query Properties expects individual objects, not arrays. Connect to Query Objects output.',
							{ itemIndex },
						);
					}

					// Flatten the properties using the algorithm
					const flattenedProperties = flattenRecord(inputData, null, null, null);

					// Return flattened object as a new item
					returnData.push({
						json: flattenedProperties,
						pairedItem: itemIndex,
					});
				} catch (error) {
					if (this.continueOnFail()) {
						returnData.push({
							json: { error: error.message },
							pairedItem: itemIndex,
						});
					} else {
						throw error;
					}
				}
			}

			return [returnData];
		}

		// Handle Upload File operation
		if (resource === 'model' && operation === 'uploadFile') {
			for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
				try {
					// Get parameters
					const projectInput = this.getNodeParameter('projectInput', itemIndex) as string;
					const modelName = this.getNodeParameter('modelName', itemIndex) as string;
					const overrideExisting = this.getNodeParameter('overrideExisting', itemIndex) as boolean;
					const binaryPropertyName = this.getNodeParameter('binaryPropertyName', itemIndex) as string;

					// Step 1: Parse projectInput to extract projectId
					const projectId = extractProjectId(projectInput);

					// Get credentials
					const credentials = await this.getCredentials('speckleApi');
					const token = credentials.token as string;
					let domain = credentials.domain as string;

					// Remove trailing slash from domain if present
					domain = domain.replace(/\/$/, '');

					// Step 2: Get binary file data
					const binaryData = items[itemIndex].binary;
					if (!binaryData || !binaryData[binaryPropertyName]) {
						throw new NodeOperationError(
							this.getNode(),
							`No binary data found in property "${binaryPropertyName}". Make sure the input contains a file.`,
							{ itemIndex },
						);
					}

					const fileBuffer = await this.helpers.getBinaryDataBuffer(itemIndex, binaryPropertyName);
					const fileName = binaryData[binaryPropertyName].fileName || 'upload.ifc';

					// Step 3: Query project.models to find model by name
					const findModelResponse = await executeGraphQLQuery(
						this,
						domain,
						token,
						QUERIES.findModelByName(projectId, modelName),
						'find model by name',
						itemIndex,
					);

					// Find exact match for model name
					const models = findModelResponse.data?.project?.models?.items || [];
					const existingModel = models.find((m: { id: string; name: string }) => m.name === modelName);

					// Step 4: Handle model existence
					let modelId: string;
					let modelCreated = false;

					if (existingModel) {
						if (overrideExisting) {
							// Use existing model
							modelId = existingModel.id;
						} else {
							// Throw error - model exists and override is false
							throw new NodeOperationError(
								this.getNode(),
								`Model '${modelName}' already exists. Set 'Override If Exists' to true to upload a new version.`,
								{ itemIndex },
							);
						}
					} else {
						// Create new model
						const createModelResponse = await executeGraphQLQuery(
							this,
							domain,
							token,
							QUERIES.createModel(projectId, modelName),
							'create model',
							itemIndex,
						);

						modelId = createModelResponse.data?.modelMutations?.create?.id;
						if (!modelId) {
							throw new NodeOperationError(
								this.getNode(),
								'Failed to create model: No model ID returned',
								{ itemIndex },
							);
						}
						modelCreated = true;
					}

					// Step 5: Generate presigned upload URL
					const generateUrlResponse = await executeGraphQLQuery(
						this,
						domain,
						token,
						QUERIES.generateUploadUrl(projectId, fileName),
						'generate upload URL',
						itemIndex,
					);

					const presignedUrl = generateUrlResponse.data?.fileUploadMutations?.generateUploadUrl?.url;
					const fileId = generateUrlResponse.data?.fileUploadMutations?.generateUploadUrl?.fileId;

					if (!presignedUrl || !fileId) {
						throw new NodeOperationError(
							this.getNode(),
							'Failed to generate upload URL: No URL or fileId returned',
							{ itemIndex },
						);
					}

					// Step 6: Upload file to S3 presigned URL
					const uploadOptions: IHttpRequestOptions = {
						method: 'PUT',
						url: presignedUrl,
						headers: {
							'Content-Type': 'application/octet-stream',
							'Content-Length': fileBuffer.length.toString(),
						},
						body: fileBuffer,
						returnFullResponse: true,
						encoding: 'arraybuffer',
						json: false,
					};

					let uploadResponse;
					try {
						uploadResponse = await this.helpers.httpRequest(uploadOptions);
					} catch (error) {
						throw new NodeOperationError(
							this.getNode(),
							`Failed to upload file to S3: ${error.message}`,
							{ itemIndex },
						);
					}

					// Validate S3 upload succeeded
					const s3StatusCode = uploadResponse.statusCode;
					if (s3StatusCode < 200 || s3StatusCode >= 300) {
						throw new NodeOperationError(
							this.getNode(),
							`S3 upload failed with status ${s3StatusCode}`,
							{ itemIndex },
						);
					}

					// Extract ETag from response headers
					const etag = uploadResponse.headers?.etag || uploadResponse.headers?.ETag;
					if (!etag) {
						throw new NodeOperationError(
							this.getNode(),
							'Failed to get ETag from S3 upload response',
							{ itemIndex },
						);
					}

					// Step 7: Start file ingestion (MODERN API)
					const startIngestionResponse = await executeGraphQLQuery(
						this,
						domain,
						token,
						QUERIES.startIngestion(projectId, modelId, fileId, etag),
						'start ingestion',
						itemIndex,
					);

					const startIngestionData = startIngestionResponse.data?.fileUploadMutations?.startFileIngestion;
					const ingestionId = startIngestionData?.id;
					const initialStatusData = startIngestionData?.statusData;

					if (!ingestionId) {
						throw new NodeOperationError(
							this.getNode(),
							'Failed to start file ingestion: No ingestion ID returned',
							{ itemIndex },
						);
					}

					// Extract initial status for backward compatibility
					const initialStatus = initialStatusData?.status || 'queued';
					const initialConvertedStatus = mapIngestionStatusToLegacyCode(initialStatus);

					// Step 8: Poll for ingestion status until complete
					const checkStatusQuery = QUERIES.checkIngestionStatus(projectId, ingestionId);

					// Poll every 3 seconds, max 60 attempts (~3 minutes)
					const MAX_POLL_ATTEMPTS = 60;
					const POLL_INTERVAL_MS = 3000;
					let pollAttempt = 0;
					let importComplete = false;
					let importSuccess = false;
					let importError = '';
					let lastPollData: object | null = null;
					let versionId: string | null = null; // Store version ID from success status

					while (pollAttempt < MAX_POLL_ATTEMPTS && !importComplete) {
						pollAttempt++;

						// Wait before polling (except first attempt)
						if (pollAttempt > 1) {
							await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
						}

						let statusResponse;
						try {
							statusResponse = await executeGraphQLQuery(
								this,
								domain,
								token,
								checkStatusQuery,
								'check ingestion status',
								itemIndex,
							);
						} catch (error) {
							// Continue polling on network/GraphQL errors
							this.logger.warn(`Poll attempt ${pollAttempt} failed: ${error.message}`);
							continue;
						}

						const ingestionData = statusResponse.data?.project?.ingestion;

						// Handle case where ingestion is null (error or unavailable)
						if (!ingestionData) {
							if (pollAttempt >= 5) {
								importComplete = true;
								importSuccess = false;
								importError = 'Ingestion status unavailable (null response). Check Speckle project manually to verify import status.';
								lastPollData = {
									pollAttempt,
									ingestionStatus: 'null - status unavailable after 5 attempts',
								};
							}
							continue;
						}

						const statusData = ingestionData.statusData;
						const status = statusData?.status || 'queued';
						const progressInfo = extractProgressFromIngestionStatus(statusData);

						lastPollData = {
							pollAttempt,
							ingestionId: ingestionData.id,
							status: status,
							statusType: statusData.__typename,
							progressMessage: progressInfo.message,
							progress: progressInfo.progress,
						};

						// Check if ingestion is complete
						if (status === 'success') {
							importComplete = true;
							importSuccess = true;
							versionId = extractVersionIdFromIngestionStatus(statusData);
						} else if (status === 'failed' || status === 'cancelled') {
							importComplete = true;
							importSuccess = false;
							importError = extractErrorMessageFromIngestionStatus(statusData);
						}
						// 'queued' or 'processing' means continue polling
					}

					// Step 9: Return result
					const debug = {
						api: 'ModelIngestion', // Indicate which API is being used
						s3StatusCode,
						etag,
						fileSize: fileBuffer.length,
						fileName,
						initialStatus: initialStatus, // String status
						initialConvertedStatus, // Numeric for backward compatibility
						pollAttempts: pollAttempt,
						lastPollData,
					};

					if (importSuccess) {
						returnData.push({
							json: {
								success: true,
								projectId,
								modelId,
								modelName,
								modelCreated,
								fileId,
								fileName,
								importId: ingestionId, // Now using ingestionId
								versionId, // NEW: Version ID from success status
								status: 'success',
								message: 'File imported successfully',
								debug,
							},
							pairedItem: itemIndex,
						});
					} else if (importComplete && !importSuccess) {
						returnData.push({
							json: {
								success: false,
								projectId,
								modelId,
								modelName,
								fileId,
								importId: ingestionId, // Updated
								status: 'error',
								error: `Import failed: ${importError}`,
								debug,
							},
							pairedItem: itemIndex,
						});
					} else {
						// Timeout - import still processing
						returnData.push({
							json: {
								success: false,
								projectId,
								modelId,
								modelName,
								fileId,
								importId: ingestionId, // Updated
								status: 'timeout',
								error: 'Import is still processing. Check Speckle for status.',
								debug,
							},
							pairedItem: itemIndex,
						});
					}
				} catch (error) {
					if (this.continueOnFail()) {
						returnData.push({
							json: {
								success: false,
								error: error.message,
							},
							pairedItem: itemIndex,
						});
					} else {
						throw error;
					}
				}
			}

			return [returnData];
		}

		// Handle Get Issues operation
		if (resource === 'issues' && operation === 'getIssues') {
			for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
				try {
					const issuesUrl = this.getNodeParameter('issuesUrl', itemIndex) as string;
					const getReplies = this.getNodeParameter('getReplies', itemIndex) as boolean;

					let baseUrl: string;
					let projectId: string;
					let modelId: string | undefined;
					let versionId: string | undefined;
					try {
						const parsed = parseSpeckleIssuesUrl(issuesUrl);
						baseUrl = parsed.baseUrl;
						projectId = parsed.projectId;
						modelId = parsed.modelId;
						versionId = parsed.versionId;
					} catch (error) {
						throw new NodeOperationError(this.getNode(), error.message, { itemIndex });
					}

					// Get credentials
					const credentials = await this.getCredentials('speckleApi');
					const token = credentials.token as string;
					let domain = (credentials.domain as string) || baseUrl;

					// Remove trailing slash from domain if present
					domain = domain.replace(/\/$/, '');

					// Build the GraphQL query - conditionally include replies
					const repliesFragment = getReplies
						? `
						replies(input: $repliesInput) {
							items {
								issueId
								id
								rawDescription
								createdAt
								author {
									user {
										name
									}
								}
							}
						}`
						: '';

					const graphqlQuery = {
						query: `
							query Project($projectId: String!, $input: ProjectIssuesInput${getReplies ? ', $repliesInput: IssueRepliesInput' : ''}) {
								project(id: $projectId) {
									issues(input: $input) {
										items {
											id
											identifier
											title
											rawDescription
											status
											priority
											assignee {
												user {
													name
												}
											}
											dueDate
											labels {
												name
											}
											createdAt
											updatedAt
											resourceIdString
											viewerState
											previewUrl
											${repliesFragment}
										}
									}
								}
							}
						`,
						variables: {
							projectId,
							input: {
								limit: 10000,
								...(versionId
									? { resourceIdString: `${modelId}@${versionId}` }
									: modelId
										? { resourceIdString: modelId }
										: {}),
							},
							...(getReplies ? { repliesInput: { limit: 10000 } } : {}),
						},
					};

					const graphqlResponse = await executeGraphQLQuery(
						this,
						domain,
						token,
						graphqlQuery,
						'fetch issues',
						itemIndex,
					);

					// Extract issues from the response
					const issues = graphqlResponse.data?.project?.issues?.items;
					if (!issues) {
						throw new NodeOperationError(
							this.getNode(),
							'Failed to fetch issues. The project may not exist or you may not have permission to access it.',
							{ itemIndex },
						);
					}

					// Transform each issue into an n8n item
					for (const issue of issues) {
						// Extract object IDs and application IDs from viewerState
						const viewerState = issue.viewerState;
						const selectedObjectIds =
							viewerState?.ui?.filters?.selectedObjectApplicationIds;
						const objectIds = selectedObjectIds ? Object.keys(selectedObjectIds) : null;
						const applicationIds = selectedObjectIds
							? Object.values(selectedObjectIds)
							: null;

						// Build the issue URL
						const issueUrl = `${domain}/projects/${projectId}/models/${issue.resourceIdString}#threadId=${issue.id}`;

						// Extract labels as array of strings
						const labels = issue.labels
							? issue.labels.map((label: { name: string }) => label.name)
							: [];

						// Build the output object with fields in specified order
						const outputItem: any = {
							id: issue.id,
							identifier: issue.identifier,
							title: issue.title,
							description: issue.rawDescription || null,
							status: issue.status || null,
							priority: issue.priority || null,
							assignee: issue.assignee?.user?.name || null,
							dueDate: issue.dueDate || null,
							labels,
							createdAt: issue.createdAt || null,
							updatedAt: issue.updatedAt || null,
							url: issueUrl,
							objectIds,
							applicationIds,
							previewUrl: issue.previewUrl || null,
						};

						// Add replies if requested
						if (getReplies && issue.replies?.items) {
							outputItem.replies = issue.replies.items.map(
								(reply: {
									id: string;
									issueId: string;
									rawDescription: string;
									createdAt: string;
									author?: { user?: { name: string } };
								}) => ({
									id: reply.id,
									issueId: reply.issueId,
									description: reply.rawDescription,
									createdAt: reply.createdAt,
									author: reply.author?.user?.name || null,
								}),
							);
						}

						returnData.push({
							json: outputItem,
							pairedItem: itemIndex,
						});
					}
				} catch (error) {
					if (this.continueOnFail()) {
						returnData.push({
							json: { error: error.message },
							pairedItem: itemIndex,
						});
					} else {
						throw error;
					}
				}
			}

			return [returnData];
		}

		// For other resources (like HTTP Verb), return empty to use declarative routing
		throw new NodeOperationError(
			this.getNode(),
			`The operation "${operation}" is not supported for resource "${resource}"`,
		);
	}
}
