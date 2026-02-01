/**
 * Parsed Speckle URL components
 */
export interface ParsedSpeckleUrl {
	baseUrl: string;
	projectId: string;
	modelId?: string;
	versionId?: string;
}

/**
 * Parse a Speckle model URL
 * Expected format: https://app.speckle.systems/projects/{projectId}/models/{modelId}
 */
export const parseSpeckleModelUrl = (url: string): ParsedSpeckleUrl => {
	const urlMatch = url.match(
		/^(https?:\/\/[^\/]+)\/projects\/([^\/]+)\/models\/([^\/,@]+)$/,
	);

	if (!urlMatch) {
		throw new Error(
			'Invalid Speckle model URL. Expected format: https://app.speckle.systems/projects/{projectId}/models/{modelId}',
		);
	}

	const [, baseUrl, projectId, modelId] = urlMatch;

	return {
		baseUrl,
		projectId,
		modelId,
	};
};

/**
 * Parse a Speckle issues URL (supports project, model, and version URLs)
 * Formats:
 * - Project: https://server/projects/{projectId}
 * - Model: https://server/projects/{projectId}/models/{modelId}
 * - Version: https://server/projects/{projectId}/models/{modelId}@{versionId}
 */
export const parseSpeckleIssuesUrl = (url: string): ParsedSpeckleUrl => {
	const urlMatch = url.match(
		/^(https?:\/\/[^\/]+)\/projects\/([^\/]+)(?:\/models\/([^@\/]+))?(?:@([^\/]+))?$/,
	);

	if (!urlMatch) {
		throw new Error(
			'Invalid Speckle URL. Expected format: https://server/projects/{projectId}[/models/{modelId}[@{versionId}]]',
		);
	}

	const [, baseUrl, projectId, modelId, versionId] = urlMatch;

	return {
		baseUrl,
		projectId,
		modelId,
		versionId,
	};
};

/**
 * Extract project ID from either a full URL or raw project ID
 * Accepts:
 * - Full URL: https://app.speckle.systems/projects/{projectId}/...
 * - Raw ID: {projectId}
 */
export const extractProjectId = (input: string): string => {
	const urlMatch = input.match(/^https?:\/\/[^\/]+\/projects\/([^\/]+)/);
	return urlMatch ? urlMatch[1] : input;
};
