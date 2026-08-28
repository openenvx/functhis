# Local demo

Functhis indexes your repo and upstream MCP tools into a SQLite graph, runs sandboxed TypeScript against allowlisted tools, and saves reusable packages under `packages/`.

## Skill-driven loop (recommended)

Install the Functhis Skill or plugin. The agent:

1. Auto-imports stdio servers from Cursor, Claude, and OpenCode (`fn import`)
2. Writes the Functhis MCP entry and runs `fn doctor`
3. Indexes the workspace (`fn index` or `fn_index`)
4. Uses `fn_search_context` / `fn_subgraph` for repo + tool context
5. Runs one-off logic with `fn_execute_code` or compiles traces with `fn_compile_trace` / saves packages with `fn_save_function`

## Quick local flow (CI / power users)

Requirements: Node.js 22+, Bun for development.

```sh
git clone https://github.com/openenvx/functhis.git
cd functhis
bun install
fn setup --dir .functhis-demo
fn serve --dir .functhis-demo
```

In another terminal, run integration tests against fixture upstreams:

```sh
bun run e2e
```

## Compile a fixture trace

Integration tests cover the full trace-to-function loop:

```text
fn_call (record trace) → fn_compile_trace → fn_test_function (replay) → fn_save_function → fn_call (package)
```

Run `bun run test` or `bun run e2e` to exercise this against fixture MCP servers (`fixtures/servers/readonly.ts`).

## Real MCP servers

The Skill imports existing client configs automatically. To add servers manually, edit `.functhis/upstreams.json`. Use read-only tools first. Example:

```json
{
  "version": 1,
  "upstreams": [
    {
      "id": "github",
      "label": "GitHub read-only",
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "enabled": true,
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_PERSONAL_ACCESS_TOKEN}"
      }
    }
  ]
}
```

Environment values are references only — Functhis passes them to child processes but does not persist secret values in traces.

## What this demo does not prove

- Production-scale correctness vs direct MCP exposure
- Write/mutation workflows (read-only policy in the public fixtures)
- Provider-reported full-task cost savings
