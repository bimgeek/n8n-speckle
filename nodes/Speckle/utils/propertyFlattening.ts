/**
 * Speckle Property Flattening Algorithm
 * Flattens nested Speckle object properties into a single-level object
 * with conflict resolution via parent path suffixing
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
 * Process a single field
 */
const processField = (
	fieldName: string,
	fieldValue: any,
	currentParentPath: string,
	state: { FlattenedRecord: any; ExistingFieldsSet: Set<string> },
): { FlattenedRecord: any; ExistingFieldsSet: Set<string> } => {
	// Build the new path for this field
	const newPath = currentParentPath === '' ? fieldName : `${currentParentPath}.${fieldName}`;

	// Step 1: Check if path should be excluded
	if (isPathExcluded(newPath)) {
		return state; // Skip this field
	}

	// Step 2: Determine field type and process accordingly

	// Case A: Field is a name/value record
	if (isRecord(fieldValue) && 'name' in fieldValue && 'value' in fieldValue) {
		return processNameValueRecord(fieldValue, currentParentPath, state);
	}

	// Case B: Field value is null
	else if (fieldValue === null) {
		return processNullValue(fieldName, currentParentPath, state);
	}

	// Case C: Field value is a nested record
	else if (isRecord(fieldValue)) {
		return processNestedRecord(fieldValue, newPath, state);
	}

	// Case D: Field value is a primitive (string, number, boolean) or array
	else {
		return processPrimitiveValue(fieldName, fieldValue, currentParentPath, state);
	}
};

/**
 * Process name/value record pattern
 */
const processNameValueRecord = (
	fieldValue: any,
	currentParentPath: string,
	state: { FlattenedRecord: any; ExistingFieldsSet: Set<string> },
): { FlattenedRecord: any; ExistingFieldsSet: Set<string> } => {
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

	// Update Set with the resolved name
	const newFieldsSet = new Set(state.ExistingFieldsSet);
	newFieldsSet.add(resolvedName);

	return {
		FlattenedRecord: newRecord,
		ExistingFieldsSet: newFieldsSet,
	};
};

/**
 * Process null value
 */
const processNullValue = (
	fieldName: string,
	currentParentPath: string,
	state: { FlattenedRecord: any; ExistingFieldsSet: Set<string> },
): { FlattenedRecord: any; ExistingFieldsSet: Set<string> } => {
	// Resolve naming conflicts (uses Set for O(1) lookup)
	const resolvedName = resolveFieldName(fieldName, currentParentPath, state.ExistingFieldsSet);

	// Add null value to flattened record
	const newRecord = {
		...state.FlattenedRecord,
		[resolvedName]: null,
	};

	// Update Set with the resolved name
	const newFieldsSet = new Set(state.ExistingFieldsSet);
	newFieldsSet.add(resolvedName);

	return {
		FlattenedRecord: newRecord,
		ExistingFieldsSet: newFieldsSet,
	};
};

/**
 * Process nested record (recursion)
 */
const processNestedRecord = (
	fieldValue: any,
	newPath: string,
	state: { FlattenedRecord: any; ExistingFieldsSet: Set<string> },
): { FlattenedRecord: any; ExistingFieldsSet: Set<string> } => {
	// Skip empty records
	const fieldCount = Object.keys(fieldValue).length;
	if (fieldCount === 0) {
		return state;
	}

	// Recursively flatten the nested record
	const flattened = flattenRecordImpl(fieldValue, newPath, state.ExistingFieldsSet);

	// Get all field names from the flattened result
	const flattenedFieldNames = Object.keys(flattened);

	// Merge the flattened record with current state
	const combinedRecord = {
		...state.FlattenedRecord,
		...flattened,
	};

	// Merge Sets for O(n) deduplication
	const allFieldsSet = new Set([...state.ExistingFieldsSet, ...flattenedFieldNames]);

	return {
		FlattenedRecord: combinedRecord,
		ExistingFieldsSet: allFieldsSet,
	};
};

/**
 * Process primitive value
 */
const processPrimitiveValue = (
	fieldName: string,
	fieldValue: any,
	currentParentPath: string,
	state: { FlattenedRecord: any; ExistingFieldsSet: Set<string> },
): { FlattenedRecord: any; ExistingFieldsSet: Set<string> } => {
	// Resolve naming conflicts (uses Set for O(1) lookup)
	const resolvedName = resolveFieldName(fieldName, currentParentPath, state.ExistingFieldsSet);

	// Add primitive value to flattened record
	const newRecord = {
		...state.FlattenedRecord,
		[resolvedName]: fieldValue,
	};

	// Update Set with the resolved name
	const newFieldsSet = new Set(state.ExistingFieldsSet);
	newFieldsSet.add(resolvedName);

	return {
		FlattenedRecord: newRecord,
		ExistingFieldsSet: newFieldsSet,
	};
};

/**
 * Main flattening implementation
 * Uses Set for O(1) field name lookup performance
 */
const flattenRecordImpl = (
	inputRecord: any,
	parentPath: string | null,
	existingFields: Set<string> | null,
): any => {
	// Initialize parameters with defaults
	const currentParentPath = parentPath || '';
	const currentExistingFields = existingFields || new Set<string>();

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

	// Initialize state with Set for fast lookup
	let state = {
		FlattenedRecord: {},
		ExistingFieldsSet: currentExistingFields,
	};

	// Process each field sequentially (accumulation pattern)
	for (const fieldName of fieldNames) {
		state = processField(fieldName, recordToProcess[fieldName], currentParentPath, state);
	}

	// Return the flattened record
	return state.FlattenedRecord;
};

/**
 * Flattens nested Speckle object properties into a single-level object
 * with conflict resolution via parent path suffixing
 */
export const flattenRecord = (
	inputRecord: any,
	parentPath: string | null = null,
	existingFields: Set<string> | null = null,
): any => {
	return flattenRecordImpl(inputRecord, parentPath, existingFields);
};
