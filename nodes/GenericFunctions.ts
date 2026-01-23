import type { IExecuteFunctions, JsonObject } from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

// ============================================================================
// Constants
// ============================================================================

/** Credential type name used by all Ainoflow nodes */
export const CREDENTIAL_NAME = 'ainoflowApi';

/** Default API base URL */
export const DEFAULT_BASE_URL = 'https://api.ainoflow.io';

/** Entity types for error messages */
export type EntityType = 'record' | 'job' | 'file';

// ============================================================================
// Shared Functions
// ============================================================================

/**
 * Get the base URL from credentials.
 * Falls back to default if not specified.
 */
export async function getBaseUrl(context: IExecuteFunctions): Promise<string> {
	const credentials = await context.getCredentials(CREDENTIAL_NAME);
	return (credentials.baseUrl as string) || DEFAULT_BASE_URL;
}

/**
 * Handle API errors and convert to appropriate NodeApiError.
 * @param context - The execution context
 * @param error - The error object from the API call
 * @param itemIndex - The item index for error reporting
 * @param operation - Description of the operation that failed
 * @param entityType - Type of entity for customized error messages
 */
export function handleApiError(
	context: IExecuteFunctions,
	error: unknown,
	itemIndex: number,
	operation: string,
	entityType: EntityType = 'record',
): NodeApiError {
	const httpError = error as {
		statusCode?: number;
		message?: string;
		response?: {
			body?: {
				error?: {
					message?: string;
				};
			};
		};
	};

	const statusCode = httpError.statusCode;
	const apiMessage = httpError.response?.body?.error?.message || httpError.message || 'Unknown issue';

	// Entity-specific messages
	const notFoundMessages: Record<EntityType, { message: string; description: string }> = {
		record: { message: 'Record not found', description: 'The specified record does not exist' },
		job: { message: 'Job not found', description: 'The specified job ID does not exist or has expired' },
		file: { message: 'File not found', description: 'The specified file does not exist or has been deleted' },
	};

	const conflictMessages: Record<EntityType, { message: string; description: string }> = {
		record: { message: 'Record already exists', description: apiMessage },
		job: { message: 'Job already exists', description: apiMessage },
		file: { message: 'File already exists', description: 'Use "Create or Replace" operation to overwrite existing files' },
	};

	const rateLimitMessages: Record<EntityType, string> = {
		record: 'Storage limit reached',
		job: 'Rate limit exceeded',
		file: 'Storage limit reached',
	};

	// Map common HTTP status codes to user-friendly messages
	let message: string;
	let description: string;

	switch (statusCode) {
		case 400:
			message = 'Invalid request';
			description = apiMessage;
			break;
		case 401:
			message = 'Invalid API key';
			description = 'Check your Ainoflow API credentials';
			break;
		case 404:
			message = notFoundMessages[entityType].message;
			description = notFoundMessages[entityType].description;
			break;
		case 409:
			message = conflictMessages[entityType].message;
			description = conflictMessages[entityType].description;
			break;
		case 429:
			message = rateLimitMessages[entityType];
			description = 'API rate/count limit reached for current scope';
			break;
		case 500:
		case 502:
		case 503:
			message = 'Server returned an unexpected response';
			description = `Ainoflow API response: ${apiMessage}`;
			break;
		default:
			message = `Could not ${operation}`;
			description = apiMessage;
	}

	return new NodeApiError(
		context.getNode(),
		error as JsonObject,
		{
			message,
			description,
			httpCode: statusCode?.toString(),
			itemIndex,
		},
	);
}
