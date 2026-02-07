import type { IExecuteFunctions, INodeExecutionData, IHttpRequestOptions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { executeGraphQLQuery, QUERIES } from '../utils/graphql';
import { extractProjectId } from '../utils/urlParsing';
import {
	mapIngestionStatusToLegacyCode,
	extractVersionIdFromIngestionStatus,
	extractErrorMessageFromIngestionStatus,
	extractProgressFromIngestionStatus,
} from '../utils/ingestionStatus';

/**
 * Handles the Upload File operation
 * Multi-step file upload to Speckle with S3 and polling
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
			const initialStatusData = startIngestionData?.statusData;

			if (!ingestionId) {
				throw new NodeOperationError(
					context.getNode(),
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
						context,
						domain,
						token,
						checkStatusQuery,
						'check ingestion status',
						itemIndex,
					);
				} catch (error) {
					// Continue polling on network/GraphQL errors
					context.logger.warn(`Poll attempt ${pollAttempt} failed: ${error.message}`);
					continue;
				}

				const ingestionData = statusResponse.data?.project?.ingestion;

				// Handle case where ingestion is null (error or unavailable)
				if (!ingestionData) {
					if (pollAttempt >= 5) {
						importComplete = true;
						importSuccess = false;
						importError =
							'Ingestion status unavailable (null response). Check Speckle project manually to verify import status.';
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
