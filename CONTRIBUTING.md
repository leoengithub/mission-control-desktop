# Contributing

Mission Control Desktop is under active architectural development.

## Expectations

- Preserve the Rust core and renderer privilege boundary.
- Keep settings and IPC types versioned and synchronized between Rust and TypeScript.
- Add migrations for persistent schema changes.
- Add deterministic tests for attention-state transitions and destructive filesystem behavior.
- Do not add telemetry, agent permission bypass, remote services, or destructive cleanup defaults without an explicit product decision.
- Preserve the Review Desk visual system and its icon-and-label status semantics.
- Never make reply-only agent commands writable or let renderer code spawn local processes directly.
- Keep GitHub reply and resolution checkpoints independently retryable.
- Worktree cleanup changes require tests for dirty state, path containment, active sessions, and changed heads.

## Checks

```sh
corepack pnpm check
```

Do not run destructive Git cleanup against user repositories. Native packaging is verified by the tagged release workflow; signing and notarization require maintainer-owned repository secrets.
