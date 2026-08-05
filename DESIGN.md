---
name: Mission Control Desktop
description: A calm native attention inbox for pull request review work.
colors:
  canvas: 'oklch(97.7% 0.008 225)'
  surface: 'oklch(99.2% 0.005 128)'
  surface-raised: 'oklch(99.7% 0.004 128)'
  surface-muted: 'oklch(96.1% 0.009 128)'
  surface-selected: 'oklch(94.8% 0.024 139)'
  ink: 'oklch(23% 0.012 128)'
  ink-secondary: 'oklch(48% 0.01 128)'
  ink-muted: 'oklch(52% 0.01 128)'
  hairline: 'oklch(89.5% 0.008 128)'
  hairline-strong: 'oklch(84% 0.009 128)'
  action: 'oklch(21% 0.014 128)'
  action-hover: 'oklch(28% 0.016 128)'
  success: 'oklch(54% 0.16 143)'
  success-deep: 'oklch(40% 0.13 143)'
  success-soft: 'oklch(94% 0.035 143)'
  warning: 'oklch(67% 0.145 74)'
  warning-deep: 'oklch(47% 0.12 66)'
  warning-soft: 'oklch(95.5% 0.036 78)'
  danger: 'oklch(55% 0.19 29)'
  danger-deep: 'oklch(43% 0.16 29)'
  danger-soft: 'oklch(95% 0.03 29)'
  info: 'oklch(56% 0.14 248)'
  info-deep: 'oklch(43% 0.115 248)'
  info-soft: 'oklch(95% 0.025 248)'
  focus: 'oklch(58% 0.15 248)'
typography:
  display:
    fontFamily: '-apple-system, BlinkMacSystemFont, SF Pro Text, Segoe UI, system-ui, sans-serif'
    fontSize: 'clamp(2.5rem, 5vw, 4.6rem)'
    fontWeight: 650
    lineHeight: 0.98
    letterSpacing: '-0.055em'
  headline:
    fontFamily: '-apple-system, BlinkMacSystemFont, SF Pro Text, Segoe UI, system-ui, sans-serif'
    fontSize: '1.35rem'
    fontWeight: 670
    lineHeight: 1.2
    letterSpacing: '-0.025em'
  title:
    fontFamily: '-apple-system, BlinkMacSystemFont, SF Pro Text, Segoe UI, system-ui, sans-serif'
    fontSize: '1.05rem'
    fontWeight: 650
    lineHeight: 1.45
    letterSpacing: '-0.015em'
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, SF Pro Text, Segoe UI, system-ui, sans-serif'
    fontSize: '0.875rem'
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: 'normal'
  label:
    fontFamily: '-apple-system, BlinkMacSystemFont, SF Pro Text, Segoe UI, system-ui, sans-serif'
    fontSize: '0.75rem'
    fontWeight: 650
    lineHeight: 1.45
    letterSpacing: '0.04em'
rounded:
  sm: '7px'
  md: '11px'
  lg: '16px'
  pill: '999px'
spacing:
  1: '4px'
  2: '8px'
  3: '12px'
  4: '16px'
  5: '24px'
  6: '32px'
  7: '48px'
components:
  button-primary:
    backgroundColor: '{colors.action}'
    textColor: '{colors.surface}'
    rounded: '{rounded.sm}'
    padding: '0 16px'
    height: '38px'
  button-primary-hover:
    backgroundColor: '{colors.action-hover}'
    textColor: '{colors.surface}'
  button-quiet:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    rounded: '{rounded.sm}'
    padding: '0 16px'
    height: '38px'
  search-field:
    backgroundColor: '{colors.surface-raised}'
    textColor: '{colors.ink}'
    rounded: '{rounded.sm}'
    padding: '0 12px'
    height: '38px'
  status-warning:
    backgroundColor: '{colors.warning-soft}'
    textColor: '{colors.warning-deep}'
    rounded: '{rounded.pill}'
    padding: '0 9px'
    height: '26px'
  status-danger:
    backgroundColor: '{colors.danger-soft}'
    textColor: '{colors.danger-deep}'
    rounded: '{rounded.pill}'
    padding: '0 9px'
    height: '26px'
  review-row-selected:
    backgroundColor: '{colors.surface-selected}'
    textColor: '{colors.ink}'
    rounded: '{rounded.md}'
    padding: '8px 12px'
  activation-panel:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    rounded: '{rounded.lg}'
    padding: '24px'
---

# Design System: Mission Control Desktop

## Overview

**Creative North Star: "The Review Desk"**

Mission Control is a bright, organized desk for focused pull request work. A compact attention inventory stays beside a generous reading surface so the user can answer what needs them, why, and what to do next without losing context. Account identity, monitoring state, and settings live in the inventory footer instead of consuming a separate navigation rail. Density belongs at the edge. Comprehension gets space in the center.

The system is calm, precise, and quietly capable. It uses softly tinted near-white materials, graphite text, hairline boundaries, and semantic accents only when state deserves attention. It rejects GitHub's fragmented navigation, generic card-heavy SaaS dashboards, terminal-first neon decoration, color-only status, and marketing-page typography.

