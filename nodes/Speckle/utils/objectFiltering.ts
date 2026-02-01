/**
 * Speckle Object Filtering
 * Handles cleaning and filtering of Speckle objects based on type and metadata
 */
export class SpeckleObjectFilter {
	private static FIELDS_TO_REMOVE = ['__closure', 'totalChildrenCount', 'renderMaterialProxies'];

	/**
	 * Check if object should be excluded based on speckle_type
	 */
	static shouldExcludeObject(obj: any): boolean {
		const speckleType = obj.speckle_type || '';
		return (
			speckleType === 'Speckle.Core.Models.DataChunk' ||
			speckleType.includes('Objects.Other.RawEncoding')
		);
	}

	/**
	 * Remove metadata fields from objects
	 */
	static cleanObjects(objects: any[]): any[] {
		return objects.map((obj: any) => {
			const cleaned = { ...obj };
			this.FIELDS_TO_REMOVE.forEach((field) => {
				if (field in cleaned) {
					delete cleaned[field];
				}
			});
			return cleaned;
		});
	}

	/**
	 * Filter objects based on DataObject detection
	 * If model contains DataObjects, show ONLY DataObjects
	 * Otherwise, show ALL objects except excluded types
	 */
	static filterObjects(objects: any[]): any[] {
		// Detect if model has DataObjects
		const hasDataObjects = objects.some((obj: any) => {
			const speckleType = obj.speckle_type || '';
			return speckleType.includes('DataObject') && !this.shouldExcludeObject(obj);
		});

		if (hasDataObjects) {
			// Include ONLY DataObjects (exclude DataChunk/RawEncoding)
			return objects.filter((obj: any) => {
				const speckleType = obj.speckle_type || '';
				return speckleType.includes('DataObject') && !this.shouldExcludeObject(obj);
			});
		} else {
			// Include ALL objects except excluded types
			return objects.filter((obj: any) => !this.shouldExcludeObject(obj));
		}
	}
}
