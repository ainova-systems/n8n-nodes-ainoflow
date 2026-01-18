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

// ============================================================================
// Type Definitions
// ============================================================================

/** Resource types */
type ResourceType = 'record' | 'category';

/** Record operations */
type RecordOperation = 'create' | 'createOrReplace' | 'update' | 'get' | 'delete' | 'getMetadata' | 'getMany';

/** Category operations */
type CategoryOperation = 'getMany';

/** Data specification mode */
type SpecifyDataMode = 'fieldsBelow' | 'json';

/** Sort field options */
type SortByField = 'key' | 'createdAt' | 'updatedAt' | 'size';

/** Sort order options */
type SortOrder = 'asc' | 'desc';

/** Data field pair from fixedCollection */
interface DataFieldPair {
	name: string;
	value: string;
}

/** Additional fields for create operation */
interface CreateAdditionalFields {
	key?: string;
	expiresAt?: string;
	expiresMs?: number;
}

/** Additional fields for createOrReplace/update operations */
interface UpdateAdditionalFields {
	expiresAt?: string;
	expiresMs?: number;
}

/** Additional fields for getMany operation */
interface GetManyAdditionalFields {
	sortBy?: SortByField;
	sortOrder?: SortOrder;
	aggregate?: boolean;
}

/** API response for record mutations */
interface RecordMutationResponse {
	category: string;
	key: string;
	version: number;
	etag: string;
	expiresAt: string | null;
}

/** API response for record metadata */
interface RecordMetadataResponse {
	category: string;
	key: string;
	createdAt: string;
	updatedAt: string;
	expiresAt: string | null;
	version: number;
	etag: string;
	size: number;
}

/** Item in list response */
interface RecordListItem {
	category: string;
	key: string;
	value: JsonObject;
	size: number;
	createdAt: string;
	updatedAt: string;
	expiresAt: string | null;
}

/** Category item in list response */
interface CategoryItem {
	category: string;
	count: number;
}

// ============================================================================
// Constants
// ============================================================================

/** Sort by field options */
const SORT_BY_OPTIONS = [
	{ name: 'Created At', value: 'createdAt', description: 'Sort by creation date' },
	{ name: 'Key', value: 'key', description: 'Sort by record key' },
	{ name: 'Size', value: 'size', description: 'Sort by record size' },
	{ name: 'Updated At', value: 'updatedAt', description: 'Sort by last update date' },
] as const;

/** Sort order options */
const SORT_ORDER_OPTIONS = [
	{ name: 'Ascending', value: 'asc', description: 'Sort from lowest to highest' },
	{ name: 'Descending', value: 'desc', description: 'Sort from highest to lowest' },
] as const;

/** Credential type name */
const CREDENTIAL_NAME = 'ainoflowApi';

/** API base path */
const API_BASE_PATH = '/api/v1/storage/json';

/** Maximum limit per request for Return All pagination */
const MAX_LIMIT_PER_REQUEST = 1000;

// ============================================================================
// Node Implementation
// ============================================================================

