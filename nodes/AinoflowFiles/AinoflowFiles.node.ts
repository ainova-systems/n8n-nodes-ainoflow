import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IHttpRequestMethods,
	IHttpRequestOptions,
	JsonObject,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeApiError, NodeOperationError } from 'n8n-workflow';
import { CREDENTIAL_NAME, DEFAULT_BASE_URL, getBaseUrl, handleApiError } from '../GenericFunctions';

// ============================================================================
// Type Definitions
// ============================================================================

/** Resource types */
type ResourceType = 'file' | 'category';

/** File operations */
type FileOperation = 'create' | 'createOrReplace' | 'download' | 'delete' | 'getMetadata' | 'getUrl' | 'getMany';

/** Category operations */
type CategoryOperation = 'getMany';

/** Input source for file uploads */
type InputSource = 'binary' | 'url';

/** File metadata returned by API */
interface FileMetadata {
	category: string;
	key: string;
	fileName: string;
	contentType: string;
	size: number;
	etag: string;
	createdAt: string;
	updatedAt: string;
	expiresAt: string | null;
	version: number;
}

/** File upload response */
interface FileUploadResponse extends FileMetadata {
	downloadUrl: string;
	downloadUrlExpiresAt: string;
}

/** Pre-signed URL response */
interface FileUrlResponse {
	downloadUrl: string;
	downloadUrlExpiresAt: string;
}

/** Category with file count */
interface CategoryInfo {
	category: string;
	count: number;
}

/** File list item (simplified) */
interface FileListItem {
	category: string;
	key: string;
	fileName: string;
	contentType: string;
	size: number;
	createdAt: string;
	updatedAt: string;
	expiresAt: string | null;
}

/** Additional fields for create operation */
interface CreateAdditionalFields {
	key?: string;
	expiresAt?: string;
}

/** Additional fields for createOrReplace operation */
interface CreateOrReplaceAdditionalFields {
	expiresAt?: string;
}

/** Additional fields for getUrl operation */
interface GetUrlAdditionalFields {
	expirySeconds?: number;
}

/** Additional fields for getMany operation */
interface GetManyAdditionalFields {
	offset?: number;
	prefix?: string;
	sortBy?: string;
	sortOrder?: string;
	aggregate?: boolean;
}

// ============================================================================
// Constants
// ============================================================================

/** API base path */
const API_BASE_PATH = '/api/v1/files';

/** Maximum limit per request for Return All pagination */
const MAX_LIMIT_PER_REQUEST = 1000;

/** Request timeout for file operations (10 minutes) */
const UPLOAD_TIMEOUT_MS = 600000;

/** Sort field options (alphabetized by displayName) */
const SORT_BY_OPTIONS = [
	{ name: 'Created At', value: 'createdAt' },
	{ name: 'Key', value: 'key' },
	{ name: 'Size', value: 'size' },
	{ name: 'Updated At', value: 'updatedAt' },
] as const;

/** Sort order options (alphabetized by displayName) */
const SORT_ORDER_OPTIONS = [
	{ name: 'Ascending', value: 'asc' },
	{ name: 'Descending', value: 'desc' },
] as const;

// ============================================================================
// Node Implementation
// ============================================================================

