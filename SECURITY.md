# Security Policy

## Reporting a vulnerability

Do not open a public issue for a vulnerability involving credentials, arbitrary command execution, path traversal, repository deletion, worktree cleanup, or private GitHub data.

Until a dedicated security contact is published, use GitHub's private vulnerability reporting feature for this repository.

## Security principles

- GitHub tokens never enter renderer storage or SQLite.
- The renderer has no Node.js or shell access.
- Agent permission bypass is disabled by default and requires an explicit advanced setting.
- Worktree removal must verify the exact registered path, repository ownership, dirty state, running processes, and unique commits.
- Logs and diagnostics are user-controlled and may contain private repository context.
- No analytics or crash data leaves the machine by default.