export class AinoflowStorage implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Ainoflow Storage',
		name: 'ainoflowStorage',
		icon: { light: 'file:../../icons/storage.svg', dark: 'file:../../icons/storage.dark.svg' },
		group: ['output'],
		version: 1,
		subtitle: '={{$parameter["resource"] + ": " + $parameter["operation"]}}',
		description: 'Store and retrieve JSON documents in Ainoflow key-value storage',
		defaults: {
			name: 'Ainoflow Storage',
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
			// Resource selector
			// ----------------------------------------------------------------
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Record',
						value: 'record',
						description: 'Operations on individual JSON records',
					},
					{
						name: 'Category',
						value: 'category',
						description: 'Operations on record categories',
					},
				],
				default: 'record',
			},

			// ----------------------------------------------------------------
			// Record Operations
			// ----------------------------------------------------------------
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['record'],
					},
				},
				options: [
					{
						name: 'Create',
						value: 'create',
						description: 'Create new JSON record (fails if exists)',
						action: 'Create a record',
					},
					{
						name: 'Create or Replace',
						value: 'createOrReplace',
						description: 'Create new record or replace existing (upsert)',
						action: 'Create or replace a record',
					},
					{
						name: 'Delete',
						value: 'delete',
						description: 'Delete JSON record',
						action: 'Delete a record',
					},
					{
						name: 'Get',
						value: 'get',
						description: 'Retrieve JSON record by category and key',
						action: 'Get a record',
					},
					{
						name: 'Get Many',
						value: 'getMany',
						description: 'Get many records in category',
						action: 'Get many records',
					},
					{
						name: 'Get Metadata',
						value: 'getMetadata',
						description: 'Get record metadata without retrieving content',
						action: 'Get record metadata',
					},
					{
						name: 'Update',
						value: 'update',
						description: 'Partially update record fields (JSON Merge Patch)',
						action: 'Update a record',
					},
				],
				default: 'get',
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
						description: 'Get many categories with record counts',
						action: 'Get many categories',
					},
				],
				default: 'getMany',
			},

			// ----------------------------------------------------------------
			// Common Parameters: Category
			// ----------------------------------------------------------------
			{
				displayName: 'Category',
				name: 'category',
				type: 'string',
				displayOptions: {
					show: {
						resource: ['record'],
					},
				},
				default: '',
				required: true,
				placeholder: 'e.g., invoices',
				description: 'Category (namespace) for the record',
			},

			// ----------------------------------------------------------------
			// Key parameter (for operations that need it)
			// ----------------------------------------------------------------
			{
				displayName: 'Key',
				name: 'key',
				type: 'string',
				displayOptions: {
					show: {
						resource: ['record'],
						operation: ['createOrReplace', 'update', 'get', 'delete', 'getMetadata'],
					},
				},
				default: '',
				required: true,
				placeholder: 'e.g., inv-12345',
				description: 'Unique key of the record',
			},

			// ----------------------------------------------------------------
			// Specify Data (for create/createOrReplace/update)
			// ----------------------------------------------------------------
			{
				displayName: 'Specify Data',
				name: 'specifyData',
				type: 'options',
				displayOptions: {
					show: {
						resource: ['record'],
						operation: ['create', 'createOrReplace', 'update'],
					},
				},
				options: [
					{
						name: 'Using Fields Below',
						value: 'fieldsBelow',
						description: 'Enter key-value pairs',
					},
					{
						name: 'Using JSON',
						value: 'json',
						description: 'Enter raw JSON object or array',
					},
				],
				default: 'fieldsBelow',
			},

			// ----------------------------------------------------------------
			// Data Fields (fixedCollection for fieldsBelow mode)
			// ----------------------------------------------------------------
			{
				displayName: 'Data Fields',
				name: 'dataFields',
				type: 'fixedCollection',
				typeOptions: {
					multipleValues: true,
				},
				displayOptions: {
					show: {
						resource: ['record'],
						operation: ['create', 'createOrReplace', 'update'],
						specifyData: ['fieldsBelow'],
					},
				},
				default: {},
				placeholder: 'Add Field',
				options: [
					{
						name: 'field',
						displayName: 'Field',
						values: [
							{
								displayName: 'Name',
								name: 'name',
								type: 'string',
								default: '',
								description: 'Field name',
							},
							{
								displayName: 'Value',
								name: 'value',
								type: 'string',
								default: '',
								description: 'Field value (supports expressions)',
							},
						],
					},
				],
			},

			// ----------------------------------------------------------------
			// JSON Data (for json mode)
			// ----------------------------------------------------------------
			{
				displayName: 'JSON',
				name: 'dataJson',
				type: 'json',
				displayOptions: {
					show: {
						resource: ['record'],
						operation: ['create', 'createOrReplace', 'update'],
						specifyData: ['json'],
					},
				},
				default: '{}',
				description: 'JSON object or array to store',
			},

			// ----------------------------------------------------------------
			// Return All / Limit for getMany
			// ----------------------------------------------------------------
			{
				displayName: 'Return All',
				name: 'returnAll',
				type: 'boolean',
				displayOptions: {
					show: {
						resource: ['record'],
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
				typeOptions: {
					minValue: 1,
					maxValue: 1000,
				},
				displayOptions: {
					show: {
						resource: ['record'],
						operation: ['getMany'],
						returnAll: [false],
					},
				},
				default: 50,
				description: 'Max number of results to return',
			},

			// ----------------------------------------------------------------
			// Additional Fields: Create
			// ----------------------------------------------------------------
			{
				displayName: 'Additional Fields',
				name: 'additionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				displayOptions: {
					show: {
						resource: ['record'],
						operation: ['create'],
					},
				},
				default: {},
				options: [
					// Alphabetized by displayName
					{
						displayName: 'Expires At',
						name: 'expiresAt',
						type: 'dateTime',
						default: '',
						description: 'Record expiration date (ISO 8601)',
					},
					{
						displayName: 'Expires In (Ms)',
						name: 'expiresMs',
						type: 'number',
						default: 0,
						description: 'Expiration in milliseconds from now',
					},
					{
						displayName: 'Key',
						name: 'key',
						type: 'string',
						default: '',
						placeholder: 'e.g., inv-12345',
						description: 'Custom key. If empty, UUID is generated.',
					},
				],
			},

			// ----------------------------------------------------------------
			// Additional Fields: Create or Replace / Update
			// ----------------------------------------------------------------
			{
				displayName: 'Additional Fields',
				name: 'additionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				displayOptions: {
					show: {
						resource: ['record'],
						operation: ['createOrReplace'],
					},
				},
				default: {},
				options: [
					// Alphabetized by displayName
					{
						displayName: 'Expires At',
						name: 'expiresAt',
						type: 'dateTime',
						default: '',
						description: 'Record expiration date (ISO 8601)',
					},
					{
						displayName: 'Expires In (Ms)',
						name: 'expiresMs',
						type: 'number',
						default: 0,
						description: 'Expiration in milliseconds from now',
					},
				],
			},

			// ----------------------------------------------------------------
			// Additional Fields: Get Many (Record)
			// ----------------------------------------------------------------
			{
				displayName: 'Additional Fields',
				name: 'additionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				displayOptions: {
					show: {
						resource: ['record'],
						operation: ['getMany'],
					},
				},
				default: {},
				options: [
					// Alphabetized by displayName
					{
						displayName: 'Return Full Metadata',
						name: 'aggregate',
						type: 'boolean',
						default: false,
						description: 'Whether to return full record metadata',
					},
					{
						displayName: 'Sort By',
						name: 'sortBy',
						type: 'options',
						options: [...SORT_BY_OPTIONS],
						default: '',
						description: 'Field to sort results by (default: Created At)',
					},
					{
						displayName: 'Sort Order',
						name: 'sortOrder',
						type: 'options',
						options: [...SORT_ORDER_OPTIONS],
						default: '',
						description: 'Order of sorting (default: Ascending)',
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
		const operation = this.getNodeParameter('operation', 0) as RecordOperation | CategoryOperation;

		// Process each input item
		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				let responseData: unknown;

				if (resource === 'record') {
					responseData = await executeRecordOperation.call(
						this,
						itemIndex,
						operation as RecordOperation,
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
// Record Operation Handlers
// ============================================================================

/**
 * Execute record operations.
 */
async function executeRecordOperation(
	this: IExecuteFunctions,
	itemIndex: number,
	operation: RecordOperation,
): Promise<unknown> {
	switch (operation) {
		case 'create':
			return await executeCreate.call(this, itemIndex);
		case 'createOrReplace':
			return await executeCreateOrReplace.call(this, itemIndex);
		case 'update':
			return await executeUpdate.call(this, itemIndex);
		case 'get':
			return await executeGet.call(this, itemIndex);
		case 'delete':
			return await executeDelete.call(this, itemIndex);
		case 'getMetadata':
			return await executeGetMetadata.call(this, itemIndex);
		case 'getMany':
			return await executeRecordGetMany.call(this, itemIndex);
		default:
			throw new NodeOperationError(
				this.getNode(),
				`Unknown record operation: ${operation}`,
				{ itemIndex },
			);
	}
}

/**
 * Create a new record (fails if exists).
 */
async function executeCreate(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<RecordMutationResponse> {
	const category = this.getNodeParameter('category', itemIndex) as string;
	const additionalFields = this.getNodeParameter('additionalFields', itemIndex) as CreateAdditionalFields;

	// Build data from user input
	const data = buildDataFromInput.call(this, itemIndex);

	// Build URL - with or without key
	let url = `${API_BASE_PATH}/${encodeURIComponent(category)}`;
	if (additionalFields.key) {
		url += `/${encodeURIComponent(additionalFields.key)}`;
	}

	// Build query parameters for TTL
	const qs = buildTtlQueryParams(additionalFields);

	const requestOptions: IHttpRequestOptions = {
		method: 'POST' as IHttpRequestMethods,
		url,
		body: data,
		qs: Object.keys(qs).length > 0 ? qs : undefined,
	};

	try {
		const response = await this.helpers.httpRequestWithAuthentication.call(
			this,
			CREDENTIAL_NAME,
			requestOptions,
		);
		return response as RecordMutationResponse;
	} catch (error) {
		throw handleApiError.call(this, error, itemIndex, 'create record');
	}
}

/**
 * Create or replace a record (upsert).
 */
async function executeCreateOrReplace(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<RecordMutationResponse> {
	const category = this.getNodeParameter('category', itemIndex) as string;
	const key = this.getNodeParameter('key', itemIndex) as string;
	const additionalFields = this.getNodeParameter('additionalFields', itemIndex) as UpdateAdditionalFields;

	// Build data from user input
	const data = buildDataFromInput.call(this, itemIndex);

	// Build query parameters for TTL
	const qs = buildTtlQueryParams(additionalFields);

	const requestOptions: IHttpRequestOptions = {
		method: 'PUT' as IHttpRequestMethods,
		url: `${API_BASE_PATH}/${encodeURIComponent(category)}/${encodeURIComponent(key)}`,
		body: data,
		qs: Object.keys(qs).length > 0 ? qs : undefined,
	};

	try {
		const response = await this.helpers.httpRequestWithAuthentication.call(
			this,
			CREDENTIAL_NAME,
			requestOptions,
		);
		return response as RecordMutationResponse;
	} catch (error) {
		throw handleApiError.call(this, error, itemIndex, 'create or replace record');
	}
}

/**
 * Update a record using JSON Merge Patch (RFC 7386).
 */
async function executeUpdate(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<RecordMutationResponse> {
	const category = this.getNodeParameter('category', itemIndex) as string;
	const key = this.getNodeParameter('key', itemIndex) as string;

	// Build data from user input
	const data = buildDataFromInput.call(this, itemIndex);

	const requestOptions: IHttpRequestOptions = {
		method: 'PATCH' as IHttpRequestMethods,
		url: `${API_BASE_PATH}/${encodeURIComponent(category)}/${encodeURIComponent(key)}`,
		body: data,
	};

	try {
		const response = await this.helpers.httpRequestWithAuthentication.call(
			this,
			CREDENTIAL_NAME,
			requestOptions,
		);
		return response as RecordMutationResponse;
	} catch (error) {
		throw handleApiError.call(this, error, itemIndex, 'update record');
	}
}

/**
 * Get a record by category and key.
 */
async function executeGet(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<JsonObject> {
	const category = this.getNodeParameter('category', itemIndex) as string;
	const key = this.getNodeParameter('key', itemIndex) as string;

	const requestOptions: IHttpRequestOptions = {
		method: 'GET' as IHttpRequestMethods,
		url: `${API_BASE_PATH}/${encodeURIComponent(category)}/${encodeURIComponent(key)}`,
	};

	try {
		const response = await this.helpers.httpRequestWithAuthentication.call(
			this,
			CREDENTIAL_NAME,
			requestOptions,
		);
		return response as JsonObject;
	} catch (error) {
		throw handleApiError.call(this, error, itemIndex, 'get record');
	}
}

/**
 * Delete a record.
 */
async function executeDelete(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<{ deleted: boolean }> {
	const category = this.getNodeParameter('category', itemIndex) as string;
	const key = this.getNodeParameter('key', itemIndex) as string;

	const requestOptions: IHttpRequestOptions = {
		method: 'DELETE' as IHttpRequestMethods,
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
		throw handleApiError.call(this, error, itemIndex, 'delete record');
	}
}

/**
 * Get record metadata without content.
 */
async function executeGetMetadata(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<RecordMetadataResponse> {
	const category = this.getNodeParameter('category', itemIndex) as string;
	const key = this.getNodeParameter('key', itemIndex) as string;

	const requestOptions: IHttpRequestOptions = {
		method: 'GET' as IHttpRequestMethods,
		url: `${API_BASE_PATH}/${encodeURIComponent(category)}/${encodeURIComponent(key)}/meta`,
	};

	try {
		const response = await this.helpers.httpRequestWithAuthentication.call(
			this,
			CREDENTIAL_NAME,
			requestOptions,
		);
		return response as RecordMetadataResponse;
	} catch (error) {
		throw handleApiError.call(this, error, itemIndex, 'get record metadata');
	}
}

/**
 * Get many records in a category with pagination.
 */
async function executeRecordGetMany(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<RecordListItem[]> {
	const category = this.getNodeParameter('category', itemIndex) as string;
	const returnAll = this.getNodeParameter('returnAll', itemIndex) as boolean;
	const additionalFields = this.getNodeParameter('additionalFields', itemIndex) as GetManyAdditionalFields;

	if (returnAll) {
		// Paginate through all results
		const allItems: RecordListItem[] = [];
		let page = 1;
		let hasMore = true;

		while (hasMore) {
			const qs: Record<string, string | number | boolean> = {
				page,
				limit: MAX_LIMIT_PER_REQUEST,
			};

			if (additionalFields.sortBy) qs.sortBy = additionalFields.sortBy;
			if (additionalFields.sortOrder) qs.sortOrder = additionalFields.sortOrder;
			if (additionalFields.aggregate) qs.aggregate = additionalFields.aggregate;

			const requestOptions: IHttpRequestOptions = {
				method: 'GET' as IHttpRequestMethods,
				url: `${API_BASE_PATH}/${encodeURIComponent(category)}`,
				qs,
			};

			try {
				const response = await this.helpers.httpRequestWithAuthentication.call(
					this,
					CREDENTIAL_NAME,
					requestOptions,
				);

				// Handle both array and aggregated response formats
				const items = Array.isArray(response)
					? response
					: (response as { items: RecordListItem[] }).items || [];

				allItems.push(...items);

				// Check if there are more pages
				hasMore = items.length === MAX_LIMIT_PER_REQUEST;
				page++;
			} catch (error) {
				throw handleApiError.call(this, error, itemIndex, 'get many records');
			}
		}

		return allItems;
	} else {
		// Single request with limit
		const limit = this.getNodeParameter('limit', itemIndex) as number;

		const qs: Record<string, string | number | boolean> = {
			page: 1,
			limit,
		};

		if (additionalFields.sortBy) qs.sortBy = additionalFields.sortBy;
		if (additionalFields.sortOrder) qs.sortOrder = additionalFields.sortOrder;
		if (additionalFields.aggregate) qs.aggregate = additionalFields.aggregate;

		const requestOptions: IHttpRequestOptions = {
			method: 'GET' as IHttpRequestMethods,
			url: `${API_BASE_PATH}/${encodeURIComponent(category)}`,
			qs,
		};

		try {
			const response = await this.helpers.httpRequestWithAuthentication.call(
				this,
				CREDENTIAL_NAME,
				requestOptions,
			);

			// Handle both array and aggregated response formats
			return Array.isArray(response)
				? response
				: (response as { items: RecordListItem[] }).items || [];
		} catch (error) {
			throw handleApiError.call(this, error, itemIndex, 'get many records');
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
 * Get all categories with record counts.
 */
async function executeCategoryGetMany(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<CategoryItem[]> {
	const requestOptions: IHttpRequestOptions = {
		method: 'GET' as IHttpRequestMethods,
		url: API_BASE_PATH,
	};

	try {
		const response = await this.helpers.httpRequestWithAuthentication.call(
			this,
			CREDENTIAL_NAME,
			requestOptions,
		);
		return response as CategoryItem[];
	} catch (error) {
		throw handleApiError.call(this, error, itemIndex, 'get categories');
	}
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Build data object from user input (fieldsBelow or json mode).
 */
function buildDataFromInput(
	this: IExecuteFunctions,
	itemIndex: number,
): JsonObject {
	const specifyData = this.getNodeParameter('specifyData', itemIndex) as SpecifyDataMode;

	if (specifyData === 'json') {
		const dataJson = this.getNodeParameter('dataJson', itemIndex) as string | object;

		// Parse if string, otherwise use as-is
		let data: unknown;
		if (typeof dataJson === 'string') {
			try {
				data = JSON.parse(dataJson);
			} catch {
				throw new NodeOperationError(
					this.getNode(),
					'Invalid JSON in data field',
					{
						itemIndex,
						description: 'The JSON field must contain valid JSON',
					},
				);
			}
		} else {
			data = dataJson;
		}

		// Validate it's an object or array
		if (typeof data !== 'object' || data === null) {
			throw new NodeOperationError(
				this.getNode(),
				'JSON must be an object or array',
				{
					itemIndex,
					description: 'Primitive values (strings, numbers, booleans) are not allowed',
				},
			);
		}

		return data as JsonObject;
	} else {
		// fieldsBelow mode - convert field pairs to object
		const dataFields = this.getNodeParameter('dataFields', itemIndex) as {
			field?: DataFieldPair[];
		};

		const result: Record<string, string> = {};
		if (dataFields.field) {
			for (const field of dataFields.field) {
				if (field.name) {
					result[field.name] = field.value;
				}
			}
		}

		return result;
	}
}

/**
 * Build TTL query parameters from additional fields.
 */
function buildTtlQueryParams(
	additionalFields: CreateAdditionalFields | UpdateAdditionalFields,
): Record<string, string | number> {
	const qs: Record<string, string | number> = {};

	if (additionalFields.expiresAt) {
		qs.expiresAt = additionalFields.expiresAt;
	}
	if (additionalFields.expiresMs && additionalFields.expiresMs > 0) {
		qs.expiresMs = additionalFields.expiresMs;
	}

	return qs;
}

// ============================================================================
// Error Handling
// ============================================================================

/**
 * Handle API errors and convert to appropriate NodeApiError.
 */
function handleApiError(
	this: IExecuteFunctions,
	error: unknown,
	itemIndex: number,
	operation: string,
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
	const apiMessage = httpError.response?.body?.error?.message || httpError.message || 'Unknown error';

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
			message = 'Record not found';
			description = 'The specified record does not exist';
			break;
		case 409:
			message = 'Record already exists';
			description = apiMessage;
			break;
		case 429:
			message = 'Storage limit reached';
			description = 'Storage API count limit reached for current scope';
			break;
		case 500:
		case 502:
		case 503:
			message = 'Server error';
			description = `Ainoflow API error: ${apiMessage}`;
			break;
		default:
			message = `Failed to ${operation}`;
			description = apiMessage;
	}

	return new NodeApiError(
		this.getNode(),
		error as JsonObject,
		{
			message,
			description,
			httpCode: statusCode?.toString(),
			itemIndex,
		},
	);
}
