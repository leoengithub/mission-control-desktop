# Contributing

Mission Control Desktop is under active architectural development.

## Expectations

- Preserve the Rust core and renderer privilege boundary.
- Keep settings and IPC types versioned and synchronized between Rust and TypeScript.
- Add migrations for persistent schema changes.
- Add deterministic tests for attention-state transitions and destructive filesystem behavior.
- Do not add telemetry, agent permission bypass, remote services, or destructive cleanup defaults without an explicit product decision.
- Do not implement visual product UI until the design context and shape brief are approved.

## Checks

```sh
corepack pnpm check
```
