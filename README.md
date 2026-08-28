# Functhis

**Functhis turns expensive, multi-step MCP work into small, reusable TypeScript tools.**

Functhis sits between your AI agent and your MCP servers. It indexes your codebase and tool catalog into a compact knowledge graph, runs agent-written TypeScript in a sandbox, and saves working logic as packages you can save and share.

No account, cloud, or telemetry. Everything runs on your machine.

## Why Functhis exists

Agents working with MCP hit three recurring problems:

1. **Context bloat** — Large tool catalogs and fat JSON responses fill the context window before the agent does useful work.
2. **No repo awareness** — MCP knows about external APIs, not your TypeScript symbols, imports, or how files connect.
3. **No durable artifacts** — Successful multi-step tool workflows live only in chat history. They cannot be tested, shared, or reused.

Functhis addresses all three in one local process:

| Problem | Functhis answer |
| --- | --- |
| Bloated MCP surface | Single gateway with search, compact schemas, and pointer envelopes for large results |
| Missing repo context | SQLite knowledge graph of symbols, imports, and MCP tools with FTS search |
| Throwaway workflows | Sandboxed `fn_execute_code` for one-offs; `fn_save_function` for locked packages |

## How it works

```text
Your agent (Cursor, Claude, Codex, …)
        │
        ▼
  Functhis MCP gateway  (fn serve)
        │
        ├── Knowledge graph (SQLite)
        │     repo symbols + MCP tools + edges
        │
        ├── Upstream MCP servers
        │     GitHub, Sentry, your internal tools, …
        │
        └── Sandboxed runtime
              TypeScript → allowlisted tool calls only
              saved packages under ./packages/
```

**Typical agent loop:**

1. Bootstrap — import existing MCP configs, start the gateway (`fn import`, `fn setup`, `fn serve`)
2. Orient — index the repo (`fn_index`), search context (`fn_search_context`)
3. Act — call upstream tools (`fn_call`) or run logic in the sandbox (`fn_execute_code`)
4. Ship — save working code as a package (`fn_save_function`) and call it by name later

Install the **Agent Skill** and the agent handles bootstrap for you. See [INSTALL.md](INSTALL.md).

## Install

**Recommended:** install only the Skill (or plugin). The agent installs `fn`, imports your MCP servers, wires the gateway, and runs `fn doctor`.

| Step | You | Agent (via Skill) |
| --- | --- | --- |
| 1 | Install Skill / plugin | — |
| 2 | Open a project, use MCP as usual | Installs `fn` if needed |
| 3 | Restart MCP client once (if prompted) | Imports servers, wires gateway, `fn doctor` |
| 4 | Ask to index, explore, or save a package | `fn_index`, `fn_execute_code`, `fn_save_function` |

Full paths for Cursor, Claude, Codex, and OpenCode: **[INSTALL.md](INSTALL.md)**

### CLI (power users and CI)

```sh
npm install -g functhis
fn setup
fn index
fn serve --packages-dir ./packages
```

Reference: [skills/functhis/references/cli.md](skills/functhis/references/cli.md)

## Core capabilities

### Knowledge graph

`fn index` incrementally parses your TypeScript repo (exports, imports, file structure) and merges in MCP tool metadata from connected upstreams. Search returns a **compact subgraph** (~6 KiB) with code excerpts — enough context for the agent without dumping the whole repo.

### MCP gateway

All upstream tools are reachable through Functhis. Discovery (`fn_search`, `fn_describe`), invocation (`fn_call`), and evidence access (`fn_select`, `fn_recall`) go through one gateway with recording, redaction, and compact result envelopes.

### Sandboxed code execution

`fn_execute_code` transpiles and runs TypeScript in an isolated child process. The sandbox:

- Allows only explicitly listed MCP tools (`allowedTools`)
- Blocks imports, `process`, and network access from user code
- Enforces timeouts, call limits, and output size caps
- Routes tool calls through a capability broker on the host

Use this when the agent needs to filter, transform, or combine large tool outputs without pulling everything into context.

### Packages

`fn_save_function` writes a package:

```text
packages/<name>/
  function.ts      # entrypoint
  functhis.json    # manifest (capabilities, schemas, runtime limits)
  functhis.lock    # tool schema fingerprints
```

Saved packages appear as first-class MCP tools. `fn_inspect_function` detects schema drift against live upstreams. Packages can be installed from a local path with `fn_install_function`.

## Gateway tools

| MCP tool | Purpose |
| --- | --- |
| **Discovery & calls** |  |
| `fn_search` | Search saved packages, graph tools, then upstream catalog |
| `fn_describe` | Load schemas for selected tool IDs only |
| `fn_call` | Invoke an upstream tool; large results return a pointer envelope |
| `fn_select` / `fn_recall` | Read stored evidence with JMESPath / paging |
| `fn_stats` | Labeled schema and result size estimates |
| **Knowledge graph** |  |
| `fn_index` | Incrementally index the TypeScript repo into the graph |
| `fn_search_context` | Search repo + MCP graph; return compact subgraph with excerpts |
| `fn_subgraph` | Expand explicit graph node IDs |
| **Sandbox & packages** |  |
| `fn_execute_code` | Run agent-written TypeScript in the sandbox |
| `fn_save_function` | Save source + lockfile as a package |
| `fn_install_function` | Install a package from a local path |
| `fn_inspect_function` | Compare lockfile schemas to live MCP catalog |
| `<package-name>` | Call a saved package directly |
| **Traces** |  |
| `fn_inspect` | Review a captured run |

Pointer envelope contract: [docs/MCP.md](docs/MCP.md)

## Safety

- Unknown and write-classified upstream tools are denied by default
- Tool descriptions and results are treated as untrusted external data
- Every gateway call is recorded with recursive redaction and bounded output
- Sandbox code cannot import modules, access `process`, or call tools outside its allowlist
- Package lockfiles fingerprint tool schemas; drift is surfaced at inspect time

## More docs

- [INSTALL.md](INSTALL.md) — skill-only install (start here)
- [docs/MCP.md](docs/MCP.md) — pointer envelope contract and evidence read API
- [docs/DEMO.md](docs/DEMO.md) — local demo flow and integration tests
- [STATUS.md](STATUS.md) — what is done vs what to build (start here)
- [FUNCTHIS_ROADMAP.md](FUNCTHIS_ROADMAP.md) — R0–R4 detail

## Development

```sh
git clone https://github.com/openenvx/functhis.git
cd functhis
bun install
bun run check-types
bun run check
bun run build
bun run test
bun run e2e          # integration tests against fixture MCP servers
bun run verify-release
```

## License

Apache-2.0. See [LICENSE](LICENSE).
