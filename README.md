# Functhis

**Functhis turns expensive, multi-step MCP work into small, reusable TypeScript tools.**

Functhis sits between your AI agent and your MCP servers. It indexes your TypeScript codebase and tool catalog into a compact knowledge graph, runs agent-written TypeScript in a sandbox, and saves working logic as packages you can commit and reuse.

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
| Missing repo context | SQLite knowledge graph of **TypeScript** symbols, imports, and MCP tools with FTS search |
| Throwaway workflows | Autonomous learning: repeated read-only flows become `packages/auto-*` without prompts |

## How it works

```text
Your agent (Cursor, Claude, Codex, …)
        │
        ▼
  Functhis MCP gateway  (fn serve)
        │
        ├── Autonomous learning
        │     detect → compile → verify → save → hot-register
        │
        ├── Knowledge graph (SQLite)
        │     repo symbols + MCP tools + edges
        │
        ├── Upstream MCP servers
        │
        └── Sandboxed runtime + saved packages under ./packages/
```

**Autonomous loop (default):**

```text
observe → detect → compile → verify → save → reuse → measure
```

1. Bootstrap — `fn import`, `fn setup`, `fn serve`
2. Work through the gateway — every `fn_call` is recorded
3. **Functhis learns on its own** — when the same read-only flow repeats, it auto-saves `packages/auto-*` and hot-registers it
4. Reuse — `fn_search` surfaces learned packages first; call them instead of repeating upstream chains

Manual tools (`fn_compile_trace`, `fn_save_function`) remain available for custom names, write-capable flows, and overrides.

Install the **Agent Skill** and the agent handles bootstrap for you. See [INSTALL.md](INSTALL.md).

## Compared to what?

- **Raw MCP in the client** — Functhis shrinks the surface (search, compact envelopes, recording). Direct MCP still works; those calls are **not** observed or learned.
- **Skill / prompt libraries** — Skills tell the agent how to work. Functhis saves working TypeScript that runs in a sandbox.
- **n8n / visual builders** — No canvas, no hosted runner. Packages are git folders (`function.ts` + lockfile).

HTTP/SSE MCP servers are **not** imported (stdio only). `fn import` and `fn doctor` warn when they skip remotes.

## Install

**Recommended:** install only the Skill (or plugin). The agent installs `fn`, imports your MCP servers, wires the gateway, and runs `fn doctor`.

| Step | You | Agent (via Skill) |
| --- | --- | --- |
| 1 | Install Skill / plugin | — |
| 2 | Open a project, use MCP as usual | Installs `fn` if needed |
| 3 | Restart MCP client once (if prompted) | Imports servers, wires gateway, `fn doctor` |
| 4 | Use MCP as usual | Functhis learns repeated flows automatically |

Full paths for Cursor, Claude, Codex, and OpenCode: **[INSTALL.md](INSTALL.md)**

### CLI (power users and CI)

```sh
npm install -g functhis
# if the registry package is not published yet:
npm install -g github:openenvx/functhis
fn setup
fn index
fn serve --packages-dir ./packages
```

Reference: [skills/functhis/references/cli.md](skills/functhis/references/cli.md)

## Core capabilities

### Knowledge graph

`fn index` incrementally parses a **TypeScript** repo (needs `tsconfig.json`; other languages are not indexed) and merges MCP tool metadata from connected **stdio** upstreams. Search returns a **compact subgraph** (~6 KiB) with code excerpts. Without a tsconfig, indexing is skipped; the gateway still serves tools and packages.

### MCP gateway

All **imported stdio** upstream tools are reachable through Functhis. Discovery (`fn_search`, `fn_describe`), invocation (`fn_call`), and evidence access (`fn_select`, `fn_recall`) go through one gateway with recording, redaction, and compact result envelopes. HTTP/SSE servers stay in the client and are not proxied.

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

### Autonomous learning

Functhis **learns by itself**. After each successful multi-step gateway run, it checks for repeated read-only tool sequences (default: 2+ occurrences). When a pattern qualifies, the gateway autonomously:

1. Compiles the trace (`fn_compile_trace` logic)
2. Replay-verifies the skeleton (`fn_test_function`)
3. Saves `packages/auto-<flow>/` (`fn_save_function`)
4. Hot-registers the package as an MCP tool

State is tracked in `.functhis/learning.json`. Configure via `.functhis/settings.json`:

```json
{
  "version": 1,
  "learning": {
    "enabled": true,
    "minOccurrences": 2,
    "writePolicy": "scoped",
    "allowedWriteTools": ["github.create_issue"],
    "maxConcurrency": 2
  }
}
```

