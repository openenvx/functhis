// Functhis Function — edit input bindings and review required tools before replay.
// Source run: run-mtar0fe2-zuwghb8x
// Created: 2026-08-26T23:52:09.302Z
// This file is data for the Functhis runner; it is not executed as code.

export default 
{
  "apiVersion": "functhis.dev/v2",
  "description": "Compiled from run run-mtar0fe2-zuwghb8x (2 steps)",
  "inputs": {
    "owner": {
      "type": "string"
    },
    "repo": {
      "type": "string"
    },
    "userId": {
      "type": "string"
    }
  },
  "name": "lookup-user-issues",
  "plan": {
    "output": "$step.list_issues",
    "steps": [
      {
        "args": {
          "userId": "$input.userId"
        },
        "id": "get_user",
        "tool": "readonly.get_user"
      },
      {
        "args": {
          "owner": "$input.owner",
          "prior": "$step.get_user",
          "repo": "$input.repo"
        },
        "dependsOn": [
          "get_user"
        ],
        "id": "list_issues",
        "tool": "readonly.list_issues"
      }
    ],
    "version": 1
  },
  "policy": {
    "allowNetwork": "upstream-only",
    "allowedTools": [
      "readonly.get_user",
      "readonly.list_issues"
    ],
    "maxBytesPerResult": 262_144,
    "maxCalls": 2,
    "writes": "deny"
  },
  "provenance": {
    "createdAt": "2026-08-26T23:52:09.302Z",
    "sourceRunId": "run-mtar0fe2-zuwghb8x"
  },
  "requiredTools": [
    "readonly.get_user",
    "readonly.list_issues"
  ],
  "runtime": {
    "maxConcurrency": 1,
    "maxDurationMs": 900_000,
    "maxOutputBytes": 262_144,
    "maxTotalOutputBytes": 2_097_152
  },
  "sourcePath": "functions/lookup-user-issues.ts",
  "toolFingerprints": {
    "readonly.get_user": "7161c166abf08957",
    "readonly.list_issues": "4a4f1d69e54f57ac"
  }
};
