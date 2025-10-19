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

				// Fetch missing objects
				const missingIdsArray = Array.from(missingIds);
				for (const missingId of missingIdsArray) {
					try {
						const missingObj = await loader.getObject({ id: missingId });
						if (missingObj) {
							objects.push(missingObj);
						}
					} catch (err) {
						// Silently continue if object cannot be fetched
						// This is expected for some reference types
					}
				}
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
				...flattened,
				...state.FlattenedRecord,
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

		// For other resources (like HTTP Verb), return empty to use declarative routing
		throw new NodeOperationError(
			this.getNode(),
			`The operation "${operation}" is not supported for resource "${resource}"`,
		);
	}
}
