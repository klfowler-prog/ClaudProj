# Handoff: Roadmap & Initiatives — Marketing App

## Overview

This handoff covers a major addition to the Follett Marketing app: a new **Roadmap** view, an **Initiatives** model that tasks can roll up to, and a **Notes capture pipeline** (Granola sync, Slack Marketing Bot, manual paste) that feeds AI-suggested key dates onto the roadmap.

The work also tightens the existing app along the way: aligns the status taxonomy across all views, adds a Department Spaces section to the sidebar with live counts, surfaces an initiative pill on every task card, and adjusts the view toggle to host the new Roadmap mode alongside List and Board.

## About the Design Files

The files in this bundle are **design references created in HTML** — interactive prototypes built with React + Babel that demonstrate the intended look and behavior. **They are not production code to copy directly.** The task is to recreate these designs in the Follett Marketing app's existing environment (vanilla JS, jQuery-style DOM, `public/js/app.js` patterns) using its established conventions.

The live app is a single-page vanilla-JS app with a monolithic `public/js/app.js` containing all render functions, constants, and state. New views should follow the same pattern (e.g. `renderRoadmap()` parallel to `renderKanban()`).

## Fidelity

**High-fidelity.** Colors, typography, spacing, interactions, and state transitions are all final. The prototype uses the same color tokens (department colors, status colors, priority colors) as `public/css/style.css`. Recreate pixel-perfectly using the existing app's classes and patterns.

Specific values:
- Status colors and class names match `STATUS_KEYS` in `public/js/app.js` exactly (`backlog, not-started, in-progress, blocked, approved, delegated, completed`).
- Department colors match the existing department palette.
- Priority dots and left-borders match existing kanban cards.
- New surfaces (roadmap timeline, milestone diamonds, initiative drawer) introduce new tokens — see `roadmap.css`.

## Read These First

The two markdown files included in this bundle are the **source of truth** for what changes:

1. **`HANDOFF.md`** — every product decision, in order. The status taxonomy, the five ways to add a milestone, the notes capture metadata contract, anti-patterns to avoid. **Read this before writing any code.**
2. **`FILE_DIFFS.md`** — per-file engineering map: which prototype file maps to which production file, what's a modify vs. new vs. drop, and five questions to surface before starting.

This README is a high-level summary; those two are the spec.

## Screens / Views

### 1. Main shell (`Roadmap.html`)
- **Sidebar (left)**: Search, My Tasks (with count), Roadmap, Department Spaces section listing each department with a live open-task count, Inbox, Settings.
- **Stats bar (top)**: Stat pills (Overdue / Delegated / Done this wk) + a three-way view toggle (List / Board / Roadmap).
- **Main pane**: switches between List, Board (kanban), and Roadmap based on the toggle.
- When Roadmap is active, the left stats-bar chips swap from `My Tasks / My Team / All` to `All / Mine / At Risk`.

### 2. Board view (kanban)
- Columns: `Backlog · Not Started · In Progress · Blocked · Approved · Completed`. Backlog and Completed are toggleable (Backlog hidden by default, Completed shown by default). `Delegated` is a status but not a default column.
- **Each card carries an initiative pill** — the parent initiative name. Tasks not on any initiative show an "Inbox" pill.
- Top border = column status; left border = priority.

### 3. List view
- Tasks grouped by status in this order: `In Progress, Blocked, Not Started, Approved, Backlog, Completed`.
- Per-row status select exposes all 7 statuses.
- Same initiative-pill convention as kanban.

### 4. Roadmap view (new)
- Three zoom levels: `week / quarter / year`.
- Today line + "TODAY" pin on the time header.
- One row per initiative (or grouped by department, collapsible).
- **Initiative bar**: width = start→end, fill = progress (0–1), color = department, border tone = health (`on-track / at-risk / off-track`).
- **Milestones (diamonds)**: 12×12px, rotated 45°, 2px white border, soft shadow. Color by `kind`:
  - `launch` → coral
  - `event` → blue
  - `decision` → amber
  - `team` → sage
- **Suggested milestones**: dashed amber outline, transparent fill, ✦ badge — visually distinct from real milestones.
- **At Risk** initiatives get a coral 1px outline.

### 5. Initiative drawer (new)
- Right-side drawer, opened by clicking an initiative title.
- Shows: brief, milestones list, **notes log**, and tasks-on-this-initiative.
- Notes log: each row has source badge (Granola / Slack / Manual), author, timestamp, body. **Metadata is non-optional on every note.**
- "+ Add note" button opens an inline composer; auto-stamps author + timestamp; source defaults to `manual`.

