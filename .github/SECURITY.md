# Security

Report vulnerabilities through [GitHub private vulnerability reporting](https://github.com/griffinzhai917/modeltrace-monitor/security/advisories/new). Do not post credentials or exploit details in public issues. Responses are best effort; there is no response-time guarantee.

Include the affected commit, a minimal mock reproduction, impact, and relevant redacted configuration. No live API credentials or account exports are needed.

The monitor sends an ordinary API key only to its configured endpoint, refuses redirects, bounds response sizes, and stores scores and sanitized diagnostics rather than raw model output. Operators must secure their configuration, environment and state directory. Local history is not an immutable audit log.

A false fingerprint warning is a detection-quality issue unless it demonstrates a security vulnerability. This project never disables accounts. Only the current main branch is maintained at this experimental stage.
