# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 0.1.x   | Yes       |
| < 0.1   | No        |

## Reporting a Vulnerability

Please **do not** open public GitHub issues for security vulnerabilities.

Email security reports to the maintainers via GitHub private security advisories on [openenvx/functhis](https://github.com/openenvx/functhis/security/advisories/new) if enabled, or contact the repository owner directly.

Include:

- Affected version
- Steps to reproduce
- Impact assessment
- Suggested fix (optional)

We aim to acknowledge reports within 5 business days.

## Scope

Functhis is a local MCP gateway. Reports are in scope when they demonstrate:

- Secret leakage into traces, fixtures, or logs
- Path traversal outside configured roots
- Unauthorized upstream tool invocation bypassing policy
- Command injection via upstream configuration or tool arguments

Out of scope for the local open-source product:

- Upstream MCP server vulnerabilities (report to the upstream provider)
- Social engineering against tool descriptions (mitigated by treating results as untrusted data)

## Safe Defaults

- Unknown and write tools are denied by default in the gateway
- Secrets are redacted before trace persistence
- Generated Functions are data, not arbitrary executable code in local mode