export class AinoflowFiles implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Ainoflow Files',
		name: 'ainoflowFiles',
		icon: { light: 'file:../../icons/files.svg', dark: 'file:../../icons/files.dark.svg' },
		group: ['output'],
		version: 1,
		subtitle: '={{$parameter["resource"] + ": " + $parameter["operation"]}}',
		description: 'Store and manage binary files in Ainoflow object storage',
		defaults: {
			name: 'Ainoflow Files',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [
			{
				name: CREDENTIAL_NAME,
				required: true,
			},
		],
		properties: [
			// ----------------------------------------------------------------
			// Resource Selection
			// ----------------------------------------------------------------
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Category',
						value: 'category',
						description: 'Operations on file categories',
					},
					{
						name: 'File',
						value: 'file',
						description: 'Operations on individual files',
					},
				],
				default: 'file',
			},

			// ----------------------------------------------------------------
			// File Operations
			// ----------------------------------------------------------------
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['file'],
					},
				},
				options: [
					{
						name: 'Create',
						value: 'create',
						description: 'Create new file in storage',
						action: 'Create a file',
					},
					{
						name: 'Create or Replace',
						value: 'createOrReplace',
						description: 'Upload file, replacing if it already exists (upsert)',
						action: 'Create or replace a file',
					},
					{
						name: 'Delete',
						value: 'delete',
						description: 'Delete file from storage',
						action: 'Delete a file',
					},
					{
						name: 'Download',
						value: 'download',
						description: 'Download file from storage',
						action: 'Download a file',
					},
					{
						name: 'Get Many',
						value: 'getMany',
						description: 'Get many files in category',
						action: 'Get many files',
					},
					{
						name: 'Get Metadata',
						value: 'getMetadata',
						description: 'Get file metadata',
						action: 'Get file metadata',
					},
					{
						name: 'Get URL',
						value: 'getUrl',
						description: 'Get pre-signed download URL',
						action: 'Get download URL',
					},
				],
				default: 'create',
			},

			// ----------------------------------------------------------------
			// Category Operations
			// ----------------------------------------------------------------
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['category'],
					},
				},
				options: [
					{
						name: 'Get Many',
						value: 'getMany',
						description: 'Get many categories with file counts',
						action: 'Get many categories',
					},
				],
				default: 'getMany',
			},

			// ----------------------------------------------------------------
			// Common Parameters
			// ----------------------------------------------------------------

			// Category - shown for all file operations
			{
				displayName: 'Category',
				name: 'category',
				type: 'string',
				displayOptions: {
					show: {
						resource: ['file'],
					},
				},
				default: '',
				required: true,
				description: 'Category (namespace) for the file',
			},

			// Key - shown for operations that need a specific file
			{
				displayName: 'Key',
				name: 'key',
				type: 'string',
				displayOptions: {
					show: {
						resource: ['file'],
						operation: ['createOrReplace', 'download', 'delete', 'getUrl', 'getMetadata'],
					},
				},
				default: '',
				required: true,
				description: 'Key of the file',
			},

			// ----------------------------------------------------------------
			// Create / Create or Replace Parameters
			// ----------------------------------------------------------------

			// Input Source
			{
				displayName: 'Input Source',
				name: 'inputSource',
				type: 'options',
				displayOptions: {
					show: {
						resource: ['file'],
						operation: ['create', 'createOrReplace'],
					},
				},
				options: [
					{
						name: 'Binary Data',
						value: 'binary',
						description: 'Use binary data from previous node',
					},
					{
						name: 'URL',
						value: 'url',
						description: 'Download from URL',
					},
				],
				default: 'binary',
			},

			// Binary Property (for binary input)
			{
				displayName: 'Binary Property',
				name: 'binaryPropertyName',
				type: 'string',
				displayOptions: {
					show: {
						resource: ['file'],
						operation: ['create', 'createOrReplace'],
						inputSource: ['binary'],
					},
				},
				default: 'data',
				required: true,
				description: 'Name of binary property containing file',
			},

			// Source URL (for URL input)
			{
				displayName: 'Source URL',
				name: 'sourceUrl',
				type: 'string',
				displayOptions: {
					show: {
						resource: ['file'],
						operation: ['create', 'createOrReplace'],
						inputSource: ['url'],
					},
				},
				default: '',
				required: true,
				description: 'URL to download file from',
			},

			// Create Additional Fields
			{
				displayName: 'Additional Fields',
				name: 'createOptions',
				type: 'collection',
				placeholder: 'Add Field',
				displayOptions: {
					show: {
						resource: ['file'],
						operation: ['create'],
					},
				},
				default: {},
				options: [
					{
						displayName: 'Expires At',
						name: 'expiresAt',
						type: 'dateTime',
						default: '',
						description: 'File expiration date (ISO 8601)',
					},
					{
						displayName: 'Key',
						name: 'key',
						type: 'string',
						default: '',
						description: 'Custom key. If empty, UUID is generated.',
					},
				],
			},

			// Create or Replace Additional Fields
			{
				displayName: 'Additional Fields',
				name: 'createOrReplaceOptions',
				type: 'collection',
				placeholder: 'Add Field',
				displayOptions: {
					show: {
						resource: ['file'],
						operation: ['createOrReplace'],
					},
				},
				default: {},
				options: [
					{
						displayName: 'Expires At',
						name: 'expiresAt',
						type: 'dateTime',
						default: '',
						description: 'File expiration date (ISO 8601)',
					},
				],
			},

			// ----------------------------------------------------------------
			// Get URL Additional Fields
			// ----------------------------------------------------------------
			{
				displayName: 'Additional Fields',
				name: 'getUrlOptions',
				type: 'collection',
				placeholder: 'Add Field',
				displayOptions: {
					show: {
						resource: ['file'],
						operation: ['getUrl'],
					},
				},
				default: {},
				options: [
					{
						displayName: 'Expiry (Seconds)',
						name: 'expirySeconds',
						type: 'number',
						typeOptions: {
							minValue: 1,
							maxValue: 86400,
						},
						default: 3600,
						description: 'URL expiration in seconds (max 86400)',
					},
				],
			},

			// ----------------------------------------------------------------
			// Get Many (File) Parameters
			// ----------------------------------------------------------------
			{
				displayName: 'Return All',
				name: 'returnAll',
				type: 'boolean',
				displayOptions: {
					show: {
						resource: ['file'],
						operation: ['getMany'],
					},
				},
				default: false,
				description: 'Whether to return all results or only up to a given limit',
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				displayOptions: {
					show: {
						resource: ['file'],
						operation: ['getMany'],
						returnAll: [false],
					},
				},
				typeOptions: {
					minValue: 1,
					maxValue: 1000,
				},
				default: 50,
				description: 'Max number of results to return',
			},

			// Get Many Additional Fields
			{
				displayName: 'Additional Fields',
				name: 'getManyOptions',
				type: 'collection',
				placeholder: 'Add Field',
				displayOptions: {
					show: {
						resource: ['file'],
						operation: ['getMany'],
					},
				},
				default: {},
				options: [
					{
						displayName: 'Offset',
						name: 'offset',
						type: 'number',
						typeOptions: {
							minValue: 0,
						},
						default: 0,
						description: 'Number of results to skip for pagination',
					},
					{
						displayName: 'Prefix',
						name: 'prefix',
						type: 'string',
						default: '',
						description: 'Filter files by key prefix',
					},
					{
						displayName: 'Return Full Metadata',
						name: 'aggregate',
						type: 'boolean',
						default: false,
						description: 'Whether to return full file metadata',
					},
					{
						displayName: 'Sort By',
						name: 'sortBy',
						type: 'options',
						options: [...SORT_BY_OPTIONS],
						default: '',
						description: 'Field to sort results by',
					},
					{
						displayName: 'Sort Order',
						name: 'sortOrder',
						type: 'options',
						options: [...SORT_ORDER_OPTIONS],
						default: '',
						description: 'Order of sorting',
					},
				],
			},
		],
	};

	// ========================================================================
	// Execute Method
	// ========================================================================

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const resource = this.getNodeParameter('resource', 0) as ResourceType;
		const operation = this.getNodeParameter('operation', 0) as FileOperation | CategoryOperation;

		// Process each input item
		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				let responseData: unknown;

				if (resource === 'file') {
					responseData = await executeFileOperation.call(
						this,
						itemIndex,
						operation as FileOperation,
					);
				} else if (resource === 'category') {
					responseData = await executeCategoryOperation.call(
						this,
						itemIndex,
						operation as CategoryOperation,
					);
				} else {
					throw new NodeOperationError(
						this.getNode(),
						`Unknown resource: ${resource}`,
						{ itemIndex },
					);
				}

				// Handle array responses (getMany operations)
				if (Array.isArray(responseData)) {
					for (const item of responseData) {
						returnData.push({
							json: item as JsonObject,
							pairedItem: { item: itemIndex },
						});
					}
				} else if (responseData && typeof responseData === 'object' && 'binary' in responseData) {
					// Handle download response with binary data
					returnData.push(responseData as INodeExecutionData);
				} else {
					returnData.push({
						json: responseData as JsonObject,
						pairedItem: { item: itemIndex },
					});
				}
			} catch (error) {
				// Handle continue on fail mode
				if (this.continueOnFail()) {
					returnData.push({
						json: {
							error: (error as Error).message,
						},
						pairedItem: { item: itemIndex },
					});
					continue;
				}

				// Re-throw NodeApiError and NodeOperationError as-is
				if (error instanceof NodeApiError || error instanceof NodeOperationError) {
					throw error;
				}

				// Wrap unknown errors in NodeOperationError
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex });
			}
		}

		return [returnData];
	}
}

