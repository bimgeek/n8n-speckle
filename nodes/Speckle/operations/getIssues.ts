import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { executeGraphQLQuery } from '../utils/graphql';
import { parseSpeckleIssuesUrl } from '../utils/urlParsing';

/**
 * Handles the Get Issues operation
 * Fetches issues from a Speckle project, model, or version
 */
export async function handleGetIssues(
	context: IExecuteFunctions,
	items: INodeExecutionData[],
): Promise<INodeExecutionData[]> {
	const returnData: INodeExecutionData[] = [];

	for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
		try {
			const issuesUrl = context.getNodeParameter('issuesUrl', itemIndex) as string;
			const getReplies = context.getNodeParameter('getReplies', itemIndex) as boolean;

			let baseUrl: string;
			let projectId: string;
			let modelId: string | undefined;
			let versionId: string | undefined;
			try {
				const parsed = parseSpeckleIssuesUrl(issuesUrl);
				baseUrl = parsed.baseUrl;
				projectId = parsed.projectId;
				modelId = parsed.modelId;
				versionId = parsed.versionId;
			} catch (error) {
				throw new NodeOperationError(context.getNode(), error.message, { itemIndex });
			}

			// Get credentials
			const credentials = await context.getCredentials('speckleApi');
			const token = credentials.token as string;
			let domain = (credentials.domain as string) || baseUrl;

			// Remove trailing slash from domain if present
			domain = domain.replace(/\/$/, '');

			// Build the GraphQL query - conditionally include replies
			const repliesFragment = getReplies
				? `
				replies(input: $repliesInput) {
					items {
						issueId
						id
						rawDescription
						createdAt
						author {
							user {
								name
							}
						}
					}
				}`
				: '';

			const graphqlQuery = {
				query: `
					query Project($projectId: String!, $input: ProjectIssuesInput${getReplies ? ', $repliesInput: IssueRepliesInput' : ''}) {
						project(id: $projectId) {
							issues(input: $input) {
								items {
									id
									identifier
									title
									rawDescription
									status
									priority
									assignee {
										user {
											name
										}
									}
									dueDate
									labels {
										name
									}
									createdAt
									updatedAt
									resourceIdString
									viewerState
									previewUrl
									${repliesFragment}
								}
							}
						}
					}
				`,
				variables: {
					projectId,
					input: {
						limit: 10000,
						...(versionId
							? { resourceIdString: `${modelId}@${versionId}` }
							: modelId
								? { resourceIdString: modelId }
								: {}),
					},
					...(getReplies ? { repliesInput: { limit: 10000 } } : {}),
				},
			};

			const graphqlResponse = await executeGraphQLQuery(
				context,
				domain,
				token,
				graphqlQuery,
				'fetch issues',
				itemIndex,
			);

			// Extract issues from the response
			const issues = graphqlResponse.data?.project?.issues?.items;
			if (!issues) {
				throw new NodeOperationError(
					context.getNode(),
					'Failed to fetch issues. The project may not exist or you may not have permission to access it.',
					{ itemIndex },
				);
			}

			// Transform each issue into an n8n item
			for (const issue of issues) {
				// Extract object IDs and application IDs from viewerState
				const viewerState = issue.viewerState;
				const selectedObjectIds = viewerState?.ui?.filters?.selectedObjectApplicationIds;
				const objectIds = selectedObjectIds ? Object.keys(selectedObjectIds) : null;
				const applicationIds = selectedObjectIds ? Object.values(selectedObjectIds) : null;

				// Build the issue URL
				const issueUrl = `${domain}/projects/${projectId}/models/${issue.resourceIdString}#threadId=${issue.id}`;

				// Extract labels as array of strings
				const labels = issue.labels
					? issue.labels.map((label: { name: string }) => label.name)
					: [];

				// Build the output object with fields in specified order
				const outputItem: any = {
					id: issue.id,
					identifier: issue.identifier,
					title: issue.title,
					description: issue.rawDescription || null,
					status: issue.status || null,
					priority: issue.priority || null,
					assignee: issue.assignee?.user?.name || null,
					dueDate: issue.dueDate || null,
					labels,
					createdAt: issue.createdAt || null,
					updatedAt: issue.updatedAt || null,
					url: issueUrl,
					objectIds,
					applicationIds,
					previewUrl: issue.previewUrl || null,
				};

				// Add replies if requested
				if (getReplies && issue.replies?.items) {
					outputItem.replies = issue.replies.items.map(
						(reply: {
							id: string;
							issueId: string;
							rawDescription: string;
							createdAt: string;
							author?: { user?: { name: string } };
						}) => ({
							id: reply.id,
							issueId: reply.issueId,
							description: reply.rawDescription,
							createdAt: reply.createdAt,
							author: reply.author?.user?.name || null,
						}),
					);
				}

				returnData.push({
					json: outputItem,
					pairedItem: itemIndex,
				});
			}
		} catch (error) {
			if (context.continueOnFail()) {
				returnData.push({
					json: { error: error.message },
					pairedItem: itemIndex,
				});
			} else {
				throw error;
			}
		}
	}

	return returnData;
}
