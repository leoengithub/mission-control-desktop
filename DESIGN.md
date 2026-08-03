---
name: Mission Control Desktop
description: A calm native attention inbox for pull request review work.
---

<!-- SEED: re-run /impeccable document once the interface exists to capture actual tokens and components. -->

# Design System: Mission Control Desktop

## Overview

**Creative North Star: "The Review Desk"**

Mission Control should feel like a bright, organized desk used by a developer on a large monitor during focused work. The persistent rail, compact pull request list, generous review surface, and optional third context pane keep related work visible without making every region equally prominent. The composition is quiet and mostly flat, with density concentrated in lists and check results and breathing room reserved for comprehension.

The primary references are the Tembo Reviews master-detail workspace, the Tembo Computer and Checks split view, and the Tembo Insights settings shell. Borrow their calm near-white surfaces, narrow dividers, compact controls, and semantic state treatment. Do not copy their product content or turn the application into a marketing surface.

Motion is responsive but restrained. Use 150 to 220 millisecond ease-out transitions for selection, disclosure, pane appearance, and status changes. Animate opacity and transform only. Do not choreograph page entrances or delay access to current state. Reduced-motion preferences remove non-essential movement.

**Key Characteristics:**

- Persistent narrow navigation rail with clear active state
- Master-detail layout, with an optional third pane for terminal or agent context
- Compact lists paired with a spacious reading surface
- Near-white tinted surfaces separated by fine dividers and tonal shifts
- Semantic status language that combines color, icon, label, and count
- Controls that feel native, quiet, and immediately actionable

## Colors

Use a restrained palette derived from the references: near-white cool-neutral canvas, softly tinted secondary surfaces, graphite text, and semantic green, amber, red, blue, and muted gray. Exact values remain **[to be resolved during implementation]** and should be expressed as OKLCH design tokens once the first interface is built.

### Primary

- **Action Graphite:** The default primary-action family. It should read as confident and neutral rather than decorative. **[value to be resolved during implementation]**
- **Review Green:** Approval, successful checks, open-ready states, and safe completion. Pair it with a check, branch, arrow, or explicit label. **[value to be resolved during implementation]**

### Secondary

- **Attention Amber:** Review requested, pending work, waiting states, and non-destructive escalation. Pair it with a clock, ring, count, or text label. **[value to be resolved during implementation]**
- **Failure Red:** Failing checks, critical review findings, agent failure, and destructive consequences. Pair it with a cross, severity glyph, or explicit text. **[value to be resolved during implementation]**
- **Context Blue:** Informational selection, charts, links, and neutral context where green would imply success. **[value to be resolved during implementation]**

### Neutral

- **Canvas Mist:** The lightly tinted application background. Never pure white. **[value to be resolved during implementation]**
- **Working Surface:** The primary reading and interaction surface, separated from the canvas through a subtle tonal shift. **[value to be resolved during implementation]**
- **Quiet Fill:** Selection rows, code tokens, filter chips, and secondary controls. **[value to be resolved during implementation]**
- **Graphite Ink:** Primary text. Never pure black. **[value to be resolved during implementation]**
- **Muted Ink:** Metadata and secondary labels, while retaining accessible contrast. **[value to be resolved during implementation]**
- **Hairline:** Dividers, field outlines, and pane boundaries. **[value to be resolved during implementation]**

### Named Rules

**The Redundancy Rule.** Every semantic color is paired with an icon, label, count, shape, or pattern. Color is reinforcement, never the only signal.

**The Quiet Canvas Rule.** Semantic color belongs to state and action. Large passive surfaces stay neutral and softly tinted.

## Typography

**Display Font:** Single neutral system sans **[exact stack to be validated during implementation]**

**Body Font:** The same system sans **[exact stack to be validated during implementation]**

**Label/Mono Font:** System monospace only for code, SHAs, commands, paths, and terminal content **[exact stack to be validated during implementation]**

**Character:** Compact, modern, and highly legible. Hierarchy comes from weight, spacing, and placement more often than dramatic size changes. The system should feel native on macOS and avoid a web-dashboard personality.

### Hierarchy

- **Headline:** Semibold, compact, and reserved for the current pull request or major settings section. **[exact size to be resolved during implementation]**
- **Title:** Semibold for pane titles, review sections, and grouped attention reasons. **[exact size to be resolved during implementation]**
- **Body:** Regular weight with comfortable reading line length for summaries and review content. **[exact size to be resolved during implementation]**
- **UI Body:** Compact regular or medium text for rows, controls, checks, and metadata. **[exact size to be resolved during implementation]**
- **Label:** Medium weight for short state labels, tabs, chips, and counts. Avoid all caps. **[exact size to be resolved during implementation]**

### Named Rules

**The Dense Edge, Calm Center Rule.** Navigation and inventory can be compact. Reading and decision surfaces receive more space and longer line height.

## Elevation

The system is flat by default. Pane hierarchy comes from tonal surfaces, hairline dividers, and spatial separation. Shadows are reserved for transient overlays, floating menus, dragged elements, and the rare surface that genuinely overlaps another. **[exact shadow vocabulary to be resolved during implementation]**

### Named Rules

**The Structural Depth Rule.** If spacing, alignment, and a tonal change can explain hierarchy, a shadow is forbidden.

## Components

The seed establishes component character without declaring final tokens. Controls are compact, softly rounded, and visually quiet at rest. Primary actions use Action Graphite or a semantic color only when the action itself has that meaning. Search, filters, tabs, list rows, status chips, disclosure rows, pane headers, and terminal controls must share one consistent shape and state vocabulary. Exact component definitions will be extracted after the first interface implementation.

## Do's and Don'ts

### Do:

- **Do** use master-detail or three-pane composition when adjacent context prevents navigation.
- **Do** keep pull request rows compact and make the selected row obvious through fill, type weight, and position.
- **Do** pair status color with an icon, label, count, shape, or pattern.
- **Do** reserve generous spacing for summaries, review findings, check details, and decisions.
- **Do** use short 150 to 220 millisecond ease-out transitions for state changes and pane disclosure.
- **Do** preserve the feeling of the supplied Tembo Reviews, Computer, Checks, and Insights references.

### Don't:

- **Don't** reproduce GitHub's fragmented pull request navigation or require repeated context switching.
- **Don't** create generic card-heavy SaaS dashboards or nested cards.
- **Don't** use terminal-first dark surfaces, neon accents, or code aesthetics as decoration.
- **Don't** use color alone to communicate success, attention, failure, pending, or disabled state.
- **Don't** use marketing-page typography, oversized headings, decorative motion, gradient text, glassmorphism, or colored side-stripe borders.
- **Don't** animate layout properties or delay access to live state with page-load choreography.
