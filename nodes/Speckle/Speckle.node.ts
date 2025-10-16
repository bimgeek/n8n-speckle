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

					// Step 2: REST API call to get objects
					const objectsOptions: IHttpRequestOptions = {
						method: 'GET',
						url: `${domain}/objects/${projectId}/${rootObjectId}`,
						headers: {
							Accept: 'application/json',
							Authorization: `Bearer ${token}`,
						},
						json: true,
					};

					const objectsResponse = await this.helpers.httpRequest(objectsOptions);

					// Return the raw objects array
					returnData.push({
						json: objectsResponse,
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

		// For other resources (like HTTP Verb), return empty to use declarative routing
		throw new NodeOperationError(
			this.getNode(),
			`The operation "${operation}" is not supported for resource "${resource}"`,
		);
	}
}
