import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IHttpRequestOptions,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { httpVerbFields, httpVerbOperations } from './HttpVerbDescription';
import { modelFields, modelOperations } from './LoadModelDescription';

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
						name: 'HTTP Verb',
						value: 'httpVerb',
					},
				],
				default: 'model',
			},

			...modelOperations,
			...modelFields,
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
				try {
					const modelUrl = this.getNodeParameter('modelUrl', itemIndex) as string;

					// Parse the URL to extract components
					const urlMatch = modelUrl.match(
						/^(https?:\/\/[^\/]+)\/projects\/([^\/]+)\/models\/([^\/,@]+)$/,
					);

					if (!urlMatch) {
						throw new NodeOperationError(
							this.getNode(),
							'Invalid Speckle model URL. Expected format: https://app.speckle.systems/projects/{projectId}/models/{modelId}',
							{ itemIndex },
						);
					}

					const [, baseUrl, projectId, modelId] = urlMatch;

					// Get credentials
					const credentials = await this.getCredentials('speckleApi');
					const token = credentials.token as string;
					let domain = (credentials.domain as string) || baseUrl;

					// Remove trailing slash from domain if present
					domain = domain.replace(/\/$/, '');

					// Step 1: GraphQL query to get model info and rootObjectId
					const graphqlQuery = {
						query: `
							query ($projectId: String!, $modelId: String!) {
								project(id: $projectId) {
									model(id: $modelId) {
										id
										name
										versions(limit: 1) {
											items {
												id
												referencedObject
												sourceApplication
											}
										}
									}
								}
							}
						`,
						variables: {
							projectId,
							modelId,
						},
					};

					const graphqlUrl = `${domain}/graphql`;
					const graphqlOptions: IHttpRequestOptions = {
						method: 'POST',
						url: graphqlUrl,
						headers: {
							'Content-Type': 'application/json',
							Authorization: `Bearer ${token}`,
						},
						body: graphqlQuery,
						json: true,
					};

					let graphqlResponse;
					try {
						graphqlResponse = await this.helpers.httpRequest(graphqlOptions);
					} catch (error) {
						throw new NodeOperationError(
							this.getNode(),
							`GraphQL request failed: ${error.message}. URL attempted: ${graphqlUrl}`,
							{ itemIndex },
						);
					}

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

					// Step 2a: Download root object to get __closure
					const rootObjectOptions: IHttpRequestOptions = {
						method: 'GET',
						url: `${domain}/objects/${projectId}/${rootObjectId}/single`,
						headers: {
							Accept: 'text/plain',
							Authorization: `Bearer ${token}`,
						},
						json: true,
					};

					const rootObject = await this.helpers.httpRequest(rootObjectOptions);

					// Step 2b: Extract all child object IDs from __closure
					const childIds = Object.keys((rootObject as any).__closure || {});

					// Attributes to remove from objects
					const attributesToRemove = ['vertices', 'faces', 'colors', '__closure', 'encodedValue', 'displayValue','renderMaterialProxies', 'instanceDefinitionProxies', 'transform']

					// If no children, return just the filtered root object
					if (childIds.length === 0) {
						const cleanedRoot = { ...(rootObject as any) };
						attributesToRemove.forEach((attr) => {
							delete cleanedRoot[attr];
						});

						returnData.push({
							json: [cleanedRoot] as any,
							pairedItem: itemIndex,
						});
						continue;
					}

					// Step 2c: Download all children with attribute masking
					const childrenOptions: IHttpRequestOptions = {
						method: 'POST',
						url: `${domain}/api/v2/projects/${projectId}/object-stream/`,
						headers: {
							Accept: 'text/plain',
							'Content-Type': 'application/json',
							Authorization: `Bearer ${token}`,
						},
						body: {
							objectIds: childIds,
							attributeMask: {
								exclude: attributesToRemove,
							},
						},
						json: false,
					};

					const childrenResponse = await this.helpers.httpRequest(childrenOptions);

					// Parse NDJSON response (format: objectId\tJSON\n per line)
					const childrenArray = (childrenResponse as string)
						.split('\n')
						.filter((line: string) => line.trim())
						.map((line: string) => {
							const [, jsonString] = line.split('\t');
							return JSON.parse(jsonString);
						});

					// Step 2d: Filter root object attributes (client-side)
					const cleanedRoot = { ...(rootObject as any) };
					attributesToRemove.forEach((attr) => {
						delete cleanedRoot[attr];
					});

					// Step 2e: Combine root + children
					const allObjects = [cleanedRoot, ...childrenArray];

					// Return combined array
					returnData.push({
						json: allObjects as any,
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
					const fieldsToRemove = ['__closure', 'totalChildrenCount', 'renderMaterialProxies'];
					const cleanedObjects = inputData.map((obj: any) => {
						const cleaned = { ...obj };
						fieldsToRemove.forEach((field) => {
							if (field in cleaned) {
								delete cleaned[field];
							}
						});
						return cleaned;
					});

					// Helper: Check if object should be excluded
					const shouldExcludeObject = (obj: any): boolean => {
						const speckleType = obj.speckle_type || '';
						return (
							speckleType === 'Speckle.Core.Models.DataChunk' ||
							speckleType.includes('Objects.Other.RawEncoding')
						);
					};

					// Step 2: Detect if model has DataObjects
					const hasDataObjects = cleanedObjects.some((obj: any) => {
						const speckleType = obj.speckle_type || '';
						return speckleType.includes('DataObject') && !shouldExcludeObject(obj);
					});

					// Step 3: Filter objects based on detection
					let filteredObjects;
					if (hasDataObjects) {
						// Include ONLY DataObjects (and exclude DataChunk/RawEncoding)
						filteredObjects = cleanedObjects.filter((obj: any) => {
							const speckleType = obj.speckle_type || '';
							return speckleType.includes('DataObject') && !shouldExcludeObject(obj);
						});
					} else {
						// Include ALL objects except excluded types
						filteredObjects = cleanedObjects.filter((obj: any) => !shouldExcludeObject(obj));
					}

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

		// For other resources (like HTTP Verb), return empty to use declarative routing
		throw new NodeOperationError(
			this.getNode(),
			`The operation "${operation}" is not supported for resource "${resource}"`,
		);
	}
}
