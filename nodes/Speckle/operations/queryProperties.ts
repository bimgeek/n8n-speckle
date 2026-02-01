import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { flattenRecord } from '../utils/propertyFlattening';

/**
 * Handles the Query Properties operation
 * Flattens nested object properties into a single-level object
 */
export async function handleQueryProperties(
	context: IExecuteFunctions,
	items: INodeExecutionData[],
): Promise<INodeExecutionData[]> {
	const returnData: INodeExecutionData[] = [];

	for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
		try {
			// Get input data from previous node
			const inputData = items[itemIndex].json;

			// Validate input (should be an object, not an array)
			if (Array.isArray(inputData)) {
				throw new NodeOperationError(
					context.getNode(),
					'Query Properties expects individual objects, not arrays. Connect to Query Objects output.',
					{ itemIndex },
				);
			}

			// Flatten the properties using the algorithm
			const flattenedProperties = flattenRecord(inputData, null, null);

			// Return flattened object as a new item
			returnData.push({
				json: flattenedProperties,
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
		}
	}

	return returnData;
}
