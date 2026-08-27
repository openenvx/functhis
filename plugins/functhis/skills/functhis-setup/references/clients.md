# Client MCP configuration

Functhis exposes a stdio MCP server via `fn serve`. The **Skill** writes these entries automatically with `fn setup --write-client`.

**User install (Skill only):** [INSTALL.md](../../../../INSTALL.md)

## Auto-import sources

`fn import` reads stdio servers from:

| Client | Config paths |
| --- | --- |
| Cursor | `~/.cursor/mcp.json`, `.cursor/mcp.json` |
| Claude Code | `~/.claude/mcp.json`, `.mcp.json` |
| OpenCode | `~/.config/opencode/opencode.json(c)`, `opencode.json(c)`, `.opencode/opencode.json(c)` |

HTTP/remote servers and the Functhis gateway entry itself are skipped.

## Write Functhis into a client (Skill bootstrap)

```bash
fn setup --write-client cursor --functions-dir ./functions
fn setup --write-client claude --functions-dir ./functions
fn setup --write-client opencode --functions-dir ./functions
```

Each command backs up the target config before merging.

## Manual snippets

**Cursor / Claude (`mcpServers`)**

```json
{
  "mcpServers": {
    "functhis": {
      "command": "fn",
      "args": ["serve", "--functions-dir", "./functions"]
    }
  }
}
```

**OpenCode (`mcp`)**

```json
{
  "mcp": {
    "functhis": {
      "type": "local",
      "command": ["fn", "serve", "--functions-dir", "./functions"],
      "enabled": true
    }
  }
}
```

Restart the MCP client after first setup or after compiling new Functions.

## Plugin marketplace install

**Claude Code**

```bash
claude plugin marketplace add openenvx/functhis
claude plugin install functhis@functhis
```

**Codex**

```bash
codex plugin marketplace add openenvx/functhis
codex plugin add functhis@functhis
```

**Cursor**

Import the marketplace from the repository URL, then install the `functhis` plugin.
