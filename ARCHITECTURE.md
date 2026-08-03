# Architecture

## Boundaries

Mission Control has two runtime layers:

1. The Rust core owns credentials, settings, SQLite, GitHub synchronization, attention transitions, notifications, filesystem operations, Git worktrees, PTYs, and agent processes.
2. The React renderer owns presentation and user interaction. It receives typed snapshots and events through Tauri IPC and has no direct filesystem, shell, credential, or database access.

The production application does not expose an unauthenticated localhost HTTP server. Tauri capabilities and explicit commands define the renderer's authority.

## Data

- Secrets: operating system keychain only.
- Preferences: versioned JSON written atomically.
- Operational state: SQLite in WAL mode with embedded forward-only migrations.
- Diff cache: bounded to 250 MB and seven days by default.
- Failed or interrupted agent state: preserved until explicit inspected cleanup.

## Synchronization

The first release is local-only and has no hosted webhook relay. The core therefore uses rate-limit-aware adaptive polling:

- actionable PRs target refresh within 60 seconds;
- PR discovery targets refresh within five minutes;
- launch, focus, mutations, and agent completion request an immediate reconciliation;
- cached snapshots remain visible during transient failures.

The monitored universe is the union of open pull requests authored by the signed-in user and open pull requests where that user is currently requested as a reviewer. GitHub node IDs deduplicate overlap between those scopes.

GitHub authorization uses the GitHub App device flow so the distributed native client never embeds a client secret. Device codes stay in core memory, polling respects GitHub's server-provided interval and `slow_down` response, and access/refresh tokens are written to the operating system credential store before account activation is persisted.

## Progressive setup

Only GitHub authorization, repository access, and the initial sync belong to activation. Notifications, launch at login, local repository attachment, and agent setup are contextual prompts after activation and can be dismissed. Local tooling is never required to monitor or review a pull request.

## Native lifecycle

Closing the main window hides it to the menu bar by default. Explicit quit warns when agent processes are active. Launch at login and notifications are opt-in.

## Architecture decisions

- Tauri and Rust provide a portable native core without bundling Chromium.
- React remains the renderer because rich diffs, Markdown, xterm, keyboard navigation, and accessibility are product-critical.
- System Git remains the source of worktree behavior and existing user credentials.
- Codex and Claude Code are detected external tools, never bundled dependencies.
