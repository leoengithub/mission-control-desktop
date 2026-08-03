# Product

## Register

product

## Users

Mission Control is for software developers and pull request reviewers who need to manage many authored and review-requested pull requests without repeatedly navigating GitHub. They use it throughout the workday to identify what changed, understand why a pull request needs attention, and move directly into review, repair, terminal, worktree, or agent-assisted action.

## Product Purpose

Mission Control is a local-first attention inbox for pull requests. It combines review requests, unresolved threads, failing required checks, and agent escalation states into one prioritized workspace. Success means the user can answer three questions immediately: what needs me, why does it need me, and what can I do next.

The product should reduce manual refreshes and fragmented navigation through background synchronization, cached state, native notifications, and focused detail views. Monitoring and review must work without local tooling. Terminals, worktrees, and agent controls appear contextually when they help complete the work.

## Brand Personality

Calm, precise, and quietly capable. The interface should feel like a focused review desk: dense enough for expert work, spacious enough to scan, and confident without becoming loud. Copy is direct and operational. The product earns trust by making state, provenance, and consequences legible.

## Anti-references

- GitHub's fragmented pull request navigation, where review threads, checks, notifications, and authored work require separate searches and repeated context switching.
- Generic card-heavy SaaS dashboards that turn every datum into an isolated tile and obscure the primary workflow.
- Terminal-first developer tools that use dark surfaces, neon accents, or code aesthetics as decoration.
- Interfaces that encode success, warning, or failure through color alone.
- Marketing-page spacing and oversized typography inside task-focused application surfaces.

## Design Principles

1. **Attention before inventory.** Lead with escalated work and the reason it changed, not a flat list of every pull request.
2. **Keep context beside action.** Preserve the pull request list, review detail, and optional terminal or agent context without forcing unnecessary navigation.
3. **Reveal power progressively.** Monitoring and review are always available. Worktrees, terminals, and agent controls appear when the current task benefits from them.
4. **Make state trustworthy.** Show when data was synchronized, distinguish cached from live state, and preserve useful failure information.
5. **Feel native and immediate.** Favor fast startup, cached rendering, restrained motion, and direct manipulation over decorative transitions.

## Accessibility & Inclusion

Status must never rely on color alone. Success, attention, failure, pending, interrupted, and disabled states pair semantic color with an icon, text label, count, or shape. Maintain readable contrast and support reduced motion. Full keyboard workflow optimization is intentionally outside the first visual implementation, but the design must not introduce structures that prevent it from being added later.
