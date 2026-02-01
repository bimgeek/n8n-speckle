import { INodeProperties } from 'n8n-workflow';

// When the resource `issues` is selected, this `operation` parameter will be shown.
export const issuesOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,

		displayOptions: {
			show: {
				resource: ['issues'],
			},
		},
		options: [
			{
				name: 'Get Issues',
				value: 'getIssues',
				description: 'Fetch issues from a Speckle project, model, or version',
				action: 'Get issues',
			},
		],
		default: 'getIssues',
	},
];

// Here we define what to show when the `getIssues` operation is selected.
const getIssuesOperation: INodeProperties[] = [
	{
		displayName: 'URL',
		name: 'issuesUrl',
		type: 'string',
		default: '',
		placeholder: 'https://app.speckle.systems/projects/{projectId}/models/{modelId}',
		description: 'The Speckle URL (project, model, or version). Supports formats: /projects/{ID}, /projects/{ID}/models/{modelId}, or /projects/{ID}/models/{modelId}@{versionId}.',
		displayOptions: {
			show: {
				resource: ['issues'],
				operation: ['getIssues'],
			},
		},
		required: true,
	},
	{
		displayName: 'Include Replies',
		name: 'getReplies',
		type: 'boolean',
		default: false,
		description: 'Whether to include replies for each issue',
		displayOptions: {
			show: {
				resource: ['issues'],
				operation: ['getIssues'],
			},
		},
	},
];

export const issuesFields: INodeProperties[] = [
	/* -------------------------------------------------------------------------- */
	/*                              issues:getIssues                              */
	/* -------------------------------------------------------------------------- */
	...getIssuesOperation,
];
