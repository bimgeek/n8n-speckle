import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IHttpRequestOptions,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { ObjectLoader2Factory } from '@speckle/objectloader2';
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
						name: 'Issues',
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

		/**
		 * Extract all referencedId properties from an object recursively
		 */
		const extractReferencedIds = (obj: any, referencedIds: Set<string>): void => {
			if (!obj || typeof obj !== 'object') return;

			// Check for referencedId property
			if (obj.referencedId && typeof obj.referencedId === 'string') {
				referencedIds.add(obj.referencedId);
			}

			// Recursively check all properties
			for (const value of Object.values(obj)) {
				if (value && typeof value === 'object') {
					extractReferencedIds(value, referencedIds);
				}
			}
		};

		/**
		 * Resolve missing object references by iteratively fetching them
		 */
		const resolveMissingReferences = async (loader: any, objects: any[]): Promise<void> => {
			const MAX_ITERATIONS = 10;
			let iterationCount = 0;

			while (iterationCount < MAX_ITERATIONS) {
				iterationCount++;

				// Build set of existing object IDs
				const existingIds = new Set(objects.map((obj: any) => obj.id));

				// Find all referenced IDs
				const referencedIds = new Set<string>();
				for (const obj of objects) {
					extractReferencedIds(obj, referencedIds);
				}

				// Find missing IDs
				const missingIds = new Set<string>();
				for (const refId of referencedIds) {
					if (!existingIds.has(refId)) {
						missingIds.add(refId);
					}
				}

				// Exit if no missing references
				if (missingIds.size === 0) {
					break;
				}

				// Fetch missing objects in parallel for better performance
				const missingIdsArray = Array.from(missingIds);
				const fetchPromises = missingIdsArray.map(async (missingId) => {
					try {
						return await loader.getObject({ id: missingId });
					} catch (err: any) {
						// Log warning but continue - this is expected for some reference types
						this.logger.warn(`Failed to fetch referenced object ${missingId}: ${err.message}`);
						return null;
					}
				});

				const results = await Promise.all(fetchPromises);
				results.forEach((obj) => {
					if (obj) {
						objects.push(obj);
					}
				});
			}
		};

		/**
		 * Properties Flattening Algorithm - Helper Functions
		 */

		/**
		 * Check if a path should be excluded from flattening
		 */
		const isPathExcluded = (currentPath: string): boolean => {
			const EXCLUDED_PATHS = [
				'Composite Structure',
				'Material Quantities',
				'Parameters.Type Parameters.Structure',
			];

			for (const excludedPath of EXCLUDED_PATHS) {
				if (currentPath.includes(excludedPath)) {
					return true;
				}
			}

			return false;
		};

		/**
		 * Resolve field name conflicts by appending parent path segments
		 * Uses Set for O(1) lookup performance instead of O(n) array search
		 */
		const resolveFieldName = (
			fieldName: string,
			parentPath: string | null,
			existingFieldsSet: Set<string>,
		): string => {
			const currentParentPath = parentPath || '';

			// Try the original field name first
			const candidateName = fieldName;

			// Case 1: No conflict - return original name (O(1) Set lookup)
			if (!existingFieldsSet.has(candidateName)) {
				return candidateName;
			}

			// Case 2: Conflict exists but no parent path available - keep original
			if (currentParentPath === '') {
				return fieldName;
			}

			// Case 3: Conflict exists and parent path available - resolve with iteration
			const pathParts = currentParentPath.split('.');
			const reversedParts = pathParts.reverse();

			// Generate candidate names by appending parents one by one
			const candidates: string[] = [];

			for (let depth = 1; depth <= reversedParts.length; depth++) {
				const parentSegments = reversedParts.slice(0, depth);
				const parentSuffix = parentSegments.join('.');
				const candidate = `${fieldName}.${parentSuffix}`;
				candidates.push(candidate);
			}

			// Find the first candidate that doesn't conflict (O(1) Set lookup)
			for (const candidate of candidates) {
				if (!existingFieldsSet.has(candidate)) {
					return candidate;
				}
			}

			// If all candidates conflict, use the full path (last candidate)
			return candidates[candidates.length - 1];
		};

		/**
		 * Check if value is a record/object
		 */
		const isRecord = (value: any): boolean => {
			return value !== null && typeof value === 'object' && !Array.isArray(value);
		};

		/**
		 * Main flattening function - must be declared before the processing functions
		 * Uses Set for O(1) field name lookup performance
		 */
		const flattenRecordImpl = (
			inputRecord: any,
			filterKeys: string[] | null,
			parentPath: string | null,
			existingFields: string[] | null,
		): any => {
			// Initialize parameters with defaults
			const currentParentPath = parentPath || '';
			const currentExistingFields = existingFields || [];

			// Extract the "properties" field if it exists
			let recordToProcess = null;

			if (inputRecord === null) {
				recordToProcess = null;
			} else if (isRecord(inputRecord) && 'properties' in inputRecord) {
				// Use the properties field instead of root record
				recordToProcess = inputRecord.properties;
			} else {
				recordToProcess = inputRecord;
			}

			// Handle null input
			if (recordToProcess === null) {
				return {};
			}

			// Ensure input is a record (object)
			if (!isRecord(recordToProcess)) {
				// Wrap non-record values
				return { Value: recordToProcess };
			}

			// Process all fields in the record
			const fieldNames = Object.keys(recordToProcess);

			// Initialize state with both Set (for fast lookup) and Array (for order)
			let state = {
				FlattenedRecord: {},
				ExistingFieldsSet: new Set<string>(currentExistingFields),
				ExistingFieldsList: currentExistingFields,
			};

			// Process each field sequentially (accumulation pattern)
			for (const fieldName of fieldNames) {
				state = processField(fieldName, recordToProcess[fieldName], currentParentPath, filterKeys, state);
			}

			// Return the flattened record
			return state.FlattenedRecord;
		};

		/**
		 * Process a single field
		 */
		const processField = (
			fieldName: string,
			fieldValue: any,
			currentParentPath: string,
			filterKeys: string[] | null,
			state: { FlattenedRecord: any; ExistingFieldsSet: Set<string>; ExistingFieldsList: string[] },
		): { FlattenedRecord: any; ExistingFieldsSet: Set<string>; ExistingFieldsList: string[] } => {
			// Build the new path for this field
			const newPath = currentParentPath === '' ? fieldName : `${currentParentPath}.${fieldName}`;

			// Step 1: Check if path should be excluded
			if (isPathExcluded(newPath)) {
				return state; // Skip this field
			}

			// Step 2: Determine field type and process accordingly

			// Case A: Field is a name/value record
			if (isRecord(fieldValue) && 'name' in fieldValue && 'value' in fieldValue) {
				return processNameValueRecord(fieldValue, currentParentPath, filterKeys, state);
			}

			// Case B: Field value is null
			else if (fieldValue === null) {
				return processNullValue(fieldName, currentParentPath, filterKeys, state);
			}

			// Case C: Field value is a nested record
			else if (isRecord(fieldValue)) {
				return processNestedRecord(fieldValue, newPath, filterKeys, state);
			}

			// Case D: Field value is a primitive (string, number, boolean) or array
			else {
				return processPrimitiveValue(fieldName, fieldValue, currentParentPath, filterKeys, state);
			}
		};

		/**
		 * Process name/value record pattern
		 */
		const processNameValueRecord = (
			fieldValue: any,
			currentParentPath: string,
			filterKeys: string[] | null,
			state: { FlattenedRecord: any; ExistingFieldsSet: Set<string>; ExistingFieldsList: string[] },
		): { FlattenedRecord: any; ExistingFieldsSet: Set<string>; ExistingFieldsList: string[] } => {
			const nameField = fieldValue.name;
			const valueField = fieldValue.value;

			// Check if nameField is null
			if (nameField === null) {
				return state;
			}

			// Resolve any naming conflicts (uses Set for O(1) lookup)
			const resolvedName = resolveFieldName(nameField, currentParentPath, state.ExistingFieldsSet);

			// Add to flattened record
			const newRecord = {
				...state.FlattenedRecord,
				[resolvedName]: valueField,
			};

			// Update both Set and Array with the resolved name
			const newFieldsSet = new Set(state.ExistingFieldsSet);
			newFieldsSet.add(resolvedName);
			const newFieldsList = [...state.ExistingFieldsList, resolvedName];

			return {
				FlattenedRecord: newRecord,
				ExistingFieldsSet: newFieldsSet,
				ExistingFieldsList: newFieldsList,
			};
		};

		/**
		 * Process null value
		 */
		const processNullValue = (
			fieldName: string,
			currentParentPath: string,
			filterKeys: string[] | null,
			state: { FlattenedRecord: any; ExistingFieldsSet: Set<string>; ExistingFieldsList: string[] },
		): { FlattenedRecord: any; ExistingFieldsSet: Set<string>; ExistingFieldsList: string[] } => {
			// Resolve naming conflicts (uses Set for O(1) lookup)
			const resolvedName = resolveFieldName(fieldName, currentParentPath, state.ExistingFieldsSet);

			// Add null value to flattened record
			const newRecord = {
				...state.FlattenedRecord,
				[resolvedName]: null,
			};

			// Update both Set and Array with the resolved name
			const newFieldsSet = new Set(state.ExistingFieldsSet);
			newFieldsSet.add(resolvedName);
			const newFieldsList = [...state.ExistingFieldsList, resolvedName];

			return {
				FlattenedRecord: newRecord,
				ExistingFieldsSet: newFieldsSet,
				ExistingFieldsList: newFieldsList,
			};
		};

		/**
		 * Process nested record (recursion)
		 */
		const processNestedRecord = (
			fieldValue: any,
			newPath: string,
			filterKeys: string[] | null,
			state: { FlattenedRecord: any; ExistingFieldsSet: Set<string>; ExistingFieldsList: string[] },
		): { FlattenedRecord: any; ExistingFieldsSet: Set<string>; ExistingFieldsList: string[] } => {
			// Skip empty records
			const fieldCount = Object.keys(fieldValue).length;
			if (fieldCount === 0) {
				return state;
			}

			// Recursively flatten the nested record
			const flattened = flattenRecordImpl(fieldValue, filterKeys, newPath, state.ExistingFieldsList);

			// Get all field names from the flattened result
			const flattenedFieldNames = Object.keys(flattened);

			// Merge the flattened record with current state
			const combinedRecord = {
				...state.FlattenedRecord,
				...flattened,
			};

			// Merge Sets for O(n) deduplication instead of O(n²)
			const allFieldsSet = new Set([...state.ExistingFieldsSet, ...flattenedFieldNames]);
			const allFieldNames = Array.from(allFieldsSet);

			return {
				FlattenedRecord: combinedRecord,
				ExistingFieldsSet: allFieldsSet,
				ExistingFieldsList: allFieldNames,
			};
		};

		/**
		 * Process primitive value
		 */
		const processPrimitiveValue = (
			fieldName: string,
			fieldValue: any,
			currentParentPath: string,
			filterKeys: string[] | null,
			state: { FlattenedRecord: any; ExistingFieldsSet: Set<string>; ExistingFieldsList: string[] },
		): { FlattenedRecord: any; ExistingFieldsSet: Set<string>; ExistingFieldsList: string[] } => {
			// Resolve naming conflicts (uses Set for O(1) lookup)
			const resolvedName = resolveFieldName(fieldName, currentParentPath, state.ExistingFieldsSet);

			// Add primitive value to flattened record
			const newRecord = {
				...state.FlattenedRecord,
				[resolvedName]: fieldValue,
			};

			// Update both Set and Array with the resolved name
			const newFieldsSet = new Set(state.ExistingFieldsSet);
			newFieldsSet.add(resolvedName);
			const newFieldsList = [...state.ExistingFieldsList, resolvedName];

			return {
				FlattenedRecord: newRecord,
				ExistingFieldsSet: newFieldsSet,
				ExistingFieldsList: newFieldsList,
			};
		};

		// Handle Model resource with programmatic logic
		if (resource === 'model' && operation === 'loadModel') {
			for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
				let loader: any = null;

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
							Authorization: token,
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
					await resolveMissingReferences(loader, objects);

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
					const flattenedProperties = flattenRecordImpl(inputData, null, null, null);

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

		/**
		 * Maps new ModelIngestion status enum to legacy numeric codes
		 */
		function mapIngestionStatusToLegacyCode(status: string): number {
			switch (status) {
				case 'queued': return 0;
				case 'processing': return 1;
				case 'success': return 2;
				case 'failed': return 3;
				case 'cancelled': return 3;
				default: return 0;
			}
		}

		/**
		 * Extracts version ID from success status
		 */
		function extractVersionIdFromIngestionStatus(statusData: any): string | null {
			if (statusData.__typename === 'ModelIngestionSuccessStatus') {
				return statusData.versionId || null;
			}
			return null;
		}

		/**
		 * Extracts error message from failed/cancelled status
		 */
		function extractErrorMessageFromIngestionStatus(statusData: any): string {
			if (statusData.__typename === 'ModelIngestionFailedStatus') {
				return statusData.errorReason || 'Unknown error';
			}
			if (statusData.__typename === 'ModelIngestionCancelledStatus') {
				return `Job cancelled: ${statusData.cancellationMessage || 'No reason provided'}`;
			}
			return 'Unknown error';
		}

		/**
		 * Extracts progress information from status
		 */
		function extractProgressFromIngestionStatus(statusData: any): {
			message?: string;
			progress?: number;
		} {
			const result: { message?: string; progress?: number } = {};

			if (statusData.__typename === 'ModelIngestionQueuedStatus' ||
					statusData.__typename === 'ModelIngestionProcessingStatus') {
				if (statusData.progressMessage) {
					result.message = statusData.progressMessage;
				}
			}

			if (statusData.__typename === 'ModelIngestionProcessingStatus' &&
					statusData.progress !== undefined &&
					statusData.progress !== null) {
				result.progress = statusData.progress;
			}

			return result;
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
					const urlMatch = projectInput.match(/^https?:\/\/[^\/]+\/projects\/([^\/]+)/);
					const projectId = urlMatch ? urlMatch[1] : projectInput;

					// Get credentials
					const credentials = await this.getCredentials('speckleApi');
					const token = credentials.token as string;
					let domain = credentials.domain as string;

					// Remove trailing slash from domain if present
					domain = domain.replace(/\/$/, '');

					const graphqlUrl = `${domain}/graphql`;

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
					const findModelQuery = {
						query: `
							query FindModelByName($projectId: String!, $filter: ProjectModelsFilter) {
								project(id: $projectId) {
									models(filter: $filter) {
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
					};

					const findModelOptions: IHttpRequestOptions = {
						method: 'POST',
						url: graphqlUrl,
						headers: {
							'Content-Type': 'application/json',
							Authorization: token,
						},
						body: findModelQuery,
						json: true,
					};

					let findModelResponse;
					try {
						findModelResponse = await this.helpers.httpRequest(findModelOptions);
					} catch (error) {
						throw new NodeOperationError(
							this.getNode(),
							`Failed to query models: ${error.message}`,
							{ itemIndex },
						);
					}

					if (findModelResponse.errors && findModelResponse.errors.length > 0) {
						const errorMessages = findModelResponse.errors
							.map((e: { message: string }) => e.message)
							.join('; ');
						throw new NodeOperationError(
							this.getNode(),
							`GraphQL error while querying models: ${errorMessages}`,
							{ itemIndex },
						);
					}

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
						const createModelMutation = {
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
						};

						const createModelOptions: IHttpRequestOptions = {
							method: 'POST',
							url: graphqlUrl,
							headers: {
								'Content-Type': 'application/json',
								Authorization: token,
							},
							body: createModelMutation,
							json: true,
						};

						let createModelResponse;
						try {
							createModelResponse = await this.helpers.httpRequest(createModelOptions);
						} catch (error) {
							throw new NodeOperationError(
								this.getNode(),
								`Failed to create model: ${error.message}`,
								{ itemIndex },
							);
						}

						if (createModelResponse.errors && createModelResponse.errors.length > 0) {
							const errorMessages = createModelResponse.errors
								.map((e: { message: string }) => e.message)
								.join('; ');
							throw new NodeOperationError(
								this.getNode(),
								`GraphQL error while creating model: ${errorMessages}`,
								{ itemIndex },
							);
						}

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
					const generateUrlMutation = {
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
					};

					const generateUrlOptions: IHttpRequestOptions = {
						method: 'POST',
						url: graphqlUrl,
						headers: {
							'Content-Type': 'application/json',
							Authorization: token,
						},
						body: generateUrlMutation,
						json: true,
					};

					let generateUrlResponse;
					try {
						generateUrlResponse = await this.helpers.httpRequest(generateUrlOptions);
					} catch (error) {
						throw new NodeOperationError(
							this.getNode(),
							`Failed to generate upload URL: ${error.message}`,
							{ itemIndex },
						);
					}

					if (generateUrlResponse.errors && generateUrlResponse.errors.length > 0) {
						const errorMessages = generateUrlResponse.errors
							.map((e: { message: string }) => e.message)
							.join('; ');
						throw new NodeOperationError(
							this.getNode(),
							`GraphQL error while generating upload URL: ${errorMessages}`,
							{ itemIndex },
						);
					}

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
					const startIngestionMutation = {
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
								etag: etag,
							},
						},
					};

					const startIngestionOptions: IHttpRequestOptions = {
						method: 'POST',
						url: graphqlUrl,
						headers: {
							'Content-Type': 'application/json',
							Authorization: token,
						},
						body: startIngestionMutation,
						json: true,
					};

					let startIngestionResponse;
					try {
						startIngestionResponse = await this.helpers.httpRequest(startIngestionOptions);
					} catch (error) {
						throw new NodeOperationError(
							this.getNode(),
							`Failed to start file ingestion: ${error.message}`,
							{ itemIndex },
						);
					}

					if (startIngestionResponse.errors && startIngestionResponse.errors.length > 0) {
						const errorMessages = startIngestionResponse.errors
							.map((e: { message: string }) => e.message)
							.join('; ');
						throw new NodeOperationError(
							this.getNode(),
							`GraphQL error while starting ingestion: ${errorMessages}`,
							{ itemIndex },
						);
					}

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
					const checkStatusQuery = {
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
					};

					const checkStatusOptions: IHttpRequestOptions = {
						method: 'POST',
						url: graphqlUrl,
						headers: {
							'Content-Type': 'application/json',
							Authorization: token,
						},
						body: checkStatusQuery,
						json: true,
					};

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
							statusResponse = await this.helpers.httpRequest(checkStatusOptions);
						} catch (error) {
							// Continue polling on network errors
							this.logger.warn(`Poll attempt ${pollAttempt} failed: ${error.message}`);
							continue;
						}

						const ingestionData = statusResponse.data?.project?.ingestion;

						// Handle case where ingestion is null (completed and cleaned up)
						if (!ingestionData) {
							if (pollAttempt >= 5) {
								importComplete = true;
								importSuccess = true;
								lastPollData = {
									pollAttempt,
									ingestionStatus: 'null - possibly completed and cleaned up',
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

					// Parse the URL to extract components - supports project, model, and version URLs
					// Project URL: https://app.speckle.systems/projects/{projectId}
					// Model URL: https://app.speckle.systems/projects/{projectId}/models/{modelId}
					// Version URL: https://app.speckle.systems/projects/{projectId}/models/{modelId}@{versionId}
					const urlMatch = issuesUrl.match(
						/^(https?:\/\/[^\/]+)\/projects\/([^\/]+)(?:\/models\/([^@\/]+))?(?:@([^\/]+))?$/,
					);

					if (!urlMatch) {
						throw new NodeOperationError(
							this.getNode(),
							'Invalid Speckle URL. Expected format: https://server/projects/{projectId}[/models/{modelId}[@{versionId}]]',
							{ itemIndex },
						);
					}

					const [, baseUrl, projectId, modelId, versionId] = urlMatch;

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

					const graphqlUrl = `${domain}/graphql`;
					const graphqlOptions: IHttpRequestOptions = {
						method: 'POST',
						url: graphqlUrl,
						headers: {
							'Content-Type': 'application/json',
							Authorization: token,
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

					// Check for GraphQL errors first
					if (graphqlResponse.errors && graphqlResponse.errors.length > 0) {
						const errorMessages = graphqlResponse.errors
							.map((e: { message: string }) => e.message)
							.join('; ');
						throw new NodeOperationError(
							this.getNode(),
							`GraphQL error: ${errorMessages}`,
							{ itemIndex },
						);
					}

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
