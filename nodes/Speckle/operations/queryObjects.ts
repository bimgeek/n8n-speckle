import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { SpeckleObjectFilter } from '../utils/objectFiltering';

/**
 * Handles the Query Objects operation
 * Filters and cleans Speckle model objects based on type
 */
export async function handleQueryObjects(
	context: IExecuteFunctions,
	items: INodeExecutionData[],
): Promise<INodeExecutionData[]> {
	const returnData: INodeExecutionData[] = [];

	for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
		try {
			// Get input data - expecting array from Load Model
			const inputData = items[itemIndex].json;

			// Validate input is an array
			if (!Array.isArray(inputData)) {
				throw new NodeOperationError(
					context.getNode(),
					'Input must be an array of objects. Connect this to the output of Load Model operation.',
					{ itemIndex },
				);
			}

			// Step 1: Clean objects - remove unwanted fields
			const cleanedObjects = SpeckleObjectFilter.cleanObjects(inputData);

			// Step 2 & 3: Filter objects based on detection
			const filteredObjects = SpeckleObjectFilter.filterObjects(cleanedObjects);

			// Return filtered array (each object becomes a separate item)
			filteredObjects.forEach((obj: any) => {
				returnData.push({
					json: obj,
					pairedItem: itemIndex,
				});
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
