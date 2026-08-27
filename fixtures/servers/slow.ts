import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';

const DEFAULT_DELAY_MS = 120_000;

async function main(): Promise<void> {
  const delayMs = Number(
    process.env.FUNCTHIS_SLOW_DELAY_MS ?? DEFAULT_DELAY_MS
  );

  const server = new McpServer({
    name: 'functhis-fake-slow',
    version: '0.0.1',
  });

  server.registerTool(
    'slow_lookup',
    {
      description: 'Slow read-only lookup used for timeout testing.',
      inputSchema: z.object({ query: z.string() }),
    },
    async ({ query }) => {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return {
        content: [
          {
            text: JSON.stringify({ query, status: 'done' }),
            type: 'text' as const,
          },
        ],
      };
    }
  );

  server.registerTool(
    'canary_echo',
    {
      description: 'Echo input for redaction canary testing. Read-only.',
      inputSchema: z.object({
        api_key: z.string().optional(),
        message: z.string(),
      }),
    },
    async ({ message, api_key }) => ({
      content: [
        {
          text: JSON.stringify({
            api_key: api_key ?? null,
            canary: message.includes('fn_canary_') ? message : undefined,
            echoed: message,
          }),
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
