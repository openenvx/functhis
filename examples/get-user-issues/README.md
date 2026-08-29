# Example package: get-user-issues

Layout of a Functhis package — the same shape autonomous learning writes under `packages/auto-*`.

This example targets the **demo fixture** MCP server (`fixtures/servers/readonly.ts`): look up a user, then list issues. It is documentation, not a live GitHub integration. Schema hashes in `functhis.lock` are placeholders.

```text
examples/get-user-issues/
  function.ts
  functhis.json
  functhis.lock
  tests/replay.fixture.json
```

Install into a project (after `fn setup` with the demo upstreams):

```sh
fn functions test get-user-issues   # if copied to ./packages/get-user-issues
```

Or copy the folder to `packages/get-user-issues/` and restart the MCP client so it appears as a gateway tool.

See [docs/PACKAGES.md](../docs/PACKAGES.md) for the manifest and lock contract.
