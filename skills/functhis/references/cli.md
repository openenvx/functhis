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
| `fn serve [--packages-dir PATH]` | Start stdio gateway (MCP client runs this) |

## Gateway tools (preferred after bootstrap)

| Tool | Input | Purpose |
| --- | --- | --- |
| `fn_search` | `{ query, limit? }` | Search packages and catalog |
| `fn_describe` | `{ ids: string[] }` | Load selected schemas |
| `fn_call` | `{ id, arguments?, runId?, newRun?, full? }` | Invoke package or upstream tool; large results return a pointer envelope |
| `fn_recall` | `{ runId, address, select?, offset?, limit?, full? }` | Read stored evidence with optional JMESPath |
| `fn_select` | `{ runId, address, select, offset?, limit?, full? }` | Extract fields from stored evidence |
| `fn_stats` | `{}` | Labeled schema/result savings estimates |
| `fn_inspect` | `{ runId }` | Inspect run status and calls |
| `fn_execute_code` | `{ source, allowedTools, input?, ... }` | Run sandbox TypeScript |
| `fn_save_function` | `{ name, description, source, allowedTools }` | Save a function package |
| `fn_install_function` | `{ path, approve }` | Install a package from disk |
| `fn_inspect_function` | `{ name?, path? }` | Compare lockfile to live catalog |
| `<package-name>` | `{ input? }` | Direct package invoke |

## Config locations

- `.functhis/upstreams.json` or `~/.functhis/upstreams.json`
- Runs: `.functhis/runs/`
- Packages: `./packages/<name>/`

Restart the MCP client once after first bootstrap so `fn_search` appears in the tool list.
