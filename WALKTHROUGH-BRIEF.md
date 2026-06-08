# Marketing App — Team Walkthrough Brief

This brief covers everything that shipped to production in the recent feature push. Use it to script a 15-20 minute walkthrough for the leadership + marketing team.

The production app is at: `https://cmo-task-manager-tq7xvpdbyq-uc.a.run.app`

---

## 1. The new mental model (start here)

The app now operates at **two altitudes**:

| Layer | What it is | Where it lives |
|---|---|---|
| **Initiatives** | Strategic bets. Have a thesis, dates, owner, health, progress, milestones. Time-bound. | Roadmap view |
| **Workspaces** | Operational containers for ongoing work that's topical (Slack, Social & PR, etc.). | Workspaces section in sidebar |
| **Tasks** | The unit of work. Can roll up to an initiative, live in a workspace, or be unfiled ("Inbox"). | Everywhere |

The big shift: most workspaces are really initiatives. The team now has a one-click **"Promote to initiative"** flow to move them onto the Roadmap.

---

## 2. What's new — by feature area

### 2.1 Roadmap (new top-level view)

Sidebar entry: **Roadmap** (between "My Stuff" and "Departments").

- Timeline view, grouped by department in swim lanes
- Three zoom levels: Week / Quarter / Year (toggle top-left)
- Today line drawn vertically through the canvas
- Each initiative renders as a bar, sized by start → end, fill = progress %, border tone = health (on-track / at-risk / off-track)
- Diamond badges = milestones (launch / event / decision / team, color coded)
- Click an initiative bar OR its title → opens the **Initiative Detail panel**
- Each lane row has one right-side button: `+ Add task` if no tasks yet, or `N tasks ▸` to expand the task rail inline
- Filters in the toolbar: department, health, "Mine"

### 2.2 Initiative Detail panel — Tasks tab

Click any initiative bar → modal opens with two tabs.

**Tasks tab:**
- Shows all tasks that roll up to this initiative
- `+ Add task` button (top right) — opens the standard task form pre-stamped with this initiative
- **✨ Brain dump composer** at the bottom — paste a stream-of-consciousness list, AI splits it into N tasks
  - Example input: *"Schedule demos with Klaviyo, Iterable, Bloomreach by 5/30. Build out RFP doc by 5/30. Define scoring criteria by 7/1. Loop in Brian for legal review next week."*
  - Click **Parse with AI** (or ⌘⏎)
  - Preview shows each task with editable title, due date, priority, owner
  - Drop any rows with the `×` button
  - Click **Create tasks** → all created at once and stamped with this initiative
- Tasks with no due date show an amber **"+ Add due date"** pill — click to fix

### 2.3 Initiative Detail panel — Notes & Files tab

**Notebook lives inside the modal** (no jumping to another view).

- Click **+ New note** → editor opens in-place with title, content, attachments
- Attach a file (📎) — uploads to Cloud Storage; files persist as clickable downloads
- Add a link (🔗) — paste any URL with optional label
- Auto-saves 600ms after typing
- `← Back to notebook` returns to the list view
- Source badge on every note (`MANUAL`, `GRANOLA`, `SLACK`) so the team can trace where notes came from
- These notes also appear in the main Notes hub, scoped to this initiative — they're real notes, not a parallel system

### 2.4 Workspace ↔ Initiative bridge

When you click a workspace in the sidebar:
- Now lands you on the workspace task board immediately (no more click-then-pick)
- Header has a **Tasks | Notes (N)** toggle so notes are visible alongside tasks

**Promoting a workspace to an initiative:**
1. Open any workspace
2. Click the prominent **"↗ Promote to initiative"** button in the header (leaders only)
3. The initiative form opens pre-filled from the workspace (name, inferred department from tasks, inferred dates from earliest/latest task dates, members → collaborators, completed-tasks % → progress)
4. Edit anything; required fields are thesis + dept + dates
5. Save → all tasks + notes in the workspace get stamped with `initiativeId` in one batch. The workspace stays as the operational home; the initiative is the strategic lens on the Roadmap.

**Bulk audit screen** (Roadmap toolbar → `↗ Audit workspaces (N)`):
- Lists every active workspace as a row
- Each unlinked row has actions: **↗ Promote** / **Keep as workspace** / **Archive**
- Linked rows are greyed with an "Open initiative →" action
- Use this once to clear the backlog of workspaces that should be initiatives

### 2.5 Auto-progress + auto-health (no manual upkeep)

Every time an initiative is read:
- **Progress** = completed tasks / total tasks (persisted)
- **Health** flips automatically based on overdue task count:
  - 0 overdue → On Track
  - 1-2 overdue → At Risk
  - 3+ overdue → Off Track
- **Manual override is sticky for 7 days** — if you set health by hand, auto-rules respect that for a week before resuming

**Notifications fire** for owners + collaborators when:
- Health auto-flips
- Health manually changes
- Owner changes
- End date shifts more than 7 days

(In-app via the bell, plus Slack DM if the user has their Slack mapped.)

### 2.6 Tasks with no due date are unmissable

Tasks land everywhere — and missing dates are surfaced clearly so they don't slip:
- **Roadmap timeline**: striped amber "⚠ task title · needs dates" pill spans the lane
- **Roadmap left rail**: amber "⚠ Needs dates" chip on the row
- **Initiative detail**: amber **"+ Add due date"** button instead of an empty spot
- **Kanban card**: small amber "+ date" pill in the card footer
- **Brain dump preview**: empty date inputs get an amber border

### 2.7 Calendar shows milestones

The calendar view now renders initiative milestones as colored diamond badges in each day cell, alongside tasks. Click a diamond → opens that initiative's detail panel.

