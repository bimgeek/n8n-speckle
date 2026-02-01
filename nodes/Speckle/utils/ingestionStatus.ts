/**
 * Maps ingestion status strings to legacy numeric codes
 */
export const mapIngestionStatusToLegacyCode = (status: string): number => {
	switch (status) {
		case 'queued': return 0;
		case 'processing': return 1;
		case 'success': return 2;
		case 'failed': return 3;
		case 'cancelled': return 3;
		default: return 0;
	}
};

/**
 * Extracts version ID from success status
 */
export const extractVersionIdFromIngestionStatus = (statusData: any): string | null => {
	if (statusData.__typename === 'ModelIngestionSuccessStatus') {
		return statusData.versionId || null;
	}
	return null;
};

/**
 * Extracts error message from failed/cancelled status
 */
export const extractErrorMessageFromIngestionStatus = (statusData: any): string => {
	if (statusData.__typename === 'ModelIngestionFailedStatus') {
		return statusData.errorReason || 'Unknown error';
	}
	if (statusData.__typename === 'ModelIngestionCancelledStatus') {
		return `Job cancelled: ${statusData.cancellationMessage || 'No reason provided'}`;
	}
	return 'Unknown error';
};

/**
 * Extracts progress information from status
 */
export const extractProgressFromIngestionStatus = (statusData: any): {
	message?: string;
	progress?: number;
} => {
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
};
