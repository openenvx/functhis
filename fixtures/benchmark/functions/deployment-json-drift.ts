// Functhis Function — edit input bindings and review required tools before replay.
// Source run: benchmark-replay
// Created: 2026-08-27T12:22:03.633Z
// This file is data for the Functhis runner; it is not executed as code.

export default 
{
  "apiVersion": "functhis.dev/v2",
  "description": "Benchmark replay for deployment-json-drift",
  "inputs": {},
  "name": "deployment-json-drift",
  "plan": {
    "output": "$step.fetch",
    "steps": [
      {
        "args": {},
        "id": "fetch",
        "select": "services[?name==`worker-billing`] | [0] | {driftedService: name, expected: expectedVersion, actual: version}",
        "tool": "fnbench.get_deployment_manifest"
      }
    ],
    "version": 1
  },
  "policy": {
    "allowNetwork": "upstream-only",
    "allowedTools": [
      "fnbench.get_deployment_manifest"
    ],
    "maxBytesPerResult": 262144,
    "maxCalls": 1,
    "writes": "deny"
  },
  "provenance": {
    "createdAt": "2026-08-27T12:22:03.633Z",
    "sourceRunId": "benchmark-replay"
  },
  "requiredTools": [
    "fnbench.get_deployment_manifest"
  ],
  "runtime": {
    "maxConcurrency": 1,
    "maxDurationMs": 900000,
    "maxOutputBytes": 262144,
    "maxTotalOutputBytes": 2097152
  },
  "sourcePath": "functions/deployment-json-drift.ts",
  "toolFingerprints": {
    "fnbench.get_deployment_manifest": "54559f527f58af67"
  }
};