### 6. Initiative form (new)
- Create / edit initiative. Power-user entry point for milestones.
- Fields: name, department, owner, start, end, progress, health, color.
- Milestones section with `+ Add milestone` rows (date / label / kind dropdown).

### 7. Task detail modal — additions
- Status pills show all 7 canonical statuses.
- Action row: `◆ Make this a key date`, `+ Add subtask`, `@ Mention`, `⏱ Snooze`.
- "Make this a key date" pushes a new milestone onto the parent initiative with `{ date: task.due, label: task.title, kind: 'decision', fromTaskId: task.id }`.

## Interactions & Behavior

### Adding a milestone (FIVE entry points — all required)

Detailed in HANDOFF.md §5.1. Summary:
1. **Right-click** anywhere on an initiative bar → quick-add popover at cursor with date pre-filled from x-position.
2. **Click an existing diamond** → editor popover (date / label / kind / Delete).
3. **Drag a diamond** sideways → date updates live; release commits. Movement >3px suppresses the click handler.
4. **Promote a task → milestone** via the `◆ Make this a key date` action in the task modal.
5. **AI-suggested milestones** appear as dashed amber diamonds. Clicking opens a popover showing source + verbatim context + Accept ✓ / Dismiss buttons. **Never auto-applied** — always require explicit Accept.

### Notes capture
Three sources, one log per initiative. Every note carries: timestamp, author, source badge, initiative tag.
- **Granola sync** — auto-routes if a Granola meeting is tagged with an initiative name.
- **Slack Marketing Bot** — `/marketing-bot note <initiative>` or thread reply with `@Marketing Bot tag <initiative>`. Fuzzy-matches initiative names.
- **Manual paste** — universal "+ Add note" on the initiative page.

### Other interactions to preserve
- Drag-drop between kanban columns triggers `Blocked → prompt for reason` on the target.
- Today-line on Roadmap is a 1px dashed vertical at today's x.
- Right-click hint on initiative bars: title attribute reads "Right-click anywhere on the bar to add a key date".

## State Management

Two collections (existing `tasks` + new `initiatives`):

```js
initiative: {
  id, name, department, ownerId,
  startDate, endDate, progress, health,
  milestones: [{ date, label, kind, fromTaskId? }],
  suggestedMilestones: [{ date, label, kind, source, context }],
  notes: [{ id, body, author, createdAt, source: 'granola'|'slack'|'manual', sourceMeta }]
}

task: {
  // ...existing fields preserved...
  initiativeId: string | null   // NEW. null = Inbox task
}
```

Migration: default `initiativeId = null` for all existing tasks.

## Design Tokens

Use the existing app's tokens. New additions for the roadmap surface:

**Milestone kinds:**
- launch: coral (use existing coral)
- event: medium blue (use existing department-b2b blue)
- decision: amber `#d4960a`
- team: sage (use existing approved-status sage)

**Suggested milestone:** `border: 2px dashed #d4960a; background: transparent`.

**Diamond geometry:** 12×12px, `transform: rotate(45deg)`, 2px white border, `box-shadow: 0 1px 3px rgba(0,0,0,0.15)`.

**Status keys** (from live `public/js/app.js`):
`backlog, not-started, in-progress, blocked, approved, delegated, completed`

**Department keys:**
`b2b, b2c, allmkt, personal, revops`

## Assets

No external assets. All visuals are CSS / SVG inline. The prototype uses Roboto (already in the live app).

## Files in this bundle

**Spec (read first):**
- `HANDOFF.md` — every product decision, full spec
- `FILE_DIFFS.md` — per-file engineering map

**Prototype (design reference):**
- `Roadmap.html` — host shell, view toggle, sidebar
- `app-shell.js` — kanban + list rendering with initiative pills
- `roadmap.jsx` — Roadmap timeline view (the centerpiece)
- `tasks-view.jsx` + `tasks-view.css` — list view
- `initiative-detail.jsx` + `initiative-detail.css` — initiative drawer with notes log
- `initiative-form.jsx` — create/edit initiative form
- `data.js` — sample data showing the target schema
- `follett-app.css`, `roadmap.css` — styles

**To run the prototype locally:** open `Roadmap.html` in a browser. It loads React + Babel from CDN.

## Open questions for the engineer

Surface these before starting (also in `FILE_DIFFS.md`):
1. Initiatives storage — new collection or extension of an existing one?
2. Notes pipeline ownership — separate service or hosted in the same backend?
3. AI-suggestion engine — local heuristic (date regex + decision verbs) or LLM call?
4. Touch fallback for right-click — long-press, or a `+` affordance on bar hover?
5. Permissions — who can edit milestones (initiative owner only, or anyone in the department)?
