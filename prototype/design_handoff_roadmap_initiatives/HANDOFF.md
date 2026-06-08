# Roadmap & Initiatives — Design Handoff

This document is the source of truth for what the prototype changes vs. the current shipped Marketing app. Read it before touching code. If a behavior here disagrees with the prototype, **the prototype is the spec** — open it side-by-side while building.

**Files in this prototype**
- `Roadmap.html` — host shell (sidebar, stats bar, view toggle)
- `app-shell.js` — kanban + list rendering (mirrors `public/js/app.js` behavior)
- `roadmap.jsx` — Roadmap timeline view (React)
- `tasks-view.jsx` — Tasks list view (React)
- `initiative-detail.jsx` / `.css` — Initiative drawer
- `initiative-form.jsx` — Initiative create/edit form
- `data.js` — sample data (initiatives, tasks, people, inbox)
- `roadmap.css`, `follett-app.css`, `tasks-view.css` — styles

---

## 1. Status taxonomy — aligned to live app

The prototype now uses the **exact** status set from `public/js/app.js`. Do **not** introduce "Awaiting Feedback" — it has been removed everywhere.

**Canonical statuses (in display/sort order):**
`Backlog · Not Started · In Progress · Blocked · Approved · Delegated · Completed`

**Kanban columns** (`KANBAN_COLUMNS` in `public/js/app.js`):
- `Backlog` — toggleable, hidden by default
- `Not Started`
- `In Progress`
- `Blocked` — coral; supports a `blockedReason` string captured via prompt on transition
- `Approved` — sage
- `Completed` — toggleable, shown by default

**Delegated** is a status but **not** a default column — it's filtered out of the board unless the "Delegated" stats pill is active. Match this rule in any new view that surfaces tasks.

**Stats-bar pills** (live order): `Overdue · Delegated · Done this wk`

CSS class convention: `status-{key}` where key comes from `STATUS_KEYS`:
`backlog, not-started, in-progress, blocked, approved, delegated, completed`.

Do not invent `status-awaiting`. It has been removed.

---

## 2. Sidebar — Department spaces with live counts

Left sidebar contains:
- **Search** (top)
- **My Tasks** with live count
- **Roadmap** entry that switches the main pane to the timeline view
- **Department Spaces** — a section with one entry per department, each showing a live count of *open* (non-Completed) tasks in that department. Clicking a department filters all views to that department.

Departments + keys (used as both filter values and CSS class suffixes):
| Label | key | dot color var |
|---|---|---|
| All Marketing | `allmkt` | brand neutral |
| B2B Marketing | `b2b` | medium blue |
| B2C Marketing | `b2c` | coral |
| Personal | `personal` | dark blue |
| Rev Ops | `revops` | sage |

The count next to each department reflects the same filter the live app uses.

---

## 3. View toggle — List / Board / Roadmap

Three modes share the stats bar and main pane:

- **List** — task list, grouped by status in order: `In Progress, Blocked, Not Started, Approved, Backlog, Completed`. Each row has a status select dropdown that exposes all 7 statuses.
- **Board** — kanban with column toggles for Backlog and Completed (the rest are always shown).
- **Roadmap** — timeline (covered in section 5+).

Switching to **Roadmap** swaps the stats-bar-left chips: `All / Mine / At Risk` instead of `My Tasks / My Team / All`.

---

## 4. Kanban cards

Each card shows:
- Title
- **Initiative pill** — badge with the parent initiative name. Tasks not on any initiative show an "Inbox" pill instead. *This is new.* It is the single most-requested signal: "which initiative does this roll up to?"
- Owner initials, due date (red if overdue), priority dot
- Top border color = column status; left border color = priority

Sort within column: priority (High → Low), then due date ascending.

---

## 5. Roadmap — initiative bars and milestones

The Roadmap is the centerpiece. Three zoom levels: `week / quarter / year`.

**Initiative bar** (`InitiativeBar` in `roadmap.jsx`):
- Width = start → end date
- Fill = `progress` (0–1)
- Color = department; border tone = health (`on-track / at-risk / off-track`)
- Click bar → expand inline task rail (chips for each task, positioned at due date)
- Click bar **title** in the left lane meta → opens the Initiative drawer

**Milestones / "diamonds" / key dates** are the externally-visible moments on each initiative (a launch, a press date, a board decision). Each milestone has:
```js
{ date: 'YYYY-MM-DD', label: 'string', kind: 'launch'|'event'|'decision'|'team' }
```
Color by kind: launch = coral, event = blue, decision = amber, team = sage.

### 5.1 Adding a milestone — five entry points

This is the section that **must not be lost in build**. Today, the live app only allows adding milestones via the initiative form. The prototype adds four more entry points because users said the form-only flow is too high-friction.

**(1) Quick-add via right-click on the timeline**
- Right-click anywhere on an initiative bar
- A popover opens at the cursor with the date pre-filled (computed from click x → date)
- User types label, picks kind, hits Save
- Implementation note: bind `onContextMenu` on the bar wrapper, compute `xToDateStr(left + xInBar, scale)`, position popover at `clientX, clientY`

**(2) Hover-edit popover on existing milestones**
- Click any existing diamond → same popover, pre-filled with the milestone's data
- Includes a Delete button
- Replaces having to leave the roadmap → open the form → scroll to the milestones array

**(3) Drag-to-reschedule**
- Mousedown on a diamond → drag laterally → date updates live as you drag
- Release commits
- A small movement threshold (>3px) suppresses the click handler so the editor doesn't open after a drag

