# Local demo

Functhis indexes TypeScript (when `tsconfig.json` exists) and upstream MCP tools into a SQLite graph, runs sandboxed TypeScript against allowlisted tools, and saves reusable packages under `packages/`.

## Skill-driven loop (recommended)

Install the Functhis Skill or plugin. The agent:

1. Auto-imports **stdio** servers from Cursor, Claude, and OpenCode (`fn import`)
2. Writes the Functhis MCP entry and runs `fn doctor` (HTTP/SSE skips show as warnings)
3. Indexes TypeScript if `tsconfig.json` exists (`fn index` / `fn_index`)
4. Uses `fn_search_context` / `fn_subgraph` for repo + tool context
5. Routes work through `fn_call`; repeated read-only flows become `packages/auto-*`

## Worked example (fixture servers)

Against the fake `readonly` MCP server in this repo:

1. `fn setup` (or Skill bootstrap) so `readonly.get_user` and `readonly.list_issues` exist
2. Ask the agent twice: “Look up user `u1` and list issues for openenvx/functhis”
3. Both times the agent should `fn_search` / `fn_call` (or sandbox) **through the gateway**
4. After the second success, `fn_candidates` / `fn_learning_status` shows a promoted `auto-*` package
5. A third ask should hit that package from `fn_search` instead of replaying the two upstream tools

Package shape (same tools, named example): [examples/get-user-issues](../examples/get-user-issues).

Integration tests cover the compile loop without a live agent:

```text
fn_call (record trace) → fn_compile_trace → fn_test_function (replay) → fn_save_function → fn_call (package)
```

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

Run `bun run test` or `bun run e2e` against fixture MCP servers (`fixtures/servers/readonly.ts`).

## Real MCP servers

The Skill imports existing **stdio** client configs automatically. HTTP/SSE entries are skipped (warning on import/doctor). To add servers manually, edit `.functhis/upstreams.json`. Use read-only tools first. Example:

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
