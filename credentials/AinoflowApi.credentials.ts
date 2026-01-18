import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

/**
 * Ainoflow API credentials.
 * Shared by all Ainoflow nodes (Convert, Files, Storage).
 * Uses Bearer token authentication via Authorization header.
 */
export class AinoflowApi implements ICredentialType {
	name = 'ainoflowApi';

	displayName = 'Ainoflow API';

	documentationUrl = 'https://docs.ainoflow.io';

	icon = { light: 'file:../icons/ainoflow.svg', dark: 'file:../icons/ainoflow.svg' } as const;

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description: 'Your Ainoflow API key',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://api.ainoflow.io',
			description: 'Ainoflow API base URL',
		},
	];

	// Bearer token authentication applied to all requests
	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	// Test connection using whoami endpoint (returns user scope/details)
	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/api/v1/whoami',
			method: 'GET',
		},
	};
}
