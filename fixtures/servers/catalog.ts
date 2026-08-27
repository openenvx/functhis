import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';

const DISTRACTORS = [
  'deployment',
  'kubernetes',
  'database',
  'monitoring',
  'billing',
  'analytics',
  'security',
  'compliance',
  'inventory',
  'shipping',
  'customer',
  'support',
  'incident',
  'metrics',
  'logging',
  'cache',
  'queue',
  'storage',
  'network',
  'identity',
];

function buildCatalogTools(): {
  name: string;
  description: string;
}[] {
  const tools: { name: string; description: string }[] = [];
  for (let i = 1; i <= 100; i += 1) {
    const topic = DISTRACTORS[i % DISTRACTORS.length];
    tools.push({
      description: `Read-only lookup for ${topic} record ${i}. Safe inspection endpoint.`,
      name: `get_${topic}_${i}`,
    });
  }
  tools.push({
    description:
      'Search GitHub issues by repository and query string. Read-only issue lookup.',
    name: 'search_github_issues',
  });
  return tools;
}

async function main(): Promise<void> {
  const server = new McpServer({
    name: 'functhis-fake-catalog',
    version: '0.0.1',
  });

  for (const tool of buildCatalogTools()) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: z.object({
          id: z.string().optional(),
          query: z.string().optional(),
        }),
      },
      async ({ query, id }) => ({
        content: [
          {
            text: JSON.stringify({
              id: id ?? null,
              query: query ?? null,
              status: 'ok',
              tool: tool.name,
            }),
            type: 'text' as const,
          },
        ],
      })
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