Every autonomous flow ends as **`promoted`** (saved, indexed, hot-registered when read-only) or **`quarantined`** (policy/verification failure) — never waiting on user approval.

Use **`fn_learning_status`**, **`fn_learning_pause`**, and **`fn_learning_resume`** to observe or emergency-stop learning. Pause is for incidents, not normal workflow.

Functhis records gateway-routed MCP calls and brokered system capabilities (`system.read_file`, `system.write_file`, `system.exec`). Direct MCP bypasses are marked unobservable when the client cannot be proxied.

### Trace-to-function (manual override)

You can still inspect, compile, test, and save manually:

1. `fn_inspect` — list traces or inspect dataflow
2. `fn_compile_trace` / `fn_compile_group` — compile brief + skeleton
3. `fn_test_function` — verify with replay or live read tools
4. `fn_save_function` — write a named package (or override autonomous naming)

Write-capable flows can also crystallize autonomously when `learning.writePolicy` is `scoped` and tools are listed in `learning.allowedWriteTools`. Otherwise they are quarantined automatically.

CLI equivalents: `fn traces list`, `fn traces compile <run-id> --name <name>`, `fn functions test <name>`.

Token and byte figures are **local estimates** unless a provider reports billing data.

## Gateway tools

| MCP tool | Purpose |
| --- | --- |
| **Discovery & calls** |  |
| `fn_search` | Search saved packages, graph tools, then upstream catalog |
| `fn_describe` | Load schemas for selected tool IDs only |
| `fn_call` | Invoke an upstream tool or saved package; large results return a pointer envelope |
| `fn_select` / `fn_recall` | Read stored evidence with JMESPath / paging |
| `fn_stats` | Labeled schema/result savings; optional `function` or `tool` filter |
| **Knowledge graph** |  |
| `fn_index` | Incrementally index the TypeScript repo into the graph |
| `fn_search_context` | Search repo + MCP graph; return compact subgraph with excerpts |
| `fn_subgraph` | Expand explicit graph node IDs |
| **Sandbox & packages** |  |
| `fn_execute_code` | Run agent-written TypeScript in the sandbox |
| `fn_save_function` | Save source + lockfile as a package |
| `fn_install_function` | Install a package from a local path |
| `fn_inspect_function` | Compare lockfile schemas to live MCP catalog |
| `fn_compile_trace` | Compile a trace into a brief + skeleton (also runs autonomously on repeat) |
| `fn_candidates` | List repeated patterns and auto-crystallized packages |
| `fn_compile_group` | Compile briefs for a candidate group |
| `fn_learning_status` | Queue depth, jobs, crystallized packages, policy settings |
| `fn_learning_pause` / `fn_learning_resume` | Emergency stop / resume autonomous learning |
| `fn_test_function` | Verify a package locally (replay or live read tools) |
| `<package-name>` | Call a saved package directly |
| **Traces** |  |
| `fn_inspect` | List recent traces or inspect dataflow for a `runId` |

Pointer envelope contract: [docs/MCP.md](docs/MCP.md)

## Safety

- Unknown and write-classified upstream tools are denied by default
- Tool descriptions and results are treated as untrusted external data
- Every gateway call is recorded with recursive redaction and bounded output
- Sandbox code cannot import modules, access `process`, or call tools outside its allowlist
- Package lockfiles fingerprint tool schemas; drift is surfaced at inspect time
- Package execution is always sandboxed (isolated child process)
- Autonomous learning promotes read-only flows by default; write flows require scoped policy in settings
- Durable event log (`.functhis/events.jsonl`) and per-session run management
- Trace retention is bounded via `.functhis/settings.json` (packages are never auto-deleted)

## More docs

- [INSTALL.md](INSTALL.md) — skill-only install (start here)
- [CHANGELOG.md](CHANGELOG.md) — versions
- [docs/MCP.md](docs/MCP.md) — pointer envelope contract and evidence read API
- [docs/SETTINGS.md](docs/SETTINGS.md) — learning and trace retention
- [docs/PACKAGES.md](docs/PACKAGES.md) — `functhis.json` / lock / lifecycle
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — gateway, sandbox, learning worker, graph
- [docs/DEMO.md](docs/DEMO.md) — local demo flow and integration tests
- [examples/get-user-issues](examples/get-user-issues) — package layout example
- [STATUS.md](STATUS.md) — what is done vs what to build
- [roadmap.md](roadmap.md) — scope boundaries

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

**Future possibilities:** a hosted package catalog could make sharing easier; the local gateway does not depend on it.
