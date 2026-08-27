// Functhis Function — edit input bindings and review required tools before replay.
// Source run: benchmark-replay
// Created: 2026-08-27T12:22:03.634Z
// This file is data for the Functhis runner; it is not executed as code.

export default 
{
  "apiVersion": "functhis.dev/v2",
  "description": "Benchmark replay for config-yaml-drift",
  "inputs": {},
  "name": "config-yaml-drift",
  "plan": {
    "output": "$step.fetch",
    "steps": [
      {
        "args": {},
        "id": "fetch",
        "select": "settings | {key: `replicas`, expected: replicas_expected, actual: replicas}",
        "tool": "fnbench.get_cluster_config"
      }
    ],
    "version": 1
  },
  "policy": {
    "allowNetwork": "upstream-only",
    "allowedTools": [
      "fnbench.get_cluster_config"
    ],
    "maxBytesPerResult": 262144,
    "maxCalls": 1,
    "writes": "deny"
  },
  "provenance": {
    "createdAt": "2026-08-27T12:22:03.634Z",
    "sourceRunId": "benchmark-replay"
  },
  "requiredTools": [
    "fnbench.get_cluster_config"
  ],
  "runtime": {
    "maxConcurrency": 1,
    "maxDurationMs": 900000,
    "maxOutputBytes": 262144,
    "maxTotalOutputBytes": 2097152
  },
  "sourcePath": "functions/config-yaml-drift.ts",
  "toolFingerprints": {
    "fnbench.get_cluster_config": "3eaeb70af02a696e"
  }
};
