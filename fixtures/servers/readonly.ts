import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';

async function main(): Promise<void> {
  const server = new McpServer({
    name: 'functhis-fake-readonly',
    version: '0.0.1',
  });

  server.registerTool(
    'get_user',
    {
      description: 'Fetch a user profile by id. Read-only lookup.',
      inputSchema: z.object({ userId: z.string() }),
    },
    async ({ userId }) => ({
      content: [
        {
          text: JSON.stringify({
            name: 'Ada Lovelace',
            role: 'engineer',
            userId,
          }),
          type: 'text' as const,
        },
      ],
    })
  );

  server.registerTool(
    'list_issues',
    {
      description: 'List GitHub issues for a repository. Read-only.',
      inputSchema: z.object({
        owner: z.string(),
        repo: z.string(),
        state: z.enum(['open', 'closed', 'all']).optional(),
      }),
    },
    async ({ owner, repo, state }) => ({
      content: [
        {
          text: JSON.stringify({
            issues: [{ number: 42, title: 'Deployment failed on staging' }],
            owner,
            repo,
            state: state ?? 'open',
          }),
          type: 'text' as const,
        },
      ],
    })
  );

  server.registerTool(
    'get_deployment_status',
    {
      description: 'Inspect deployment status for an environment. Read-only.',
      inputSchema: z.object({ environment: z.string() }),
    },
    async ({ environment }) => ({
      content: [
        {
          text: JSON.stringify({
            environment,
            status: 'healthy',
            version: '1.2.3',
          }),
          type: 'text' as const,
        },
      ],
    })
  );

  server.registerTool(
    'get_large_payload',
    {
      description: 'Return a large read-only payload for integration tests.',
      inputSchema: z.object({
        itemCount: z.number().int().min(1).max(5000).optional(),
      }),
    },
    async ({ itemCount }) => {
      const count = itemCount ?? 500;
      const items = Array.from({ length: count }, (_, index) => ({
        body: `Issue body ${index} `.repeat(20),
        id: index + 1,
        title: `Synthetic issue ${index}`,
      }));
      return {
        content: [
          {
            text: JSON.stringify({ count, items }),
            type: 'text' as const,
          },
        ],
      };
    }
  );

  server.registerTool(
    'delete_user',
    {
      description: 'Delete a user account. Destructive write operation.',
      inputSchema: z.object({ userId: z.string() }),
    },
    async ({ userId }) => ({
      content: [
        {
          text: JSON.stringify({ deleted: userId }),
          type: 'text' as const,
        },
      ],
    })
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
