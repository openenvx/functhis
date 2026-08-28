import { describe, expect, it } from 'vitest';

import { CapabilityBroker } from '../src/sandbox/broker';
import { executeSandboxCode } from '../src/sandbox/runner';
import { UpstreamManager } from '../src/upstream/manager';

describe('sandbox execution', () => {
  it('filters a large payload inside the sandbox', async () => {
    const manager = new UpstreamManager();
    manager.catalog.addTools('readonly', [
      {
        description: 'Return large list',
        inputSchema: {
          properties: { itemCount: { type: 'number' } },
          type: 'object',
        },
        name: 'get_large_payload',
      },
    ]);

    const originalCallTool = manager.callTool.bind(manager);
    manager.callTool = async (id, args, options) => {
      if (id === 'readonly.get_large_payload') {
        const count =
          typeof args === 'object' &&
          args !== null &&
          'itemCount' in args &&
          typeof (args as { itemCount: unknown }).itemCount === 'number'
            ? (args as { itemCount: number }).itemCount
            : 500;
        return {
          content: [
            {
              text: JSON.stringify({
                items: Array.from({ length: count }, (_, index) => ({
                  id: index,
                  value: index === 42 ? 'NEEDLE' : `item-${index}`,
                })),
              }),
              type: 'text',
            },
          ],
        };
      }
      return originalCallTool(id, args, options);
    };

    const broker = new CapabilityBroker(manager, {
      allowedTools: ['readonly.get_large_payload'],
      maxCalls: 5,
    });

    const source = `
export default async function(ctx, input) {
  const data = await ctx.tools.readonly.get_large_payload({ itemCount: 500 });
  const needle = data.items.find((item) => item.value === 'NEEDLE');
  return { id: needle?.id, value: needle?.value };
}
`;

    const result = await executeSandboxCode(broker, {
      allowedTools: ['readonly.get_large_payload'],
      source,
      timeoutMs: 15_000,
    });

    expect(result.status).toBe('succeeded');
    expect(result.output).toEqual({ id: 42, value: 'NEEDLE' });
    expect(result.calls).toBe(1);
  }, 30_000);
});
