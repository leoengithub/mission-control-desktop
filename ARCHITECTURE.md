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
- Review cache: pull request, thread, comment, and check snapshots in SQLite.
- Agent state: durable run rows and output logs, including independent reply and resolution checkpoints.
- Failed, interrupted, dirty, or changed-head worktrees: preserved until explicit inspected cleanup.

## Synchronization

The first release is local-only and has no hosted webhook relay. The core therefore uses rate-limit-aware adaptive polling:

- actionable PRs target refresh within 60 seconds;
- PR discovery targets refresh within five minutes;
- launch, focus, mutations, and agent completion request an immediate reconciliation;
- cached snapshots remain visible during transient failures.

Every native synchronization attempt emits a typed renderer event. Successful background work causes the renderer to reload the SQLite-backed snapshot immediately, so correctness does not depend on a renderer polling timer or manual refresh. Failed events keep the cached snapshot visible and include a retry delay when GitHub has rate-limited the client.

HTTP `429`, exhausted `403`, and GraphQL rate-limit responses open a native retry window. Background synchronization will not issue another request before that window closes. Ordinary offline and transport failures use the selected adaptive polling interval.

The monitored universe is the union of open pull requests authored by the signed-in user and open pull requests where that user is currently requested as a reviewer. GitHub node IDs deduplicate overlap between those scopes.

GitHub authorization uses the GitHub App device flow so the distributed native client never embeds a client secret. Device codes stay in core memory, polling respects GitHub's server-provided interval and `slow_down` response, and access/refresh tokens are written to the operating system credential store before account activation is persisted.

## Progressive setup

Only GitHub authorization, repository access, and the initial sync belong to activation. Notifications, launch at login, local repository attachment, and agent setup are contextual prompts after activation and can be dismissed. Local tooling is never required to monitor or review a pull request.

Notification and launch-at-login prompts appear only after their value is clear. Enabling notifications requests operating-system permission at the point of action. All choices remain editable in Settings and are persisted atomically.

## Local execution

Local actions require an attached repository whose canonical Git root and `origin` remote match the selected GitHub repository. Fix sessions start from the synchronized pull request head in a detached worktree below the configured Mission Control worktree base. A worktree path includes the repository, pull request number, thread, action, and source head so refreshed pull requests cannot silently reuse an older checkout.

The native core owns PTY processes, resize and input handling, durable output logs, exit state, and termination. The renderer receives output events and cannot spawn arbitrary processes directly. Non-interactive reply generation runs with read-only Codex sandboxing and does not inherit interactive permission-bypass settings.

GitHub reply and resolve operations are separate persisted checkpoints. Retrying a partially completed run skips any successful checkpoint, preventing duplicate comments when resolution fails after a reply is posted.

Worktree cleanup is conservative. It resolves the canonical configured base, rejects paths outside that boundary, refuses active sessions, and preserves dirty worktrees or worktrees whose head differs from the synchronized pull request commit.

## Native lifecycle

Closing the main window hides it to the menu bar by default. Launch at login and notifications are opt-in. The Dock and menu bar display the number of distinct unsnoozed pull requests needing attention, rather than the number of individual reasons.

Only newly activated attention transitions can notify. The core claims each delivery in SQLite using the attention item and activation timestamp before contacting the operating system. Successful claims survive restart, and failed transports release their claim so the same escalation can retry. Activating a notification shows and focuses the main window, then emits a pull request selection event to the renderer.

## Architecture decisions

- Tauri and Rust provide a portable native core without bundling Chromium.
- React remains the renderer because rich diffs, Markdown, xterm, keyboard navigation, and accessibility are product-critical.
- System Git remains the source of worktree behavior and existing user credentials.
- Codex and Claude Code are detected external tools, never bundled dependencies.
- Portable PTYs provide one native terminal model across supported operating systems.
- GitHub Actions creates draft multi-platform release artifacts; signing credentials stay outside the repository.
