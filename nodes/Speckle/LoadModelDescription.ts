import { INodeProperties } from 'n8n-workflow';

// When the resource `model` is selected, this `operation` parameter will be shown.
export const modelOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,

		displayOptions: {
			show: {
				resource: ['model'],
			},
		},
		options: [
			{
				name: 'Load Model',
				value: 'loadModel',
				description: 'Load model data from a Speckle URL',
				action: 'Load a model from URL',
			},
		],
		default: 'loadModel',
	},
];

// Here we define what to show when the `loadModel` operation is selected.
const loadModelOperation: INodeProperties[] = [
	{
		displayName: 'Model URL',
		name: 'modelUrl',
		type: 'string',
		default: '',
		placeholder: 'https://app.speckle.systems/projects/{projectId}/models/{modelId}',
		description: 'The Speckle model URL (latest version only)',
		displayOptions: {
			show: {
				resource: ['model'],
				operation: ['loadModel'],
			},
		},
		required: true,
	},
];

export const modelFields: INodeProperties[] = [
	/* -------------------------------------------------------------------------- */
	/*                              model:loadModel                               */
	/* -------------------------------------------------------------------------- */
	...loadModelOperation,
];