// ============================================================================
// File Operation Handlers
// ============================================================================

/**
 * Execute file operations.
 */
async function executeFileOperation(
	this: IExecuteFunctions,
	itemIndex: number,
	operation: FileOperation,
): Promise<unknown> {
	switch (operation) {
		case 'create':
			return await executeCreate.call(this, itemIndex);
		case 'createOrReplace':
			return await executeCreateOrReplace.call(this, itemIndex);
		case 'download':
			return await executeDownload.call(this, itemIndex);
		case 'delete':
			return await executeDelete.call(this, itemIndex);
		case 'getMetadata':
			return await executeGetMetadata.call(this, itemIndex);
		case 'getUrl':
			return await executeGetUrl.call(this, itemIndex);
		case 'getMany':
			return await executeFileGetMany.call(this, itemIndex);
		default:
			throw new NodeOperationError(
				this.getNode(),
				`Unknown file operation: ${operation}`,
				{ itemIndex },
			);
	}
}

/**
 * Create a new file (fails if exists).
 */
async function executeCreate(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<FileUploadResponse> {
	const category = this.getNodeParameter('category', itemIndex) as string;
	const inputSource = this.getNodeParameter('inputSource', itemIndex) as InputSource;
	const options = this.getNodeParameter('createOptions', itemIndex, {}) as CreateAdditionalFields;

	// Build URL - with or without key
	let url = `${API_BASE_PATH}/${encodeURIComponent(category)}`;
	if (options.key) {
		url += `/${encodeURIComponent(options.key)}`;
	}

	// Build additional fields for form
	const additionalFields: Record<string, string> = {};
	if (options.expiresAt) additionalFields.expiresAt = options.expiresAt;

	if (inputSource === 'url') {
		return await uploadViaUrl.call(this, itemIndex, url, 'POST', additionalFields);
	} else {
		return await uploadViaBinary.call(this, itemIndex, url, 'POST', additionalFields);
	}
}

/**
 * Create or replace a file (upsert).
 */
async function executeCreateOrReplace(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<FileUploadResponse> {
	const category = this.getNodeParameter('category', itemIndex) as string;
	const key = this.getNodeParameter('key', itemIndex) as string;
	const inputSource = this.getNodeParameter('inputSource', itemIndex) as InputSource;
	const options = this.getNodeParameter('createOrReplaceOptions', itemIndex, {}) as CreateOrReplaceAdditionalFields;

	const url = `${API_BASE_PATH}/${encodeURIComponent(category)}/${encodeURIComponent(key)}`;

	// Build additional fields for form
	const additionalFields: Record<string, string> = {};
	if (options.expiresAt) additionalFields.expiresAt = options.expiresAt;

	if (inputSource === 'url') {
		return await uploadViaUrl.call(this, itemIndex, url, 'PUT', additionalFields);
	} else {
		return await uploadViaBinary.call(this, itemIndex, url, 'PUT', additionalFields);
	}
}

/**
 * Download a file.
 */
async function executeDownload(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData> {
	const category = this.getNodeParameter('category', itemIndex) as string;
	const key = this.getNodeParameter('key', itemIndex) as string;

	// Get base URL from credentials
	const baseURL = await getBaseUrl(this);

	const requestOptions: IHttpRequestOptions = {
		method: 'GET' as IHttpRequestMethods,
		baseURL,
		url: `${API_BASE_PATH}/${encodeURIComponent(category)}/${encodeURIComponent(key)}`,
		encoding: 'arraybuffer',
		returnFullResponse: true,
	};

	try {
		const response = await this.helpers.httpRequestWithAuthentication.call(
			this,
			CREDENTIAL_NAME,
			requestOptions,
		);

		const contentType = (response.headers['content-type'] as string) || 'application/octet-stream';
		const contentDisposition = (response.headers['content-disposition'] as string) || '';
		let fileName = key;

		// Extract filename from content-disposition if available
		const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
		if (filenameMatch?.[1]) {
			fileName = filenameMatch[1].replace(/['"]/g, '');
		}

		const binaryData = await this.helpers.prepareBinaryData(
			Buffer.from(response.body as ArrayBuffer),
			fileName,
			contentType,
		);

		return {
			json: { category, key, fileName, mimeType: contentType },
			binary: { data: binaryData },
			pairedItem: { item: itemIndex },
		};
	} catch (error) {
		throw handleApiError(this, error, itemIndex, 'download file', 'file');
	}
}

/**
 * Delete a file.
 */
async function executeDelete(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<{ deleted: boolean }> {
	const category = this.getNodeParameter('category', itemIndex) as string;
	const key = this.getNodeParameter('key', itemIndex) as string;

	// Get base URL from credentials
	const baseURL = await getBaseUrl(this);

	const requestOptions: IHttpRequestOptions = {
		method: 'DELETE' as IHttpRequestMethods,
		baseURL,
		url: `${API_BASE_PATH}/${encodeURIComponent(category)}/${encodeURIComponent(key)}`,
	};

	try {
		await this.helpers.httpRequestWithAuthentication.call(
			this,
			CREDENTIAL_NAME,
			requestOptions,
		);
		// Return standard delete response per n8n UX guidelines
		return { deleted: true };
	} catch (error) {
		throw handleApiError(this, error, itemIndex, 'delete file', 'file');
	}
}

/**
 * Get file metadata.
 */
async function executeGetMetadata(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<FileMetadata> {
	const category = this.getNodeParameter('category', itemIndex) as string;
	const key = this.getNodeParameter('key', itemIndex) as string;

	// Get base URL from credentials
	const baseURL = await getBaseUrl(this);

	const requestOptions: IHttpRequestOptions = {
		method: 'GET' as IHttpRequestMethods,
		baseURL,
		url: `${API_BASE_PATH}/${encodeURIComponent(category)}/${encodeURIComponent(key)}/meta`,
	};

	try {
		const response = await this.helpers.httpRequestWithAuthentication.call(
			this,
			CREDENTIAL_NAME,
			requestOptions,
		);
		return response as FileMetadata;
	} catch (error) {
		throw handleApiError(this, error, itemIndex, 'get file metadata', 'file');
	}
}

/**
 * Get pre-signed download URL.
 */
async function executeGetUrl(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<FileUrlResponse> {
	const category = this.getNodeParameter('category', itemIndex) as string;
	const key = this.getNodeParameter('key', itemIndex) as string;
	const options = this.getNodeParameter('getUrlOptions', itemIndex, {}) as GetUrlAdditionalFields;

	// Get base URL from credentials
	const baseURL = await getBaseUrl(this);

	const qs: Record<string, number> = {};
	if (options.expirySeconds) qs.expirySeconds = options.expirySeconds;

	const requestOptions: IHttpRequestOptions = {
		method: 'GET' as IHttpRequestMethods,
		baseURL,
		url: `${API_BASE_PATH}/${encodeURIComponent(category)}/${encodeURIComponent(key)}/url`,
		qs: Object.keys(qs).length > 0 ? qs : undefined,
	};

	try {
		const response = await this.helpers.httpRequestWithAuthentication.call(
			this,
			CREDENTIAL_NAME,
			requestOptions,
		);
		return response as FileUrlResponse;
	} catch (error) {
		throw handleApiError(this, error, itemIndex, 'get download URL', 'file');
	}
}

/**
 * Get many files in a category with pagination.
 */
async function executeFileGetMany(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<FileListItem[]> {
	const category = this.getNodeParameter('category', itemIndex) as string;
	const returnAll = this.getNodeParameter('returnAll', itemIndex) as boolean;
	const options = this.getNodeParameter('getManyOptions', itemIndex, {}) as GetManyAdditionalFields;

	// Get base URL from credentials
	const baseURL = await getBaseUrl(this);

	if (returnAll) {
		// Paginate through all results
		const allItems: FileListItem[] = [];
		let offset = options.offset || 0;
		let hasMore = true;

		while (hasMore) {
			const qs: Record<string, string | number | boolean> = {
				limit: MAX_LIMIT_PER_REQUEST,
				offset,
			};
			if (options.prefix) qs.prefix = options.prefix;
			if (options.sortBy) qs.sortBy = options.sortBy;
			if (options.sortOrder) qs.sortOrder = options.sortOrder;
			if (options.aggregate) qs.aggregate = options.aggregate;

			const requestOptions: IHttpRequestOptions = {
				method: 'GET' as IHttpRequestMethods,
				baseURL,
				url: `${API_BASE_PATH}/${encodeURIComponent(category)}`,
				qs,
			};

			try {
				const response = await this.helpers.httpRequestWithAuthentication.call(
					this,
					CREDENTIAL_NAME,
					requestOptions,
				);

				// Handle both array and wrapped response formats
				const items = Array.isArray(response)
					? response
					: (response as { items: FileListItem[] }).items || [];

				allItems.push(...items);

				// Check if there are more pages
				hasMore = items.length === MAX_LIMIT_PER_REQUEST;
				offset += MAX_LIMIT_PER_REQUEST;
			} catch (error) {
				throw handleApiError(this, error, itemIndex, 'get many files', 'file');
			}
		}

		return allItems;
	} else {
		// Single request with limit
		const limit = this.getNodeParameter('limit', itemIndex) as number;

		const qs: Record<string, string | number | boolean> = { limit };
		if (options.offset) qs.offset = options.offset;
		if (options.prefix) qs.prefix = options.prefix;
		if (options.sortBy) qs.sortBy = options.sortBy;
		if (options.sortOrder) qs.sortOrder = options.sortOrder;
		if (options.aggregate) qs.aggregate = options.aggregate;

		const requestOptions: IHttpRequestOptions = {
			method: 'GET' as IHttpRequestMethods,
			baseURL,
			url: `${API_BASE_PATH}/${encodeURIComponent(category)}`,
			qs,
		};

		try {
			const response = await this.helpers.httpRequestWithAuthentication.call(
				this,
				CREDENTIAL_NAME,
				requestOptions,
			);

			// Handle both array and wrapped response formats
			return Array.isArray(response)
				? response
				: (response as { items: FileListItem[] }).items || [];
		} catch (error) {
			throw handleApiError(this, error, itemIndex, 'get many files', 'file');
		}
	}
}

// ============================================================================
// Category Operation Handlers
// ============================================================================

/**
 * Execute category operations.
 */
async function executeCategoryOperation(
	this: IExecuteFunctions,
	itemIndex: number,
	operation: CategoryOperation,
): Promise<unknown> {
	switch (operation) {
		case 'getMany':
			return await executeCategoryGetMany.call(this, itemIndex);
		default:
			throw new NodeOperationError(
				this.getNode(),
				`Unknown category operation: ${operation}`,
				{ itemIndex },
			);
	}
}

/**
 * Get all categories with file counts.
 */
async function executeCategoryGetMany(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<CategoryInfo[]> {
	// Get base URL from credentials
	const baseURL = await getBaseUrl(this);

	const requestOptions: IHttpRequestOptions = {
		method: 'GET' as IHttpRequestMethods,
		baseURL,
		url: API_BASE_PATH,
	};

	try {
		const response = await this.helpers.httpRequestWithAuthentication.call(
			this,
			CREDENTIAL_NAME,
			requestOptions,
		);
		return response as CategoryInfo[];
	} catch (error) {
		throw handleApiError(this, error, itemIndex, 'get categories', 'file');
	}
}

// ============================================================================
// Upload Helper Functions
// ============================================================================

/**
 * Upload file via binary data.
 */
async function uploadViaBinary(
	this: IExecuteFunctions,
	itemIndex: number,
	url: string,
	method: 'POST' | 'PUT',
	additionalFields: Record<string, string>,
): Promise<FileUploadResponse> {
	const binaryPropertyName = this.getNodeParameter('binaryPropertyName', itemIndex) as string;
	const binaryData = this.helpers.assertBinaryData(itemIndex, binaryPropertyName);
	const fileBuffer = await this.helpers.getBinaryDataBuffer(itemIndex, binaryPropertyName);

	const fileName = binaryData.fileName || 'file';
	const mimeType = binaryData.mimeType || 'application/octet-stream';

	const { body, boundary } = buildMultipartBody(fileBuffer, fileName, mimeType, additionalFields);

	// Get credentials for manual header construction
	// Note: httpRequestWithAuthentication doesn't support raw Buffer body with multipart
	const credentials = await this.getCredentials(CREDENTIAL_NAME);
	const baseUrl = (credentials.baseUrl as string) || DEFAULT_BASE_URL;

	try {
		const response = await this.helpers.httpRequest({
			method,
			url: `${baseUrl}${url}`,
			headers: {
				'Authorization': `Bearer ${credentials.apiKey}`,
				'Content-Type': `multipart/form-data; boundary=${boundary}`,
			},
			body,
			timeout: UPLOAD_TIMEOUT_MS,
		});
		return response as FileUploadResponse;
	} catch (error) {
		throw handleApiError(this, error, itemIndex, 'upload file', 'file');
	}
}

/**
 * Upload file via source URL.
 */
async function uploadViaUrl(
	this: IExecuteFunctions,
	itemIndex: number,
	url: string,
	method: 'POST' | 'PUT',
	additionalFields: Record<string, string>,
): Promise<FileUploadResponse> {
	const sourceUrl = this.getNodeParameter('sourceUrl', itemIndex) as string;

	if (!sourceUrl) {
		throw new NodeOperationError(
			this.getNode(),
			'Source URL is required',
			{ itemIndex },
		);
	}

	// Get base URL from credentials
	const baseURL = await getBaseUrl(this);

	const { body, boundary } = buildUrlMultipartBody(sourceUrl, additionalFields);

	const requestOptions: IHttpRequestOptions = {
		method: method as IHttpRequestMethods,
		baseURL,
		url,
		headers: {
			'Content-Type': `multipart/form-data; boundary=${boundary}`,
		},
		body,
		timeout: UPLOAD_TIMEOUT_MS,
	};

	try {
		const response = await this.helpers.httpRequestWithAuthentication.call(
			this,
			CREDENTIAL_NAME,
			requestOptions,
		);
		return response as FileUploadResponse;
	} catch (error) {
		throw handleApiError(this, error, itemIndex, 'upload file from URL', 'file');
	}
}

/**
 * Build multipart/form-data body for file upload.
 */
function buildMultipartBody(
	fileBuffer: Buffer,
	fileName: string,
	mimeType: string,
	additionalFields: Record<string, string>,
): { body: Buffer; boundary: string } {
	const boundary = `----n8nFormBoundary${Date.now()}${Math.random().toString(36).substring(2)}`;
	const parts: Buffer[] = [];

	// Add file part
	const filePreamble =
		`--${boundary}\r\n` +
		`Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
		`Content-Type: ${mimeType}\r\n\r\n`;
	parts.push(Buffer.from(filePreamble, 'utf8'));
	parts.push(fileBuffer);
	parts.push(Buffer.from('\r\n', 'utf8'));

	// Add additional form fields
	for (const [name, value] of Object.entries(additionalFields)) {
		if (value) {
			const fieldPart =
				`--${boundary}\r\n` +
				`Content-Disposition: form-data; name="${name}"\r\n\r\n` +
				`${value}\r\n`;
			parts.push(Buffer.from(fieldPart, 'utf8'));
		}
	}

	// Add closing boundary
	parts.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));

	return { body: Buffer.concat(parts), boundary };
}

/**
 * Build multipart/form-data body for URL upload.
 */
function buildUrlMultipartBody(
	sourceUrl: string,
	additionalFields: Record<string, string>,
): { body: Buffer; boundary: string } {
	const boundary = `----n8nFormBoundary${Date.now()}${Math.random().toString(36).substring(2)}`;
	const parts: Buffer[] = [];

	// Add sourceUrl field
	const urlPart =
		`--${boundary}\r\n` +
		`Content-Disposition: form-data; name="sourceUrl"\r\n\r\n` +
		`${sourceUrl}\r\n`;
	parts.push(Buffer.from(urlPart, 'utf8'));

	// Add additional form fields
	for (const [name, value] of Object.entries(additionalFields)) {
		if (value) {
			const fieldPart =
				`--${boundary}\r\n` +
				`Content-Disposition: form-data; name="${name}"\r\n\r\n` +
				`${value}\r\n`;
			parts.push(Buffer.from(fieldPart, 'utf8'));
		}
	}

	// Add closing boundary
	parts.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));

	return { body: Buffer.concat(parts), boundary };
}