### 2.8 AI improvements

**AI Quick Add** (lightning bolt button, top of app):
- Now knows about all 5 departments including **Rev Ops**
- Tries to match the task to an existing initiative based on name or topic — pre-fills the Initiative dropdown
- "+ New initiative…" option at the bottom of the dropdown lets leaders spin one up mid-flow without leaving the task form

**AI Assistant chat (in-app)**:
- Has full initiative context (name, dept, dates, owner, health, progress, milestone & task counts, thesis)
- Can take initiative actions: `create_initiative` (leader-only), `update_initiative`, plus the existing task/note actions
- Example prompts:
  - *"What initiatives are in flight in Rev Ops?"*
  - *"Mark the ESP RFP at risk"*
  - *"Add a task to vet Klaviyo for the ESP RFP, due June 1"*
  - *"Spin up a Fall Campaign initiative, B2C, Aug 1 to Nov 30"*

**Marketing Bot in Slack**:
- Same initiative awareness in DMs
- Can create/update initiatives via Slack DM
- Leader-gated: non-leaders trying to create an initiative get: *"Only leaders can create initiatives. Reach out to your manager"*

**Global Search** (top bar):
- Searches initiatives alongside tasks and notes
- Initiatives appear at the top of results with their dept, owner, dates, health
- Click → jumps to the Roadmap with that initiative's detail panel open
- Filter dropdown has an **Initiatives Only** option

### 2.9 Login briefing (the daily card)

The morning narrative card now:
- Shows referenced tasks as **clickable links** (blue underlined)
- Validates AI output server-side — if the model hallucinates a task name that doesn't exist, the narrative falls back to a deterministic version like "You have 3 overdue tasks and 1 due today"

### 2.10 Other polish

- Kanban columns now sort by **due date first** (then priority)
- Task titles wrap to multiple lines on the Roadmap lane row and initiative detail rows (no more truncation)
- Workspace cards correctly hide the "Inbox" pill (it only shows on truly unfiled top-level tasks now)

---

## 3. Suggested walkthrough script (15-20 min)

### Act 1 — The shift (3 min)
- Open the app, click **Roadmap** in the sidebar
- "Until last week, all our work lived as flat tasks or in workspaces. Now we have a strategic layer above that — initiatives — and the Roadmap shows them all."
- Briefly walk the timeline: swim lanes, bars, milestones, today line, zoom toggle

### Act 2 — Drilling into an initiative (4 min)
- Click an initiative bar (use a real one — e.g. the **CRM Systems** initiative if promoted, or **Launch Prospecting ABM**)
- Show the detail panel: thesis, dept, dates, owner, progress %, health
- **Tasks tab** — explain the rollup
- **Notes & Files tab** — open a note inline, show file attachments
- Highlight: "Everything you need to think about this bet lives in one panel"

### Act 3 — Brain dump (3 min)
- Same initiative → Tasks tab → scroll to the ✨ Brain dump box
- Paste 4-5 tasks in natural language — include dates, names
- Show the AI preview, edit one inline, commit
- Highlight: "This is how we get a planning session out of someone's head and into the app in 30 seconds"

### Act 4 — Workspaces becoming initiatives (3 min)
- Open one of Katie's workspaces that's really an initiative (e.g. CRM Systems)
- Click **↗ Promote to initiative**
- Walk through the form pre-fill (department inferred, dates inferred, members → collaborators)
- Save → show the toast, then click into the new initiative on the Roadmap
- All the existing tasks now visible there too. **No data lost.**
- Mention the bulk audit screen for clearing the workspace backlog

### Act 5 — How AI helps (3 min)
- Open the AI Assistant
- Ask: *"What initiatives are running in Rev Ops?"*
- Ask: *"Mark the CRM Systems initiative at 60%"* — watch it execute
- In Slack DM Marketing Bot: *"What's on my plate for the ESP RFP this week?"* — show the answer
- Highlight: AI now sees the strategic layer, not just tasks

### Act 6 — Daily flow (2 min)
- Show the login briefing card with clickable task links
- Calendar view showing milestone diamonds
- "Tasks without dates" surfacing — open an initiative with a no-date task and point to the amber pill on the timeline
- Notifications bell — point out initiative health/owner/date-shift alerts

---

## 4. Permissions cheat sheet

| Action | Required role |
|---|---|
| Create / edit any initiative | Leader (CMO or lead) |
| Edit an initiative you own | Owner |
| Add notes/files to an initiative | Leader, owner, or listed collaborator |
| Promote a workspace to initiative | Leader |
| Create a task | Anyone except viewers |
| AI Slack bot: create_initiative | Leader (else: "Reach out to your manager") |

---

## 5. What's intentionally NOT shipped yet

Set expectations during the walkthrough so the team knows what's coming:

- **Milestone editing on the roadmap** (click-to-edit, drag-to-reschedule, right-click-add, promote task to milestone) — coming next as a focused build
- **Weekly Monday 5pm Slack leadership-meeting agenda** — coming after milestones
- **AI-suggested milestones from notes** — last in the queue

---

## 6. URL + technical notes for the walkthrough

- Production: `https://cmo-task-manager-tq7xvpdbyq-uc.a.run.app`
- Sign-in is Google OAuth (Follett accounts)
- The Slack bot is "Marketing Bot" — DM it directly; the bot is on the same workspace
- If anyone gets stuck or sees something broken, they can use the **Ideas & Feedback** sidebar entry to log it

---

## 7. Open questions to flag in the meeting

- Which workspaces should we promote vs keep — schedule the bulk audit in a leadership session
- Who else (besides CMO) should get the weekly Monday agenda DM once we ship it
- Anyone seeing tasks they can't account for — surface them so we can investigate