**(4) Promote a task to a milestone**
- In the task detail modal, the action row has a button: **◆ Make this a key date**
- Clicking it pushes a new milestone onto the parent initiative with `{ date: task.due, label: task.title, kind: 'decision', fromTaskId: task.id }` and closes the modal
- The `fromTaskId` link is for future "show task behind this milestone" affordances; preserve it in the schema even though the UI doesn't use it yet

**(5) AI-suggested milestones from notes**
- An initiative may have a `suggestedMilestones: []` array (separate from `milestones`)
- Each suggestion has the same shape as a milestone, plus `source` (e.g. "Granola · 4/22 ESP sync") and `context` (verbatim quote from the note)
- Suggestions render as **dashed amber diamonds** with a small ✦ badge — visually distinct from real milestones
- Clicking a suggestion opens the popover in `mode:'suggest'`, which:
  - Shows the source + context quote at the top
  - Has **Accept ✓** (moves it from `suggestedMilestones` into `milestones`) and **Dismiss** (deletes from `suggestedMilestones`) buttons
- Suggestions come from the same notes-capture pipeline (Granola sync + Slack Marketing Bot + manual paste). They are **suggestions only** — never auto-applied.

### 5.2 Roadmap interactions to preserve

- Today line + "TODAY" pin on the time header
- Department group headers when sortBy=department, collapsible
- "At Risk" filter chip in the stats bar that filters initiatives where `health === 'at-risk'`
- Tweaks panel (developer-facing): style/density/show milestones/sort by/show completed

---

## 6. Notes capture pipeline (context for AI suggestions)

This is the upstream feature that feeds `suggestedMilestones`. Build order: ship the capture first, then the suggestion engine.

**Three sources, one log per initiative:**
1. **Granola sync** — auto-routes if a Granola meeting is tagged with an initiative name
2. **Marketing Bot in Slack** — `/marketing-bot note <initiative>` or thread reply with `@Marketing Bot tag <initiative>`. Fuzzy-matches initiative names. Bot posts back a confirmation card.
3. **Paste/Type in-app** — universal "+ Add note" on the initiative page

**Always-captured metadata** (every note, every source):
- Date + timestamp (auto)
- Author (auto-stamped)
- Source badge: `Granola | Slack | Manual`
- Initiative tag (the routing key)

The metadata bar shows on every note in the log, no exceptions.

**AI-suggested key dates** are derived by scanning the notes log for date + decision/launch phrases ("decide vendor by 6/30", "press release 5/2", "save-the-date 30 days out"). Surface as suggestions on the initiative; never auto-apply.

---

## 7. Task detail modal — additions

In addition to the existing fields:
- **Status pills** show all 7 canonical statuses
- **Action row** has these quick actions in order: `◆ Make this a key date`, `+ Add subtask`, `@ Mention`, `⏱ Snooze`
- **AI summary** block (collapsible) — pulls from the parent initiative's notes log when wired to live data; in the prototype it's stub text

---

## 8. Data shape additions

Schema deltas vs. current production:

```js
initiative: {
  // ...existing fields...
  milestones: [{ date, label, kind, fromTaskId? }],
  suggestedMilestones: [{ date, label, kind, source, context }],   // NEW
  notes: [{                                                          // NEW (from notes pipeline)
    id, body, author, createdAt,
    source: 'granola'|'slack'|'manual',
    sourceMeta: { /* meeting title, slack permalink, etc */ }
  }],
}

task: {
  // ...existing fields...
  initiativeId: string|null,        // null = Inbox task
  blockedReason: string,            // existing — preserve
}
```

`Delegated` and `Blocked` are **distinct** statuses, not synonyms. Don't collapse them.

---

## 9. Visual / interaction details that get lost in build

These are the small things that always disappear in handoff. Please preserve.

- **Initiative pills on cards** are rendered with `kb-init-pill` class. Inbox tasks use `kb-init-pill--inbox` modifier (different color).
- **Diamonds** are 12×12px squares rotated 45deg with a 2px white border and a soft shadow. The dashed-amber suggested variant uses `border: 2px dashed #d4960a` and a transparent fill.
- **Drag cursor** on milestones is `grab` / `grabbing`.
- **Today line** is a 1px dashed vertical line through the canvas at today's x.
- **At Risk** initiative bars get a coral 1px outline (not a fill).
- **Health "off-track"** is a separate state from "at-risk" — preserve both even if data only currently uses the first two.
- **Right-click hint**: the title attribute on the initiative bar reads "Right-click anywhere on the bar to add a key date" — this is the only discovery surface for that interaction. Keep it (or replace with a better one).

---

## 10. Build sequence (recommended)

1. **Status taxonomy alignment** — confirm all views use the 7-status set. No "Awaiting Feedback" anywhere in code or UI strings.
2. **Initiative pill on every task card** (kanban + list).
3. **Roadmap view**: bars + milestones (read-only render), zoom levels, today line.
4. **Milestone interactions in this order**: click-to-edit → drag → right-click-add → task-promote → AI suggestions.
5. **Notes capture pipeline** (Granola sync, Slack bot, manual). Suggestions engine plugs in last.

For mobile/touch: right-click → long-press fallback or a small `+` affordance on bar hover. Decide before build.

---

## 11. Anti-patterns to avoid

- **Don't** add an "Awaiting Feedback" status. It does not exist in the live app.
- **Don't** auto-apply AI-suggested milestones. Always require explicit Accept.
- **Don't** lose the source attribution on notes (Granola / Slack / Manual). Every note must carry its source badge.
- **Don't** merge Blocked and Delegated into a single column. They have different semantics: Blocked = stuck (with reason), Delegated = handed off (filtered out by default).
- **Don't** drop the initiative pill on task cards. It is the most-requested signal.
- **Don't** require users to leave the roadmap to add a key date. All five entry points in §5.1 must work without a page navigation.
