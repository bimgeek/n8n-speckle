/**
 * Speckle Reference Resolver
 * Handles resolution of missing object references by iteratively fetching them
 */
export class SpeckleReferenceResolver {
	private maxIterations: number;
	private logger: any;

	constructor(logger: any, maxIterations = 10) {
		this.logger = logger;
		this.maxIterations = maxIterations;
	}

	/**
	 * Extract all referencedId properties from an object recursively
	 */
	private extractReferencedIds(obj: any, referencedIds: Set<string>): void {
		if (!obj || typeof obj !== 'object') return;

		// Check for referencedId property
		if (obj.referencedId && typeof obj.referencedId === 'string') {
			referencedIds.add(obj.referencedId);
		}

		// Recursively check all properties
		for (const value of Object.values(obj)) {
			if (value && typeof value === 'object') {
				this.extractReferencedIds(value, referencedIds);
			}
		}
	}

	/**
	 * Resolve missing object references by iteratively fetching them
	 */
	async resolveMissingReferences(loader: any, objects: any[]): Promise<void> {
		let iterationCount = 0;

		while (iterationCount < this.maxIterations) {
			iterationCount++;

			// Build set of existing object IDs
			const existingIds = new Set(objects.map((obj: any) => obj.id));

			// Find all referenced IDs
			const referencedIds = new Set<string>();
			for (const obj of objects) {
				this.extractReferencedIds(obj, referencedIds);
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
	}
}
