# Per-File Diff Summary — Prototype → Live App

This is the engineer's map. For each prototype file, here's what changed vs. the live app and where the changes need to land in production code.

**Live app structure:**
- `public/index.html` — single-page shell
- `public/js/app.js` — monolithic app logic (constants, render functions, API)
- `public/css/style.css` — global styles

The prototype splits the new surfaces into focused files. The build can either keep them as separate modules or fold them back into `app.js` — engineer's call.

---

## `Roadmap.html` (prototype) → `public/index.html` (live)

**What it does in the prototype:** Hosts the sidebar + stats bar + main view region. Loads React + Babel + the JSX modules. Wires the sidebar nav, view toggle, and stats pills to render either the kanban (via `app-shell.js`), the tasks list (via `tasks-view.jsx`), or the roadmap (via `roadmap.jsx`).

**Key deltas vs. live:**
- Sidebar grows a **Department Spaces** section with live open-task counts per department.
- Sidebar adds a **Roadmap** entry that switches the main pane.
- Stats-bar gains a **Roadmap** segment in the view toggle (alongside List / Board).
- When Roadmap is active, the left stats-bar chips swap from `My Tasks / My Team / All` to `All / Mine / At Risk`.

**In production:** Add the Roadmap toggle to the existing view-mode switcher (`setTaskViewMode` in `app.js` ~L199). Add a new mode `'roadmap'` alongside `'list' | 'kanban' | 'calendar'`.

---

## `app-shell.js` (prototype) → portions of `public/js/app.js`

**What it does:** Mirrors the live kanban + list rendering, with two changes folded in.

**Deltas to merge into `renderKanban()` (~L227 of app.js) and the list renderer:**
1. **Initiative pill on every card.** Add `kb-init-pill` to the card template. For tasks where `initiativeId == null`, render `kb-init-pill--inbox` ("Inbox").
2. **Status taxonomy is already correct in live** (`STATUSES` at L9 — 7 statuses, no Awaiting Feedback). Confirm no UI strings reference "Awaiting Feedback".

**No other behavior changes** — column toggles, drag/drop, sort within column, Delegated filtering all match `KANBAN_COLUMNS` (L216) behavior.

---

## `roadmap.jsx` (prototype) → NEW module in production

**What it does:** Full Roadmap timeline view. This is net-new functionality.

**Production work:**
- New render function `renderRoadmap()` parallel to `renderKanban()` / `renderCalendar()`.
- Reads from `tasks` (existing) and a new `initiatives` collection (see Data shape below).
- Three zoom levels (`week / quarter / year`) with a today line.
- Initiative bars rendered by department lane, optional grouping.
- Milestones rendered as 12×12px rotated diamonds, colored by `kind` (launch/event/decision/team).
- Suggested milestones rendered as **dashed amber** diamonds with a ✦ badge (read from `initiative.suggestedMilestones`).

**Interactions to implement (in the order the prototype demonstrates):**
1. Click a diamond → editor popover (date / label / kind / Delete).
2. Drag a diamond laterally → date updates live; release commits. >3px movement suppresses the click handler.
3. Right-click an initiative bar → quick-add popover at cursor with date pre-filled from x-position.
4. Suggested-milestone popover variant: shows `source` + `context` quote, with **Accept ✓** / **Dismiss** actions. Accept moves the entry from `suggestedMilestones` into `milestones`.

---

## `tasks-view.jsx` (prototype) → list-render portion of `public/js/app.js`

**What it does:** Renders the task list grouped by status.

**Deltas:**
- Group order: `In Progress, Blocked, Not Started, Approved, Backlog, Completed`.
- Per-row status select exposes all 7 statuses.
- Same initiative-pill convention as kanban cards.

---

## `initiative-detail.jsx` + `initiative-detail.css` → NEW module in production

**What it does:** Right-side drawer for a single initiative. Shows brief, milestones, notes log, and tasks-on-this-initiative.

