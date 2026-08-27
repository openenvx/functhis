// Functhis Function — edit input bindings and review required tools before replay.
// Source run: benchmark-replay
// Created: 2026-08-27T12:22:03.634Z
// This file is data for the Functhis runner; it is not executed as code.

export default 
{
  "apiVersion": "functhis.dev/v2",
  "description": "Benchmark replay for test-output-failure",
  "inputs": {},
  "name": "test-output-failure",
  "plan": {
    "output": "$step.fetch",
    "steps": [
      {
        "args": {},
        "id": "fetch",
        "select": "failures[?name==`AuthToken.refresh/expired`] | [0] | {failedTest: name, file: file, line: line}",
        "tool": "fnbench.get_ci_log"
      }
    ],
    "version": 1
  },
  "policy": {
    "allowNetwork": "upstream-only",
    "allowedTools": [
      "fnbench.get_ci_log"
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
    "fnbench.get_ci_log"
  ],
  "runtime": {
    "maxConcurrency": 1,
    "maxDurationMs": 900000,
    "maxOutputBytes": 262144,
    "maxTotalOutputBytes": 2097152
  },
  "sourcePath": "functions/test-output-failure.ts",
  "toolFingerprints": {
    "fnbench.get_ci_log": "879c1a366d0d8bf1"
  }
};