Motion is responsive but restrained: 120ms for direct press feedback and 190ms for state transitions, both using an expressive ease-out curve. Animate opacity and transform; never choreograph page entrances or block access to current state. The app targets desktop windows from 960px upward and preserves reduced-motion preferences.

**Key Characteristics:**

- Persistent inventory footer with GitHub identity, monitoring state, and settings access
- Section navigation inside settings, separated from global destinations
- Master-detail review workspace with a 320–390px attention inventory
- Compact rows paired with a spacious, readable pull request surface
- Near-white tonal layers separated by 1px hairlines instead of card shadows
- Status treatment that always combines color, icon, label, count, or shape
- Cached-data provenance and synchronization state kept visible at all times

## Colors

The palette is a cool botanical neutral field with low-chroma green surfaces and deliberate amber, red, and blue signals. The OKLCH values in frontmatter are canonical; Stitch may warn because its validator expects sRGB hex.

### Primary

- **Action Graphite** (`colors.action`): Primary buttons and high-confidence actions. Its hover variant is `colors.action-hover`; never substitute a semantic color for an unrelated action.
- **Review Green** (`colors.success`): Successful checks, completed setup, healthy monitoring, and clear inbox states. Use `success-deep` for text and `success-soft` for quiet fills.

### Secondary

- **Attention Amber** (`colors.warning`): Review requests, open threads, waiting, pending work, and current onboarding steps. Use the deep/soft pair for legible labels and low-noise surfaces.
- **Failure Red** (`colors.danger`): Failing required checks, blocking errors, and destructive consequences. Red is forbidden for neutral emphasis.

### Tertiary

- **Context Blue** (`colors.info`): Informational context and focus-adjacent state where green would falsely imply success. Use sparingly.

### Neutral

- **Canvas Mist** (`colors.canvas`): The application field. It is intentionally tinted and never pure white.
- **Working Surface** (`colors.surface`): Headers, list panes, and primary reading boundaries.
- **Raised Paper** (`colors.surface-raised`): Inputs and small controls that need one tonal step of separation.
- **Quiet Fill** (`colors.surface-muted`): Hover, neutral grouping, skeletons, and secondary action surfaces.
- **Selected Sage** (`colors.surface-selected`): Active pull request rows and active navigation destinations.
- **Graphite Ink** (`colors.ink`): Primary text. `ink-secondary` carries metadata; `ink-muted` is reserved for nonessential timestamps and provenance.
- **Hairline Fog** (`colors.hairline`): Pane dividers and surface boundaries. `hairline-strong` is for control outlines.

### Named Rules

**The Redundancy Rule.** Every semantic color is paired with an icon, label, count, shape, or pattern. Color is reinforcement, never the only signal.

**The Quiet Canvas Rule.** Semantic color belongs to state and action. Large passive surfaces remain neutral and softly tinted.

**The One Red Rule.** Failure Red means a condition is blocking or broken. Never use it for decoration, activity, or urgency without consequence.

## Typography

**Display Font:** Native system sans (San Francisco on macOS, Segoe UI on Windows)

**Body Font:** The same native system sans

**Label/Mono Font:** SFMono-Regular, Menlo, or Consolas for SHAs, device codes, paths, commands, and terminal content only

**Character:** Compact, modern, and native. Hierarchy comes from weight, spacing, and placement more often than dramatic size shifts; the first-run message is the only deliberate display-scale exception.

### Hierarchy

- **Display** (650, `typography.display`): First-run headline only; balanced to roughly 11 characters per line.
- **Headline** (670, `typography.headline`): Current pull request title, fixed at 1.35rem and capped near 38ch for scanability.
- **Title** (650, `typography.title`): Attention summaries, pane sections, and grouped review state.
- **Body** (400, `typography.body`): Explanations and reason summaries; cap prose near 68ch.
- **Label** (650, `typography.label`): Short section overlines and operational context. Uppercase is allowed only for these compact wayfinding labels.

### Named Rules

**The Dense Edge, Calm Center Rule.** Inventory text stays compact; reading and decision surfaces receive more space and a 1.6 line height.

**The Native Voice Rule.** Do not import a decorative webfont. Mission Control must look and render like a desktop tool before it looks branded.

## Elevation

The application is flat by default. Depth comes from tonal surfaces, 1px hairlines, persistent pane geometry, and selected fills. The only shadow token is an ambient floating shadow for transient overlays, menus, dragged elements, or future terminal popovers; it is forbidden on ordinary content containers.

### Shadow Vocabulary

- **Floating Ambient** (`0 14px 40px oklch(28% 0.02 128 / 0.12)`): Transient surfaces that physically overlap the workspace. Never use on the inbox, detail surface, onboarding panel, or status chips.

### Named Rules

**The Structural Depth Rule.** If spacing, alignment, a tonal change, and a 1px hairline explain hierarchy, a shadow is forbidden.

