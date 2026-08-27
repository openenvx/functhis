# Functhis CLI reference (Skill internal)

These commands are for the Skill bootstrap sequence. **Users should not run them.**

## Bootstrap commands

| Command | Purpose |
| --- | --- |
| `fn import [--dir PATH] [--dry-run]` | Import stdio servers from Cursor, Claude, OpenCode |
| `fn import cursor` | Import Cursor only |
| `fn import mcp-json <path>` | Import any `mcp.json`-style file |
| `fn setup [--force] [--write-client cursor\|claude\|opencode]` | Demo fixtures or merge client MCP entry |
| `fn doctor` | Validate config and upstream connections |
| `fn serve [--functions-dir PATH]` | Start stdio gateway (MCP client runs this) |

## Gateway tools (preferred after bootstrap)

| Tool | Input | Purpose |
| --- | --- | --- |
| `fn_search` | `{ query, limit? }` | Search Functions and catalog |
| `fn_describe` | `{ ids: string[] }` | Load selected schemas |
| `fn_call` | `{ id, arguments?, runId?, newRun?, full? }` | Invoke Function or upstream tool; large results return a pointer envelope |
| `fn_recall` | `{ runId, address, select?, offset?, limit?, full? }` | Read stored evidence with optional JMESPath |
| `fn_select` | `{ runId, address, select, offset?, limit?, full? }` | Extract fields from stored evidence |
| `fn_stats` | `{}` | Labeled schema/result savings estimates |
| `fn_inspect` | `{ runId }` | Inspect run and successful path |
| `fn_this` | `{ runId, name, calls?, force? }` | Compile Function |
| `fn_test` | `{ name, repeat? }` | Fixture replay |
| `<function-name>` | Function inputs | Direct Function invoke |

## Config locations

- `.functhis/upstreams.json` or `~/.functhis/upstreams.json`
- Runs: `.functhis/runs/`
- Functions: `./functions/`

Restart the MCP client once after first bootstrap so `fn_search` appears in the tool list.
