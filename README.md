# Mission Control Desktop

Mission Control Desktop is a local-first native application for finding and completing GitHub pull request review work. It is being built as a macOS-first Tauri application with a Rust core and a React renderer.

The repository intentionally starts from a clean implementation. The previous Mission Control application remains a behavioral reference and maintained fallback until this replacement reaches acceptance.

## Current status

The repository contains the native foundation:

- Tauri and React application boundary
- versioned safe-by-default settings
- SQLite persistence and initial schema
- attention-state reconciliation contracts
- GitHub App device authorization with keychain-backed token rotation
- cached authored/review-requested PR synchronization with background refresh
- typed renderer-to-core commands

The product interface is intentionally unshaped. UI implementation begins after product references are provided and `PRODUCT.md`, `DESIGN.md`, and the shape brief are confirmed.

The generated application icon is a transparent build placeholder for the same reason.

## Prerequisites

- Node.js 22 or newer
- Corepack-managed pnpm 10.14.0
- Rust 1.97.1
- macOS 13 or newer for the first supported desktop target

## Development

Register a GitHub App, enable Device Flow, and grant repository permissions for metadata (read), pull requests (read/write), checks (read), commit statuses (read), and contents (read). The application does not use or ship a client secret.

The public GitHub App client ID is embedded in official builds. To develop against a different GitHub App, override it at compile time:

```sh
export MC_GITHUB_CLIENT_ID=your_client_id
```

```sh
corepack pnpm install
corepack pnpm tauri dev
```

Run all available checks:

```sh
corepack pnpm check
```

## Privacy and security

Mission Control is local-first. GitHub tokens are stored in the operating system keychain. PR metadata and review drafts are stored in the application data directory. Telemetry and remote crash uploads are not enabled.

See [SECURITY.md](SECURITY.md) for reporting instructions and [ARCHITECTURE.md](ARCHITECTURE.md) for trust boundaries.

## License

Apache-2.0. See [LICENSE](LICENSE).
