---
name: functhis-setup
description: >-
  First-run Functhis bootstrap when the gateway is missing, fn doctor fails, or MCP is not yet routed through Functhis. Auto-imports stdio servers from Cursor, Claude, and OpenCode, writes the Functhis MCP entry, and verifies with fn doctor. Users only install the functhis skill; this alias handles explicit setup requests.
license: Apache-2.0
compatibility: Requires Node.js 22+ and permission to run shell commands.
metadata:
  author: openenvx
---

# Functhis setup

Alias for first-run bootstrap. **Probe live state; never assume prior sessions.** **Do not ask** the user to choose import sources or run CLI themselves.

User install guide: [INSTALL.md](../../INSTALL.md)

## Auto-bootstrap sequence

Run **one command at a time**, summarize each step briefly.

1. `command -v fn` and `fn --version` — install with `npm install -g functhis` if missing
2. `fn import` — all known client MCP configs (Cursor, Claude, OpenCode)
3. If zero importable upstreams: `fn setup` (demo fixtures)
4. Detect client and merge Functhis MCP config:
   - Cursor: `fn setup --write-client cursor --packages-dir ./packages`
   - Claude: `fn setup --write-client claude --packages-dir ./packages`
   - OpenCode: `fn setup --write-client opencode --packages-dir ./packages`
5. `fn doctor`
6. Tell the user to **restart the MCP client once** if `fn_search` is not available yet
7. Hand off to the **`functhis`** skill — record by default; save packages only when the user asks

## Rules

- No Functhis account — do not ask the user to sign in
- Back up before overwriting config (CLI does this on `--write-client`)
- Never ask the user to paste MCP JSON manually unless auto-write fails
- Recording is automatic after bootstrap; do not auto-save packages

See [references/clients.md](references/clients.md) for client paths and plugin install.
