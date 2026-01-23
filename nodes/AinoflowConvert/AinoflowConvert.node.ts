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

/** Input source for document conversion */
type InputSource = 'binary' | 'url';

/** Response mode for conversion results */
type ResponseMode = 'direct' | 'persisted' | 'polling' | 'webhook';

/** Processing model for conversion */
type ProcessingModel = 'auto' | 'paddleocr' | 'tesseract' | 'whispersmall' | 'whispertiny' | 'whisperbase';

/** Output format types */
type OutputFormat = 'text' | 'pdf';

/** Additional fields for convert operation */
interface ConvertAdditionalFields {
	response?: ResponseMode;
	models?: ProcessingModel;
	webhookUrl?: string;
	reference?: string;
	jobExpiryInMinutes?: number;
}

/** File content result in direct mode */
interface ContentResult {
	text?: string;
	pdf?: string;
}

/** File URL result in persisted/polling modes */
interface FileUrlResult {
	url: string;
	expiration: string;
}

/** File result object with optional outputs */
interface FileResult {
	text?: FileUrlResult;
	pdf?: FileUrlResult;
	models?: string;
}

/** API response for convert operations */
interface ConvertApiResponse {
	id: string;
	status: string;
	reference?: string;
	models?: string;
	processingTimeInSeconds?: number;
	responseMode?: string;
	content?: ContentResult[];
	files?: FileResult[];
	error?: {
		message: string;
	};
}

/** API response for job status */
interface JobStatusResponse {
	id: string;
	status: string;
	reference?: string;
	models?: string;
	responseMode?: string;
	error?: string;
	createdAt?: string;
	startedAt?: string;
	completedAt?: string;
	expiryAt?: string;
	processingTimeInSeconds?: number;
	files?: FileResult[];
}