**Production work:**
- New drawer component, opened from clicking an initiative title in the Roadmap or kanban initiative pill.
- **Notes log** is the user-facing surface for the notes capture pipeline. Each note row shows: source badge (Granola / Slack / Manual), author, timestamp, body. Metadata is **non-optional** — every note carries all four.
- **+ Add note** button opens an inline composer that writes to the current initiative with `source: 'manual'` and auto-stamps author + timestamp.
- **Suggested tasks** queue (visual stub in prototype) is derived from notes — out of scope for the first build, but reserve UI space.

**One must-have:** The task detail modal action `◆ Make this a key date` calls into this initiative's milestones array. When promoted, the new milestone gets `fromTaskId: task.id` so it can later link back.

---

## `initiative-form.jsx` → NEW module in production

**What it does:** Create / edit an initiative. Used as the canonical entry point for milestones today.

**Deltas vs. nothing (it's all new):**
- Standard fields: name, department, owner, start, end, progress, health, color.
- **Milestones section** with `+ Add milestone` button. Each row: date / label / kind dropdown.
- This form remains the "power user" entry point for milestones. The five quick paths described in HANDOFF.md §5.1 do not replace it — they supplement it.

---

## `data.js` (prototype) → schema additions in production data layer

The data shape in the prototype is the target schema. Production deltas:

**Initiative collection (new):**
```js
{
  id, name, department, ownerId,
  startDate, endDate, progress, health,
  milestones: [{ date, label, kind, fromTaskId? }],
  suggestedMilestones: [{ date, label, kind, source, context }],
  notes: [{ id, body, author, createdAt, source, sourceMeta }]
}
```

**Task collection delta:**
- New field: `initiativeId: string | null` (null = Inbox task).
- Existing fields preserved: `status, priority, dueDate, assignedTo, blockedReason, etc.`

**Migration plan for existing tasks:** Default `initiativeId = null` for everything. Backfill via the bulk-tag UI later.

---

## `roadmap.css`, `tasks-view.css`, `initiative-detail.css`, `follett-app.css` → merge into `public/css/style.css`

**What's new vs. live styles:**
- `.kb-init-pill` and `.kb-init-pill--inbox` — initiative pill on cards.
- `.rm-bar`, `.rm-lane`, `.rm-diamond`, `.rm-diamond--suggested`, `.rm-today-line`, `.rm-popover` — full Roadmap surface.
- `.dept-space-row`, `.dept-space-count` — sidebar department entries.
- `.init-drawer`, `.init-note`, `.init-note-source`, `.init-note-meta` — initiative drawer + notes log.

No existing classes are renamed. All deltas are additive.

---

## `tweaks-panel.jsx`

Developer-only — not part of the production build. Delete from handoff package.

---

## Mapping summary (one-line per file)

| Prototype file | Production target | Type |
|---|---|---|
| `Roadmap.html` | `public/index.html` | Modify (sidebar + view toggle additions) |
| `app-shell.js` | `public/js/app.js` (kanban + list renderers) | Modify (initiative pill) |
| `roadmap.jsx` | new `renderRoadmap()` in `app.js` or new module | **NEW** |
| `tasks-view.jsx` | list-render portion of `app.js` | Modify (status grouping + statuses) |
| `initiative-detail.jsx` | new module | **NEW** |
| `initiative-form.jsx` | new module | **NEW** |
| `data.js` | data layer / API schemas | Schema additions |
| `*.css` | `public/css/style.css` | Additive merge |
| `tweaks-panel.jsx` | — | **DROP** (dev-only) |

---

## Things the engineer should ask before starting

1. **Initiatives storage** — new collection in the existing data store, or extension of an existing one?
2. **Notes pipeline ownership** — is the Slack bot a separate service, or hosted in the same backend? Affects whether `notes` is written via the same API as tasks.
3. **AI-suggestion engine** — local heuristic on note text (date regex + decision verbs) or LLM call? Prototype assumes "something produces `suggestedMilestones`" without specifying.
4. **Touch fallback for right-click** — confirm "leave for the build" means engineer chooses (long-press vs. hover affordance).
5. **Permissions** — who can edit milestones? Initiative owner only, or anyone with the initiative's department?
