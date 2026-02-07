import { INodeProperties } from 'n8n-workflow';

// Fields for the Upload File operation under the Model resource
export const uploadFileFields: INodeProperties[] = [
	{
		displayName: 'Project URL or ID',
		name: 'projectInput',
		type: 'string',
		default: '',
		placeholder: 'https://app.speckle.systems/projects/{projectId} or just {projectId}',
		description: 'Speckle project URL or project ID',
		displayOptions: {
			show: {
				resource: ['model'],
				operation: ['uploadFile'],
			},
		},
		required: true,
	},
	{
		displayName: 'Model Name',
		name: 'modelName',
		type: 'string',
		default: '',
		placeholder: 'My Model',
		description: 'Name of the model to upload to (creates if not exists)',
		displayOptions: {
			show: {
				resource: ['model'],
				operation: ['uploadFile'],
			},
		},
		required: true,
	},
	{
		displayName: 'Binary Property',
		name: 'binaryPropertyName',
		type: 'string',
		default: 'data',
		description: 'Name of the binary property containing the file to upload',
		displayOptions: {
			show: {
				resource: ['model'],
				operation: ['uploadFile'],
			},
		},
		required: true,
	},
];