/** Simplified job status response (essential fields only) */
interface SimplifiedJobStatusResponse {
	id: string;
	status: string;
	processingTimeInSeconds?: number;
	files?: FileResult[];
	error?: string;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Supported languages for OCR and transcription.
 * 60 languages organized by region.
 */
const LANGUAGE_OPTIONS = [
	// European Languages (41)
	{ name: 'Albanian', value: 'sq' },
	{ name: 'Basque', value: 'eu' },
	{ name: 'Belarusian', value: 'be' },
	{ name: 'Bosnian', value: 'bs' },
	{ name: 'Breton', value: 'br' },
	{ name: 'Bulgarian', value: 'bg' },
	{ name: 'Catalan', value: 'ca' },
	{ name: 'Croatian', value: 'hr' },
	{ name: 'Czech', value: 'cs' },
	{ name: 'Danish', value: 'da' },
	{ name: 'Dutch', value: 'nl' },
	{ name: 'English', value: 'en' },
	{ name: 'Estonian', value: 'et' },
	{ name: 'Finnish', value: 'fi' },
	{ name: 'French', value: 'fr' },
	{ name: 'Galician', value: 'gl' },
	{ name: 'German', value: 'de' },
	{ name: 'Greek', value: 'el' },
	{ name: 'Hungarian', value: 'hu' },
	{ name: 'Icelandic', value: 'is' },
	{ name: 'Irish', value: 'ga' },
	{ name: 'Italian', value: 'it' },
	{ name: 'Latvian', value: 'lv' },
	{ name: 'Lithuanian', value: 'lt' },
	{ name: 'Luxembourgish', value: 'lb' },
	{ name: 'Macedonian', value: 'mk' },
	{ name: 'Maltese', value: 'mt' },
	{ name: 'Norwegian', value: 'no' },
	{ name: 'Polish', value: 'pl' },
	{ name: 'Portuguese', value: 'pt' },
	{ name: 'Romanian', value: 'ro' },
	{ name: 'Russian', value: 'ru' },
	{ name: 'Scottish Gaelic', value: 'gd' },
	{ name: 'Serbian', value: 'sr' },
	{ name: 'Slovak', value: 'sk' },
	{ name: 'Slovenian', value: 'sl' },
	{ name: 'Spanish', value: 'es' },
	{ name: 'Swedish', value: 'sv' },
	{ name: 'Ukrainian', value: 'uk' },
	{ name: 'Welsh', value: 'cy' },
	// Asian Languages (15)
	{ name: 'Assamese', value: 'as' },
	{ name: 'Bengali', value: 'bn' },
	{ name: 'Cebuano', value: 'ceb' },
	{ name: 'Chinese (Simplified)', value: 'zh-cn' },
	{ name: 'Chinese (Traditional)', value: 'zh-tw' },
	{ name: 'Hindi', value: 'hi' },
	{ name: 'Japanese', value: 'ja' },
	{ name: 'Korean', value: 'ko' },
	{ name: 'Punjabi', value: 'pa' },
	{ name: 'Tamil', value: 'ta' },
	{ name: 'Telugu', value: 'te' },
	{ name: 'Thai', value: 'th' },
	{ name: 'Tibetan', value: 'bo' },
	{ name: 'Urdu', value: 'ur' },
	{ name: 'Vietnamese', value: 'vi' },
	// Middle Eastern Languages (3)
	{ name: 'Arabic', value: 'ar' },
	{ name: 'Azerbaijani', value: 'az' },
	{ name: 'Turkish', value: 'tr' },
	// African Languages (2)
	{ name: 'Amharic', value: 'am' },
	{ name: 'Swahili', value: 'sw' },
] as const;

/** Processing model options */
const MODEL_OPTIONS = [
	{ name: 'Auto', value: 'auto', description: 'Auto-select based on file type' },
	{ name: 'PaddleOCR', value: 'paddleocr', description: 'PaddleOCR engine for images' },
	{ name: 'Tesseract', value: 'tesseract', description: 'Tesseract OCR engine for PDFs' },
	{ name: 'Whisper Small', value: 'whispersmall', description: 'Audio transcription (small model)' },
	{ name: 'Whisper Tiny', value: 'whispertiny', description: 'Audio transcription (tiny model)' },
	{ name: 'Whisper Base', value: 'whisperbase', description: 'Audio transcription (base model)' },
] as const;

/** Output format options */
const OUTPUT_OPTIONS = [
	{ name: 'Text', value: 'text' },
	{ name: 'PDF', value: 'pdf' },
] as const;

/** Response mode options */
const RESPONSE_MODE_OPTIONS = [
	{ name: 'Direct', value: 'direct', description: 'Wait and return content inline' },
	{ name: 'Persisted', value: 'persisted', description: 'Wait and return download URLs' },
	{ name: 'Polling', value: 'polling', description: 'Return job ID immediately' },
	{ name: 'Webhook', value: 'webhook', description: 'Notify webhook URL when complete' },
] as const;

/** Default timeout for API requests (10 minutes for large files) */
const REQUEST_TIMEOUT_MS = 600000;

/** Default job expiry in minutes (24 hours) */
const DEFAULT_JOB_EXPIRY_MINUTES = 1440;

// ============================================================================
// Node Implementation
// ============================================================================

export class AinoflowConvert implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Ainoflow Convert',
		name: 'ainoflowConvert',
		icon: { light: 'file:../../icons/convert.svg', dark: 'file:../../icons/convert.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description: 'Extract text or convert to PDF from documents, images, and audio (OCR & transcription)',
		defaults: {
			name: 'Ainoflow Convert',
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
			// Operation selector
			// ----------------------------------------------------------------
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Convert File',
						value: 'convert',
						description: 'Extract text or convert to PDF from document, image, or audio',
						action: 'Convert file to text or PDF',
					},
					{
						name: 'Get Result',
						value: 'getResult',
						description: 'Get result of conversion job',
						action: 'Get result',
					},
				],
				default: 'convert',
			},

			// ----------------------------------------------------------------
			// Convert Operation: Input Source
			// ----------------------------------------------------------------
			{
				displayName: 'Input Source',
				name: 'inputSource',
				type: 'options',
				displayOptions: {
					show: {
						operation: ['convert'],
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

			// Binary property name (shown for binary input)
			{
				displayName: 'Binary Property',
				name: 'binaryPropertyName',
				type: 'string',
				displayOptions: {
					show: {
						operation: ['convert'],
						inputSource: ['binary'],
					},
				},
				default: 'data',
				required: true,
				description: 'Name of binary property containing file',
			},

			// Source URL (shown for URL input)
			{
				displayName: 'Source URL',
				name: 'sourceUrl',
				type: 'string',
				displayOptions: {
					show: {
						operation: ['convert'],
						inputSource: ['url'],
					},
				},
				default: '',
				required: true,
				placeholder: 'e.g. https://example.com/document.pdf',
				description: 'URL to download document from',
			},

			// ----------------------------------------------------------------
			// Convert Operation: Languages (multiOptions)
			// ----------------------------------------------------------------
			{
				displayName: 'Languages',
				name: 'languages',
				type: 'multiOptions',
				displayOptions: {
					show: {
						operation: ['convert'],
					},
				},
				options: [...LANGUAGE_OPTIONS],
				default: ['en'],
				required: true,
				description: 'Languages in document (required for images, PDFs, and audio)',
			},

			// ----------------------------------------------------------------
			// Convert Operation: Output formats
			// ----------------------------------------------------------------
			{
				displayName: 'Outputs',
				name: 'outputs',
				type: 'multiOptions',
				displayOptions: {
					show: {
						operation: ['convert'],
					},
				},
				options: [...OUTPUT_OPTIONS],
				default: ['text'],
				required: true,
				description: 'Output formats to generate',
			},

			// ----------------------------------------------------------------
			// Convert Operation: Additional Fields
			// ----------------------------------------------------------------
			{
				displayName: 'Additional Fields',
				name: 'additionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				displayOptions: {
					show: {
						operation: ['convert'],
					},
				},
				default: {},
				options: [
					// Alphabetized by displayName per n8n lint rules
					{
						displayName: 'Model',
						name: 'models',
						type: 'options',
						options: [...MODEL_OPTIONS],
						default: '',
						description: 'Processing model to use (default: Auto)',
					},
					{
						displayName: 'Reference',
						name: 'reference',
						type: 'string',
						default: '',
						description: 'Custom reference ID for tracking',
					},
					{
						displayName: 'Response Mode',
						name: 'response',
						type: 'options',
						options: [...RESPONSE_MODE_OPTIONS],
						default: '',
						description: 'How to receive results (default: Persisted)',
					},
					{
						displayName: 'Result Expiry (Minutes)',
						name: 'jobExpiryInMinutes',
						type: 'number',
						typeOptions: {
							minValue: 1,
							maxValue: 10080,
						},
						default: DEFAULT_JOB_EXPIRY_MINUTES,
						description: 'Minutes until conversion results expire (default 24h)',
					},
					{
						displayName: 'Webhook URL',
						name: 'webhookUrl',
						type: 'string',
						default: '',
						placeholder: 'e.g. https://example.com/webhook',
						description: 'URL to notify when processing is complete (webhook mode only)',
						displayOptions: {
							show: {
								response: ['webhook'],
							},
						},
					},
				],
			},

			// ----------------------------------------------------------------
			// Get Result Operation: Job ID
			// ----------------------------------------------------------------
			{
				displayName: 'Job ID',
				name: 'jobId',
				type: 'string',
				displayOptions: {
					show: {
						operation: ['getResult'],
					},
				},
				default: '',
				required: true,
				placeholder: 'e.g. 550e8400-e29b-41d4-a716-446655440000',
				description: 'Job ID returned from convert operation',
			},

			// ----------------------------------------------------------------
			// Get Result Operation: Simplify
			// ----------------------------------------------------------------
			{
				displayName: 'Simplify',
				name: 'simplify',
				type: 'boolean',
				displayOptions: {
					show: {
						operation: ['getResult'],
					},
				},
				default: true,
				description: 'Whether to return simplified response with essential fields only',
			},
		],
	};

	// ========================================================================
	// Execute Method
	// ========================================================================

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const operation = this.getNodeParameter('operation', 0) as string;

		// Process each input item
		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				let responseData: ConvertApiResponse | JobStatusResponse | SimplifiedJobStatusResponse;

				if (operation === 'convert') {
					responseData = await executeConvert.call(this, itemIndex);
				} else if (operation === 'getResult') {
					responseData = await executeGetResult.call(this, itemIndex);
				} else {
					throw new NodeOperationError(
						this.getNode(),
						`Unknown operation: ${operation}`,
						{ itemIndex },
					);
				}

				// Add successful result with pairedItem tracking
				returnData.push({
					json: responseData as unknown as JsonObject,
					pairedItem: { item: itemIndex },
				});
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
// Operation Handlers
// ============================================================================