**The No Nested Cards Rule.** A bordered panel may contain rows and sections, not smaller decorative cards. Separate content with rhythm and hairlines.

## Components

Components are refined and restrained: compact dimensions, modest curvature, immediate feedback, and no ornamental chrome. The source implementation in `src/styles.css` is authoritative when a future screen needs exact interaction selectors.

### Buttons

- **Shape:** Gently curved rectangle (`rounded.sm`, minimum height 38px) with 16px horizontal padding.
- **Primary:** Action Graphite with Working Surface text; reserve it for the dominant next action.
- **Hover / Focus:** Shift to Action Graphite Hover over 190ms. Focus uses a 2px Context Blue outline with 2px offset. Press feedback scales to 0.98 over 120ms.
- **Quiet:** Working Surface, a strong hairline outline, and Graphite Ink. Hover strengthens the outline and lifts only tonally.
- **Icon:** Use the existing 15–18px stroke icon beside an explicit verb. Icon-only buttons require an accessible label.

### Chips

- **Style:** Pill shape (`rounded.pill`), 26px high, with a 1px semantic border and soft fill.
- **State:** Every chip carries a small icon and a written label; compact inbox variants are 21px high. Do not create color-only dots as standalone status.

### Cards / Containers

- **Corner Style:** Medium containers use 11px; the single onboarding panel uses 16px.
- **Background:** Working Surface over Canvas Mist. Selection uses Selected Sage.
- **Shadow Strategy:** Flat by default; follow the Structural Depth Rule.
- **Border:** One Hairline Fog stroke. Strong Hairline is reserved for controls.
- **Internal Padding:** 16px for toolbars, 24px for panels, and 28–56px responsive gutters for the detail surface.

### Inputs / Fields

- **Style:** Raised Paper fill, Strong Hairline border, 7px radius, 38px height, and a leading 16px search icon.
- **Focus:** Context Blue border plus a soft 3px blue ring. Do not rely on removing the outline.
- **Error / Disabled:** Errors combine Failure Red, an alert icon, and explanatory copy. Disabled controls preserve their label and use reduced opacity.

### Navigation

- **Style:** Reviews are the default workspace. The pull-request inventory footer combines GitHub identity, written monitoring state, and a 34px settings target.
- **Behavior:** Settings replace the workspace and provide an explicit Back to reviews action. Navigation never animates the workspace layout.
- **Settings:** A 190–220px tinted section rail sits inside the settings workspace at wide desktop sizes and collapses below the minimum comfortable split width.

### Attention Inbox

- **Row:** A 66px minimum-height button with avatar, title/repository metadata, icon-plus-label reason, and relative time.
- **Selection:** Selected Sage fill plus `aria-pressed`; selection updates the adjacent detail without navigation.
- **Grouping:** Needs Attention uses Amber soft fill and a clock icon. Other Open uses Quiet Fill and a branch icon. Each heading includes a written label and count.
- **Detail:** Lead with the reason, repository identity, pull request title, SHA/author/freshness metadata, and one explicit GitHub action. Attention rows show icon, label, explanation, source, and timestamp.

### Activation Panel

- **Structure:** Exactly three visible steps—GitHub authorization, repository access, and first inbox synchronization—with written Current, Later, and Done states.
- **Copy:** Descriptions wrap at the 960px minimum window; repository access language must never be truncated.
- **Progress:** Waiting and scanning use restrained spinners or pulses plus live text. Device codes use system monospace and an explicit copy control.

## Do's and Don'ts

### Do:

- **Do** lead with escalated work and the reason it changed before showing ordinary inventory.
- **Do** preserve the 320–390px inventory pane, its account footer, and the adjacent detail surface when context switching would otherwise be required.
- **Do** keep pull request rows compact and make selection visible through fill, type weight, position, and `aria-pressed`.
- **Do** pair every semantic color with an icon, written label, count, shape, or pattern.
- **Do** show cache provenance and synchronization time; trust depends on knowing how fresh the state is.
- **Do** use 120ms press feedback and 190ms ease-out state transitions, with reduced-motion overrides.
- **Do** preserve readable onboarding copy at the 960px minimum desktop width.

### Don't:

- **Don't** reproduce GitHub's fragmented pull request navigation or force repeated context switching among review threads, checks, notifications, and authored work.
- **Don't** create generic card-heavy SaaS dashboards or nested cards; if every datum sits in a tile, the hierarchy has failed.
- **Don't** use terminal-first dark surfaces, neon accents, or code aesthetics as decoration.
- **Don't** communicate success, warning, failure, pending, interrupted, or disabled state through color alone.
- **Don't** use marketing-page spacing or oversized typography inside task-focused workspace surfaces; display scale belongs only to first-run onboarding.
- **Don't** use gradient text, glassmorphism, colored side-stripe borders, or decorative page-load choreography.
- **Don't** apply shadows to persistent panes, inbox rows, detail sections, or the onboarding panel.
- **Don't** animate width, height, grid columns, or other layout properties; animate opacity and transform only.
