import type { IExecuteFunctions, INodeExecutionData, IHttpRequestOptions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { executeGraphQLQuery, QUERIES } from '../utils/graphql';
import { extractProjectId } from '../utils/urlParsing';

/**
 * Handles the Upload File operation
 * Multi-step file upload to Speckle with S3, returns after ingestion is started
 */
export async function handleUploadFile(
	context: IExecuteFunctions,
	items: INodeExecutionData[],
): Promise<INodeExecutionData[]> {
	const returnData: INodeExecutionData[] = [];

	for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
		try {
			// Get parameters
			const projectInput = context.getNodeParameter('projectInput', itemIndex) as string;
			const modelName = context.getNodeParameter('modelName', itemIndex) as string;
			const binaryPropertyName = context.getNodeParameter(
				'binaryPropertyName',
				itemIndex,
			) as string;

			// Step 1: Parse projectInput to extract projectId
			const projectId = extractProjectId(projectInput);

			// Get credentials
			const credentials = await context.getCredentials('speckleApi');
			const token = credentials.token as string;
			let domain = credentials.domain as string;

			// Remove trailing slash from domain if present
			domain = domain.replace(/\/$/, '');

			// Step 2: Get binary file data
			const binaryData = items[itemIndex].binary;
			if (!binaryData || !binaryData[binaryPropertyName]) {
				throw new NodeOperationError(
					context.getNode(),
					`No binary data found in property "${binaryPropertyName}". Make sure the input contains a file.`,
					{ itemIndex },
				);
			}

			const fileBuffer = await context.helpers.getBinaryDataBuffer(
				itemIndex,
				binaryPropertyName,
			);
			const fileName = binaryData[binaryPropertyName].fileName || 'upload.ifc';

			// Step 3: Query project.models to find model by name
			const findModelResponse = await executeGraphQLQuery(
				context,
				domain,
				token,
				QUERIES.findModelByName(projectId, modelName),
				'find model by name',
				itemIndex,
			);

			// Find exact match for model name (Speckle stores model names in lowercase)
			const models = findModelResponse.data?.project?.models?.items || [];
			const modelNameLower = modelName?.toLowerCase() ?? '';
			const existingModel = models.find(
				(m: { id: string; name: string }) =>
					(m.name ?? '').toLowerCase() === modelNameLower,
			);

		// Step 4: Handle model existence
		let modelId: string;
		let modelCreated = false;

		if (existingModel) {
			// Use existing model
			modelId = existingModel.id;
		} else {
			// Create new model
			const createModelResponse = await executeGraphQLQuery(
				context,
				domain,
				token,
				QUERIES.createModel(projectId, modelName),
				'create model',
				itemIndex,
			);

			modelId = createModelResponse.data?.modelMutations?.create?.id;
			if (!modelId) {
				throw new NodeOperationError(
					context.getNode(),
					'Failed to create model: No model ID returned',
					{ itemIndex },
				);
			}
			modelCreated = true;
		}

			// Step 5: Generate presigned upload URL
			const generateUrlResponse = await executeGraphQLQuery(
				context,
				domain,
				token,
				QUERIES.generateUploadUrl(projectId, fileName),
				'generate upload URL',
				itemIndex,
			);

			const presignedUrl =
				generateUrlResponse.data?.fileUploadMutations?.generateUploadUrl?.url;
			const fileId = generateUrlResponse.data?.fileUploadMutations?.generateUploadUrl?.fileId;

			if (!presignedUrl || !fileId) {
				throw new NodeOperationError(
					context.getNode(),
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
				uploadResponse = await context.helpers.httpRequest(uploadOptions);
			} catch (error) {
				throw new NodeOperationError(
					context.getNode(),
					`Failed to upload file to S3: ${error.message}`,
					{ itemIndex },
				);
			}

			// Validate S3 upload succeeded
			const s3StatusCode = uploadResponse.statusCode;
			if (s3StatusCode < 200 || s3StatusCode >= 300) {
				throw new NodeOperationError(
					context.getNode(),
					`S3 upload failed with status ${s3StatusCode}`,
					{ itemIndex },
				);
			}

			// Extract ETag from response headers
			const etag = uploadResponse.headers?.etag || uploadResponse.headers?.ETag;
			if (!etag) {
				throw new NodeOperationError(
					context.getNode(),
					'Failed to get ETag from S3 upload response',
					{ itemIndex },
				);
			}

			// Step 7: Start file ingestion (MODERN API)
			const startIngestionResponse = await executeGraphQLQuery(
				context,
				domain,
				token,
				QUERIES.startIngestion(projectId, modelId, fileId, etag),
				'start ingestion',
				itemIndex,
			);

			const startIngestionData =
				startIngestionResponse.data?.fileUploadMutations?.startFileIngestion;
			const ingestionId = startIngestionData?.id;

			if (!ingestionId) {
				throw new NodeOperationError(
					context.getNode(),
					'Failed to start file ingestion: No ingestion ID returned',
					{ itemIndex },
				);
			}

			// Step 8: Return result — processing continues in Speckle
			returnData.push({
				json: {
					success: true,
					projectId,
					modelId,
					modelName,
					modelCreated,
					fileId,
					fileName,
					ingestionId,
					status: 'ingestion_started',
					message: 'File uploaded and ingestion started. Processing continues in Speckle.',
					debug: {
						s3StatusCode,
						etag,
						fileSize: fileBuffer.length,
						fileName,
					},
				},
				pairedItem: itemIndex,
			});
		} catch (error) {
			if (context.continueOnFail()) {
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

	return returnData;
}