/**
 * Execute the Convert operation.
 * Handles both binary file upload and URL submission.
 */
async function executeConvert(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<ConvertApiResponse> {
	const inputSource = this.getNodeParameter('inputSource', itemIndex) as InputSource;
	const languages = this.getNodeParameter('languages', itemIndex) as string[];
	const outputs = this.getNodeParameter('outputs', itemIndex) as OutputFormat[];
	const additionalFields = this.getNodeParameter('additionalFields', itemIndex) as ConvertAdditionalFields;

	// Validate required fields
	if (languages.length === 0) {
		throw new NodeOperationError(
			this.getNode(),
			'At least one language must be selected',
			{
				itemIndex,
				description: 'Languages are required for OCR and audio transcription',
			},
		);
	}

	if (outputs.length === 0) {
		throw new NodeOperationError(
			this.getNode(),
			'At least one output format must be selected',
			{ itemIndex },
		);
	}

	// Route to appropriate submission method
	if (inputSource === 'url') {
		return await submitViaUrl.call(this, itemIndex, languages, outputs, additionalFields);
	} else {
		return await submitViaBinary.call(this, itemIndex, languages, outputs, additionalFields);
	}
}

/**
 * Submit document via URL for processing.
 */
async function submitViaUrl(
	this: IExecuteFunctions,
	itemIndex: number,
	languages: string[],
	outputs: OutputFormat[],
	additionalFields: ConvertAdditionalFields,
): Promise<ConvertApiResponse> {
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

	// Build request body with defaults
	const body: Record<string, unknown> = {
		sourceUrl,
		languages: languages.join(','),
		outputs: outputs.join(','),
		response: additionalFields.response || 'persisted',
		models: additionalFields.models || 'auto',
	};

	// Add optional fields
	if (additionalFields.webhookUrl) {
		body.webhookUrl = additionalFields.webhookUrl;
	}
	if (additionalFields.reference) {
		body.reference = additionalFields.reference;
	}
	if (additionalFields.jobExpiryInMinutes !== undefined) {
		body.jobExpiryInMinutes = additionalFields.jobExpiryInMinutes;
	}

	const requestOptions: IHttpRequestOptions = {
		method: 'POST' as IHttpRequestMethods,
		baseURL,
		url: '/api/v1/convert/submit-url',
		body,
		timeout: REQUEST_TIMEOUT_MS,
	};

	try {
		const response = await this.helpers.httpRequestWithAuthentication.call(
			this,
			CREDENTIAL_NAME,
			requestOptions,
		);
		return response as ConvertApiResponse;
	} catch (error) {
		throw handleApiError(this, error, itemIndex, 'submit document via URL', 'job');
	}
}

/**
 * Submit binary file for processing.
 * Constructs multipart/form-data manually for cloud compatibility.
 */
async function submitViaBinary(
	this: IExecuteFunctions,
	itemIndex: number,
	languages: string[],
	outputs: OutputFormat[],
	additionalFields: ConvertAdditionalFields,
): Promise<ConvertApiResponse> {
	const binaryPropertyName = this.getNodeParameter('binaryPropertyName', itemIndex) as string;

	// Validate binary data exists
	const binaryData = this.helpers.assertBinaryData(itemIndex, binaryPropertyName);
	const fileBuffer = await this.helpers.getBinaryDataBuffer(itemIndex, binaryPropertyName);

	const fileName = binaryData.fileName || 'file';
	const mimeType = binaryData.mimeType || 'application/octet-stream';

	// Build multipart/form-data manually for cloud environment compatibility
	const boundary = `----n8nFormBoundary${Date.now()}${Math.random().toString(36).substring(2)}`;

	// Collect form fields with defaults
	const formFields: Array<[string, string]> = [
		['languages', languages.join(',')],
		['outputs', outputs.join(',')],
		['response', additionalFields.response || 'persisted'],
		['models', additionalFields.models || 'auto'],
	];

	// Add optional fields
	if (additionalFields.webhookUrl) {
		formFields.push(['webhookUrl', additionalFields.webhookUrl]);
	}
	if (additionalFields.reference) {
		formFields.push(['reference', additionalFields.reference]);
	}
	if (additionalFields.jobExpiryInMinutes !== undefined) {
		formFields.push(['jobExpiryInMinutes', String(additionalFields.jobExpiryInMinutes)]);
	}

	// Build form fields section
	let formFieldsBody = '';
	for (const [fieldName, fieldValue] of formFields) {
		formFieldsBody +=
			`--${boundary}\r\n` +
			`Content-Disposition: form-data; name="${fieldName}"\r\n\r\n` +
			`${fieldValue}\r\n`;
	}

	// Build file section
	const filePreamble =
		`--${boundary}\r\n` +
		`Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
		`Content-Type: ${mimeType}\r\n\r\n`;
	const closing = `\r\n--${boundary}--\r\n`;

	// Concatenate all parts into single buffer
	const bodyBuffer = Buffer.concat([
		Buffer.from(formFieldsBody, 'utf8'),
		Buffer.from(filePreamble, 'utf8'),
		fileBuffer,
		Buffer.from(closing, 'utf8'),
	]);

	// Get credentials for manual header construction
	// Note: httpRequestWithAuthentication doesn't support raw Buffer body with multipart
	const credentials = await this.getCredentials(CREDENTIAL_NAME);
	const baseUrl = (credentials.baseUrl as string) || DEFAULT_BASE_URL;

	try {
		const response = await this.helpers.httpRequest({
			method: 'POST',
			url: `${baseUrl}/api/v1/convert/submit-file`,
			headers: {
				'Authorization': `Bearer ${credentials.apiKey}`,
				'Content-Type': `multipart/form-data; boundary=${boundary}`,
			},
			body: bodyBuffer,
			timeout: REQUEST_TIMEOUT_MS,
		});
		return response as ConvertApiResponse;
	} catch (error) {
		throw handleApiError(this, error, itemIndex, 'submit binary file', 'job');
	}
}

/**
 * Execute the Get Result operation.
 * Retrieves the status and results of a conversion job.
 */
async function executeGetResult(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<JobStatusResponse | SimplifiedJobStatusResponse> {
	const jobId = this.getNodeParameter('jobId', itemIndex) as string;
	const simplify = this.getNodeParameter('simplify', itemIndex, true) as boolean;

	if (!jobId) {
		throw new NodeOperationError(
			this.getNode(),
			'Job ID is required',
			{ itemIndex },
		);
	}

	// Get base URL from credentials
	const baseURL = await getBaseUrl(this);

	const requestOptions: IHttpRequestOptions = {
		method: 'GET' as IHttpRequestMethods,
		baseURL,
		url: `/api/v1/convert/jobs/${encodeURIComponent(jobId)}`,
	};

	try {
		const response = await this.helpers.httpRequestWithAuthentication.call(
			this,
			CREDENTIAL_NAME,
			requestOptions,
		) as JobStatusResponse;

		if (simplify) {
			const simplified: SimplifiedJobStatusResponse = {
				id: response.id,
				status: response.status,
			};
			if (response.processingTimeInSeconds !== undefined) {
				simplified.processingTimeInSeconds = response.processingTimeInSeconds;
			}
			if (response.files) {
				simplified.files = response.files;
			}
			if (response.error) {
				simplified.error = response.error;
			}
			return simplified;
		}

		return response;
	} catch (error) {
		throw handleApiError(this, error, itemIndex, 'get job result', 'job');
	}
}

