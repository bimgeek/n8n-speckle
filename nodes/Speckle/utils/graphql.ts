import type { IExecuteFunctions, IHttpRequestOptions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

/**
 * Execute a GraphQL query with standardized error handling
 */
export const executeGraphQLQuery = async (
	context: IExecuteFunctions,
	domain: string,
	token: string,
	query: { query: string; variables: any },
	operationName: string,
	itemIndex: number,
): Promise<any> => {
	const graphqlUrl = `${domain}/graphql`;
	const options: IHttpRequestOptions = {
		method: 'POST',
		url: graphqlUrl,
		headers: {
			'Content-Type': 'application/json',
			Authorization: token,
		},
		body: query,
		json: true,
	};

	let response;
	try {
		response = await context.helpers.httpRequest(options);
	} catch (error) {
		throw new NodeOperationError(
			context.getNode(),
			`GraphQL request failed for ${operationName}: ${error.message}`,
			{ itemIndex },
		);
	}

	if (response.errors && response.errors.length > 0) {
		const errorMessages = response.errors
			.map((e: { message: string }) => e.message)
			.join('; ');
		throw new NodeOperationError(
			context.getNode(),
			`GraphQL error in ${operationName}: ${errorMessages}`,
			{ itemIndex },
		);
	}

	return response;
};

/**
 * GraphQL query templates
 */
export const QUERIES = {
	modelMetadata: (projectId: string, modelId: string) => ({
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
		variables: { projectId, modelId },
	}),

	findModelByName: (projectId: string, modelName: string) => ({
		query: `
			query FindModelByName($projectId: String!, $filter: ProjectModelsFilter) {
				project(id: $projectId) {
					models(filter: $filter, limit: 100) {
						items {
							id
							name
						}
					}
				}
			}
		`,
		variables: {
			projectId,
			filter: { search: modelName },
		},
	}),

	createModel: (projectId: string, modelName: string) => ({
		query: `
			mutation CreateModel($input: CreateModelInput!) {
				modelMutations {
					create(input: $input) {
						id
					}
				}
			}
		`,
		variables: {
			input: {
				projectId,
				name: modelName,
			},
		},
	}),

	generateUploadUrl: (projectId: string, fileName: string) => ({
		query: `
			mutation GenerateFileUploadUrl($input: GenerateFileUploadUrlInput!) {
				fileUploadMutations {
					generateUploadUrl(input: $input) {
						url
						fileId
					}
				}
			}
		`,
		variables: {
			input: {
				projectId,
				fileName,
			},
		},
	}),

	startIngestion: (projectId: string, modelId: string, fileId: string, etag: string) => ({
		query: `
			mutation StartFileIngestion($input: StartFileImportInput!) {
				fileUploadMutations {
					startFileIngestion(input: $input) {
						id
						projectId
						modelId
						statusData {
							__typename
							... on ModelIngestionQueuedStatus {
								status
								progressMessage
							}
							... on ModelIngestionProcessingStatus {
								status
								progressMessage
								progress
							}
							... on ModelIngestionSuccessStatus {
								status
								versionId
							}
							... on ModelIngestionFailedStatus {
								status
								errorReason
								errorStacktrace
							}
							... on ModelIngestionCancelledStatus {
								status
								cancellationMessage
							}
						}
					}
				}
			}
		`,
		variables: {
			input: {
				projectId,
				modelId,
				fileId,
				etag,
			},
		},
	}),

	checkIngestionStatus: (projectId: string, ingestionId: string) => ({
		query: `
			query CheckIngestionStatus($projectId: String!, $ingestionId: String!) {
				project(id: $projectId) {
					ingestion(id: $ingestionId) {
						id
						projectId
						modelId
						statusData {
							__typename
							... on ModelIngestionQueuedStatus {
								status
								progressMessage
							}
							... on ModelIngestionProcessingStatus {
								status
								progressMessage
								progress
							}
							... on ModelIngestionSuccessStatus {
								status
								versionId
							}
							... on ModelIngestionFailedStatus {
								status
								errorReason
								errorStacktrace
							}
							... on ModelIngestionCancelledStatus {
								status
								cancellationMessage
							}
						}
					}
				}
			}
		`,
		variables: {
			projectId,
			ingestionId,
		},
	}),
};
