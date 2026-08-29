# Packages

A Functhis package is a git-owned folder the gateway can invoke as an MCP tool. Autonomous learning writes `packages/auto-<flow>/`. Manual saves use `fn_save_function`.

```text
packages/<name>/
  function.ts
  functhis.json
  functhis.lock
  tests/
    replay.fixture.json
```

Layout example (fixture tools, not live GitHub): [examples/get-user-issues](../examples/get-user-issues).

## `function.ts`

Default export: `async function (ctx, input)`. `ctx.tools.<server>.<tool>(args)` calls allowlisted upstream tools through the host broker. No imports, `process`, or network from guest code.

## `functhis.json`

Parsed with the package manifest schema (`src/packages/schema.ts`).

| Field | Meaning |
| --- | --- |
| `name` | `[a-z][a-z0-9-]*` — also the MCP tool name |
| `description` | Shown in search / describe |
| `entrypoint` | Default `function.ts` |
| `capabilities.tools` | Allowlisted tool ids (`server.tool`) |
| `capabilities.writes` | `deny` or `review-required` |
| `inputSchema` / `outputSchema` | JSON Schema objects |
| `runtime.execution` | Always `sandbox` |
| `runtime.maxCalls` | Default 20 |
| `runtime.maxOutputBytes` | Default 6144 |
| `runtime.timeoutMs` | Default 30000 |
| `lifecycle` | `staging` → `active` or `quarantined` (`rejected` reserved) |
| `autonomousOrigin` | `true` when the learning worker promoted it |
| `compiledFrom` | Optional source `runId` |
| `quarantineReason` | Set when lifecycle is `quarantined` |

## `functhis.lock`

Fingerprints live upstream schemas at save time. `fn_inspect_function` reports missing tools or `schema-changed` hashes.

```json
{
  "version": 1,
  "tools": {
    "readonly.get_user": {
      "name": "get_user",
      "server": "readonly",
      "schemaHash": "…"
    }
  }
}
```

## Lifecycle

1. Stage under `.staging/`
2. Policy + replay verify
3. Promote to `packages/<name>/` with `lifecycle: "active"`, or quarantine with a reason
4. Active **read-only** packages are hot-registered as MCP tools

Share by committing `packages/` or `fn_install_function` from a path (`approve` required).

## Related

- Settings / write policy: [SETTINGS.md](SETTINGS.md)
- Gateway envelopes: [MCP.md](MCP.md)
