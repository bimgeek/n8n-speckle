import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { ObjectLoader2Factory } from '@speckle/objectloader2';
import { executeGraphQLQuery, QUERIES } from '../utils/graphql';
import { parseSpeckleModelUrl } from '../utils/urlParsing';
import { SpeckleReferenceResolver } from '../utils/referenceResolver';

/**
 * Handles the Load Model operation
 * Downloads a Speckle model with all child objects and resolves references
 */
export async function handleLoadModel(
	context: IExecuteFunctions,
	items: INodeExecutionData[],
): Promise<INodeExecutionData[]> {
	const returnData: INodeExecutionData[] = [];

	for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
		let loader: any = null;

		try {
			const modelUrl = context.getNodeParameter('modelUrl', itemIndex) as string;

			let baseUrl: string;
			let projectId: string;
			let modelId: string;
			try {
				const parsed = parseSpeckleModelUrl(modelUrl);
				baseUrl = parsed.baseUrl;
				projectId = parsed.projectId;
				modelId = parsed.modelId!;
			} catch (error) {
				throw new NodeOperationError(context.getNode(), error.message, { itemIndex });
			}

			// Get credentials
			const credentials = await context.getCredentials('speckleApi');
			const token = credentials.token as string;
			let domain = (credentials.domain as string) || baseUrl;

			// Remove trailing slash from domain if present
			domain = domain.replace(/\/$/, '');

			// Step 1: GraphQL query to get model info and rootObjectId
			const graphqlResponse = await executeGraphQLQuery(
				context,
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
					context.getNode(),
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
			const referenceResolver = new SpeckleReferenceResolver(context.logger);
			await referenceResolver.resolveMissingReferences(loader, objects);

			// Return combined array
			returnData.push({
				json: objects as any,
				pairedItem: itemIndex,
			});
		} catch (error) {
			if (context.continueOnFail()) {
				returnData.push({
					json: { error: error.message },
					pairedItem: itemIndex,
				});
			} else {
				throw error;
			}
		} finally {
			// CRITICAL: Always cleanup loader resources
			if (loader) {
				try {
					await loader.disposeAsync();
				} catch (disposeError) {
					// Silently ignore disposal errors
				}
			}
		}
	}

	return returnData;
}
