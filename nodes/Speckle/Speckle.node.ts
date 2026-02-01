import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { issuesFields, issuesOperations } from './IssuesDescription';
import { modelFields, modelOperations } from './LoadModelDescription';
import { uploadFileFields } from './UploadFileDescription';
import * as operations from './operations';

export class Speckle implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Speckle',
		name: 'speckle',
		icon: { light: 'file:speckle.svg', dark: 'file:speckle.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Interact with Speckle API',
		defaults: {
			name: 'Speckle',
		},
		inputs: ['main'],
		outputs: ['main'],
		usableAsTool: true,
		credentials: [
			{
				name: 'speckleApi',
				required: false,
			},
		],
		requestDefaults: {
			baseURL: 'https://app.speckle.systems',
			url: '',
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
			},
		},
		/**
		 * In the properties array we have two mandatory options objects required
		 *
		 * [Resource & Operation]
		 *
		 * https://docs.n8n.io/integrations/creating-nodes/code/create-first-node/#resources-and-operations
		 *
		 * Operations are separated into their own files (LoadModelDescription.ts, IssuesDescription.ts, etc.)
		 * to keep this class easy to read.
		 *
		 */
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Model',
						value: 'model',
					},
					{
						name: 'Issue',
						value: 'issues',
					},
				],
				default: 'model',
			},

			...modelOperations,
			...modelFields,
			...uploadFileFields,
			...issuesOperations,
			...issuesFields,
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;

		// Route to extracted operations
		if (resource === 'model' && operation === 'queryProperties') {
			const result = await operations.handleQueryProperties(this, items);
			return [result];
		}

		if (resource === 'model' && operation === 'queryObjects') {
			const result = await operations.handleQueryObjects(this, items);
			return [result];
		}

		if (resource === 'model' && operation === 'loadModel') {
			const result = await operations.handleLoadModel(this, items);
			return [result];
		}

		if (resource === 'issues' && operation === 'getIssues') {
			const result = await operations.handleGetIssues(this, items);
			return [result];
		}

		if (resource === 'model' && operation === 'uploadFile') {
			const result = await operations.handleUploadFile(this, items);
			return [result];
		}

		throw new NodeOperationError(
			this.getNode(),
			`The operation "${operation}" is not supported for resource "${resource}"`,
		);
	}
}
