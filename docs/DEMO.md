# Crystallization demo

This repository includes a committed sample Function at [`functions/lookup-user-issues.ts`](../functions/lookup-user-issues.ts) compiled from a two-step read-only trace across two upstream MCP servers (catalog + readonly fixtures).

## Skill-driven loop (recommended)

Install the Functhis Skill or plugin. On large or unfamiliar MCP catalogs, the agent:

1. Auto-imports stdio servers from Cursor, Claude, and OpenCode (`fn import`)
2. Writes the Functhis MCP entry and runs `fn doctor`
3. Uses `fn_search` → `fn_describe` → `fn_call`
4. Crystallizes successful read-only paths with `fn_inspect`, `fn_this`, and `fn_test`
5. Reuses the compiled Function on similar tasks

Users do not run the CLI for discovery or crystallization.

## Quick replay (CI / power users)

Requirements: Node.js 22+, `functhis` installed (`npm install -g functhis`).

```sh
git clone https://github.com/openenvx/functhis.git
cd functhis
fn setup --dir .functhis-demo
fn test lookup-user-issues --dir .functhis-demo --functions-dir ./functions --repeat 30
fn run lookup-user-issues --dir .functhis-demo --functions-dir ./functions \
  --input '{"userId":"u2","owner":"openenvx","repo":"functhis"}'
```

Expected: 30 replays pass, fingerprints OK, run output includes user and issue data.

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

Environment values are references only — Functhis passes them to child processes but does not persist secret values in traces or fixtures.

## What this demo does not prove

- Provider-reported full-task token savings (see [benchmarks/m1-discovery.md](../benchmarks/m1-discovery.md))
- Correctness vs direct MCP exposure at scale
- Write/mutation workflows (read-only policy only in the public demo)
