import type {
	ITriggerFunctions,
	INodeType,
	INodeTypeDescription,
	ITriggerResponse,
	INodeExecutionData,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { SubscriptionClient } from 'subscriptions-transport-ws';
import { WebSocket } from 'ws';
import { parseSpeckleModelUrl } from '../Speckle/utils/urlParsing';

export class SpeckleTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Speckle Trigger',
		name: 'speckleTrigger',
		icon: { light: 'file:speckle.svg', dark: 'file:speckle.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: 'On model updated',
		description: 'Triggers workflow when a new version is published to a Speckle model',
		defaults: {
			name: 'On model updated',
		},
		inputs: [],
		outputs: ['main'],
		usableAsTool: true,
		credentials: [
			{
				name: 'speckleApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Model URL',
				name: 'modelUrl',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'https://app.speckle.systems/projects/{projectId}/models/{modelId}',
				description: 'The Speckle model URL to monitor for new versions',
			},
		],
	};

	async trigger(this: ITriggerFunctions): Promise<ITriggerResponse> {
		// Get parameters
		const modelUrl = this.getNodeParameter('modelUrl') as string;

		// Parse the URL to extract components
		let projectId: string;
		let modelId: string;
		try {
			const parsed = parseSpeckleModelUrl(modelUrl);
			projectId = parsed.projectId;
			modelId = parsed.modelId!;
		} catch (error) {
			throw new NodeOperationError(
				this.getNode(),
				(error as Error).message,
			);
		}

		// Get credentials
		const credentials = await this.getCredentials('speckleApi');
		const authToken = (credentials.token as string).trim();
		const domain = (credentials.domain as string) || 'https://app.speckle.systems';

		// Convert HTTP(S) URL to WebSocket URL
		const wsUrl = domain.replace(/^http/, 'ws') + '/graphql';

		// Initialize WebSocket client
		let client: SubscriptionClient | null = null;

		// GraphQL subscription query - projectVersionsUpdated
		const subscriptionQuery = `
			subscription OnProjectVersionsUpdate($projectId: String!) {
				projectVersionsUpdated(id: $projectId) {
					id
					type
					version {
						id
						createdAt
						message
						sourceApplication
						authorUser {
							id
							name
							avatar
						}
						model {
							id
							name
							displayName
						}
					}
				}
			}
		`;

		// Initialize GraphQL WebSocket client using legacy subscriptions-transport-ws protocol
		client = new SubscriptionClient(
			wsUrl,
			{
				reconnect: true,
				connectionParams: {
					Authorization: authToken,
				},
			},
			WebSocket as any,
		);

		// Set up connection event handlers
		client.onError((error: any) => {
			console.error('[SPECKLE TRIGGER] Connection error:', error);
		});

		// Create a manual trigger function
		const manualTriggerFunction = async () => {
			// This function can be used to manually test the trigger
			// For now, we'll just log that manual trigger was called
			this.logger?.info('Manual trigger called for Speckle Trigger');
		};

		// Start subscription
		const subscription = client.request({
			query: subscriptionQuery,
			variables: {
				projectId,
			},
		}).subscribe({
			next: (data: any) => {
				const event = data?.data?.projectVersionsUpdated;
				const version = event?.version;

				// Filter: only trigger if this version belongs to our target model
				if (version?.model?.id !== modelId) {
					return;
				}

				// Trigger workflow for matching model
				const outputData: INodeExecutionData[] = [
					{
						json: {
							eventId: event?.id,
							eventType: event?.type,
							projectId,
							version: {
								id: version.id,
								createdAt: version.createdAt,
								message: version.message,
								sourceApplication: version.sourceApplication,
								authorUser: version.authorUser,
								model: version.model,
							},
							timestamp: new Date().toISOString(),
						},
					},
				];

				this.emit([outputData]);
			},
			error: (error) => {
				this.logger?.error('Subscription error', { error });
			},
			complete: () => {
				this.logger?.info('Subscription ended');
			},
		});

		// Function to close the connection
		async function closeFunction() {
			if (subscription) {
				try {
					subscription.unsubscribe();
				} catch (err) {
					// Silently ignore
				}
			}
			if (client) {
				try {
					client.close();
				} catch (err) {
					// Silently ignore
				}
			}
		}

		return {
			closeFunction,
			manualTriggerFunction,
		};
	}
}
