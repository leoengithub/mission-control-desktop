# Mission Control Desktop

Mission Control Desktop is a local-first native application for finding and completing GitHub pull request review work. It is being built as a macOS-first Tauri application with a Rust core and a React renderer.

The repository intentionally starts from a clean implementation. The previous Mission Control application remains a behavioral reference and maintained fallback until this replacement reaches acceptance.

## Current status

The repository contains the first complete local review workflow:

- Tauri and React application boundary
- versioned safe-by-default settings
- SQLite persistence and initial schema
- attention-state reconciliation contracts
- GitHub CLI authentication using the user's active `gh` account
- cached authored/review-requested PR synchronization with background refresh
- event-driven renderer updates after native background synchronization
- rate-limit-aware retry windows while cached pull requests stay available offline
- typed renderer-to-core commands
- GitHub CLI, repository selection, and first-sync onboarding
- a master-detail attention inbox for review requests, unresolved threads, and failing checks
- cached review conversations with file locations, human or automated origin, new-activity state, and check-run detail
- GitHub review-thread reply and resolve mutations with durable per-run checkpoints for safe retry
- an explicit Copilot review request action
- verified local repository attachments and detached, pull-request-head worktrees
- Codex and Claude Code discovery, defaults, permission controls, run history, and durable local logs
- interactive PTY sessions for agent fixes and plain worktree terminals
- safe-only worktree cleanup that preserves dirty worktrees and changed heads
- native notification delivery with durable transition deduplication and pull request deep links
- Dock and menu bar attention counts that deduplicate reasons per pull request
- settings for synchronization cadence, notification reasons, launch at login, and close behavior
- contextual notification and launch-at-login recommendations after activation
- cache freshness, manual refresh, focus refresh, empty, loading, and failure states
- a documented OKLCH visual system with accessible icon-and-label status treatments
- automatic versioned GitHub prereleases for Apple Silicon macOS

The renderer includes deterministic browser previews for design and interaction work outside the native shell. Run `corepack pnpm dev`, then use `?preview=onboarding` or `?preview=empty` to inspect those states. The default preview renders review threads, check runs, agent actions, a terminal session, contextual setup, and the settings workspace.

The application now uses the Mission Control operator-console identity across its generated platform icon bundle. Supporting onboarding, empty-state, social, tray, and semantic status assets live in `assets/brand`.

## Prerequisites

- Node.js 22 or newer
- Corepack-managed pnpm 10.14.0
- Rust 1.97.1
- GitHub CLI authenticated with `gh auth login`
- macOS 13 or newer for the first supported desktop target

## Development

Mission Control uses the active account from GitHub CLI. Authenticate once before opening the app:

```sh
gh auth login
gh auth status
```

Packaged macOS builds search the normal `PATH`, common Homebrew locations, and the login shell for `gh`. Set `MC_GH_PATH` when developing with a non-standard GitHub CLI location.

```sh
corepack pnpm install
corepack pnpm tauri dev
```

Run all available checks:

```sh
corepack pnpm check
```

## Local review workflow

1. Connect the active GitHub CLI account and let the first background sync populate the inbox.
2. Attach the matching local Git root in Settings. Mission Control validates the `origin` remote against the GitHub repository.
3. Select Codex or Claude Code as the default local agent.
4. Use **Reply and resolve** for a read-only, evidence-based response, or **Fix and reply** for an isolated interactive worktree session.
5. End the terminal session, inspect the result, then choose **Complete and resolve**. GitHub reply and resolution checkpoints are recorded independently so a failed second step does not duplicate the first.

Mission Control never commits or pushes from these workflows. Worktrees with changes or a changed `HEAD` are preserved.

## macOS dogfood builds

The application can be used locally without a paid Apple Developer account. Build an ad-hoc-signed application bundle on an Apple Silicon Mac:

```sh
APPLE_SIGNING_IDENTITY=- corepack pnpm tauri build --bundles app
open 'src-tauri/target/release/bundle/macos/Mission Control.app'
```

To keep the application outside Cargo's rebuildable output, copy it into your user Applications directory:

```sh
mkdir -p "$HOME/Applications"
ditto 'src-tauri/target/release/bundle/macos/Mission Control.app' \
  "$HOME/Applications/Mission Control.app"
```

After CI succeeds for a push to `main`, the **Release macOS beta** GitHub Actions workflow publishes a new prerelease using the next automatic `v0.1.<run-number>` version. Download the Apple Silicon DMG directly from the repository's **Releases** page and drag Mission Control into Applications. The workflow can also be run manually when a replacement build is needed for the current commit.

The bundle is ad-hoc signed rather than notarized, so macOS may require confirming the first launch in **System Settings → Privacy & Security**. Workflow artifacts are still retained as a fallback, but the GitHub Release asset is the stable download location.

Public distribution remains a separate milestone. A broadly downloadable release will require a Developer ID Application certificate and Apple notarization credentials; Windows, Linux, and automatic updates are intentionally outside the current dogfood workflow.

## Privacy and security

Mission Control is local-first. GitHub CLI owns credential storage; Mission Control reads the active token only in native core memory while making GitHub requests and does not copy it into renderer storage, SQLite, or its own credential store. PR metadata, review threads, GitHub mutation checkpoints, and agent-run metadata are stored in the application data directory. Agent output is stored in local log files and can contain private repository context. Telemetry and remote crash uploads are not enabled.

See [SECURITY.md](SECURITY.md) for reporting instructions and [ARCHITECTURE.md](ARCHITECTURE.md) for trust boundaries.

## License

Apache-2.0. See [LICENSE](LICENSE).
