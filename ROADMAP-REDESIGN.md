# Roadmap Redesign — Team View Design Spec

Status: proposal · Author: design pass · Target: replace the current Roadmap landing experience for non-CMO users.

## 1. Why this exists

The current roadmap (preview revision `00271-qup`, branch `claude/roadmap-feature`) is a planner's view: a 4-lane × quarter Gantt swimlane. It works well for the CMO sequencing FY26, but it does not meet the goal stated for the team:

> "I want my team to have a simple place to go to see our roadmap, expand an initiative to see the associated tasks, engage with them, and show meaningful progress."

Concretely, the current build fails the team on four counts:

1. **Density over scannability.** Bars are tight, progress isn't visible at the bar level, and a teammate has to expand to see anything actionable.
2. **No "why" in the surface.** Goal and metric are buried in a modal. The reason a teammate should care is one click and one read away.
3. **No engagement loop.** No comments, no reactions, no watchers, no activity stream. Nothing has changed since last visit, so people don't come back.
4. **Edit-heavy modal.** Even simple status updates require opening a 7-section modal, which casual contributors won't do.

## 2. Audience model

One view cannot serve all three audiences. The redesign separates them.

| Audience | Frequency | Primary need | Default view |
|---|---|---|---|
| Team member (IC, manager) | Weekly | "What am I doing, why, and is anyone noticing?" | **Team view** (this spec) |
| Lane lead | Weekly | "How's my lane, who's blocked, what needs my push?" | **Team view**, filtered to their lane |
| CMO | Daily during planning, weekly otherwise | "How's the portfolio sequenced, where's the risk?" | **Planning view** (existing Gantt, gated behind toggle) |

The Team view is the new default. The Planning view stays alive but moves behind a view switcher.

## 3. Design principles

1. **Story before structure.** Lead with the "why this matters" for each initiative. Lanes and quarters are secondary.
2. **Show progress, don't hide it.** Progress ring + status pill + last update visible on the card without expansion.
3. **Engagement is a feedback loop.** Every action a teammate takes (close a task, post a status, react) should produce visible signal somewhere on the page.
4. **Inline over modal.** Casual edits (status update, task toggle, comment) happen in place. The full modal is for initial creation only.
5. **Mobile-equal, not mobile-after.** Most engagement will happen on phones during standups and 1:1s. The card layout works at 360px first.

## 4. Information architecture

```
/roadmap  (Team view, default)
  ├─ Hero stats strip
  ├─ My initiatives (pinned)
  ├─ What changed this week (activity)
  └─ All initiatives  ── grouped by quarter (Q2 active, Q3, Q4)
                       └─ filters: lane · status · supporting fn · theme

  Top-right view switcher: [ Team ] [ Planning ]

/roadmap?view=planning  (Planning view, existing Gantt)
  └─ unchanged from current build
```

URL is unchanged; view state is a query param so links survive view toggles.

## 5. Screen 1 — Team landing

### Anatomy

```
┌───────────────────────────────────────────────────────────────────┐
│  Roadmap · Q2 FY26                            [Team ▾] [Planning] │
├───────────────────────────────────────────────────────────────────┤
│  14 of 18 on track  ·  4 launched this quarter  ·  240 tasks done │
├───────────────────────────────────────────────────────────────────┤
│  YOUR INITIATIVES (3)                                             │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ 🟢 Brand refresh launch                  ●●●●●○○○  62%  ⋯  │  │
│  │ Why this matters                                            │  │
│  │   "Positions us for the B2C push in H2."                    │  │
│  │ Owner Sarah K · 4 tasks due to you this week                │  │
│  │ Updated 2d ago  · "Creative review locked for Mon"          │  │
│  │                                                             │  │
│  │ [ Open ]  [ Watch ]  ❤️ 3   💬 2                            │  │
│  └─────────────────────────────────────────────────────────────┘  │
│  ┌── 2 more cards ──┐                                             │
├───────────────────────────────────────────────────────────────────┤
│  WHAT CHANGED THIS WEEK                                           │
│  · Maya finished "Q2 brief" on Brand refresh   2h ago    ❤️ 3     │
│  · Sarah posted update on Growth funnel        4h ago    💬 2     │
│    "At risk — waiting on creative agency"                         │
│  · 3 tasks closed on Prospecting playbook      yesterday          │
│  · You closed "Draft persona doc"              yesterday          │
│  [ See full activity ]                                            │
├───────────────────────────────────────────────────────────────────┤
│  ALL INITIATIVES                                                  │
│  [ Q2 ●] [ Q3 ] [ Q4 ]    Lane ▾  Status ▾  More filters ▾        │
│                                                                   │
│  ┌── card ──┐  ┌── card ──┐  ┌── card ──┐                         │
│  ┌── card ──┐  ┌── card ──┐  ┌── card ──┐                         │
└───────────────────────────────────────────────────────────────────┘
```

### Sections (top to bottom)

1. **Hero stats strip.** Three numbers, no chart. Quarter-scoped. "X of Y on track" uses the status field; "launched" uses status `launched` or `done`; "tasks done" sums task completions inside initiatives this quarter.
2. **Your initiatives.** Cards for initiatives where the user is owner or contributor. Sorted by: tasks-due-to-you-this-week (desc), then last-updated (desc). Hidden if the user has none — replaced by an empty-state nudge: "You're not on any initiatives yet. Browse below."
3. **What changed this week.** Reverse-chron activity stream. Up to 8 items by default, "See full activity" expands. Item types: task closed, status posted, comment posted, initiative launched, milestone hit. Each item has an avatar, a verb-phrase title, a timestamp, and lightweight engagement (heart, reply count).
4. **All initiatives.** Grouped by quarter (current quarter open by default, others collapsed). Filter chrome is collapsed under "More filters" by default — this was a major source of visual noise. Cards laid out in a responsive 3-up grid (1-up on mobile).

### Empty states

- **No initiatives at all (early state).** Show the FY26 seed CTA only to the CMO; everyone else sees "Your team's roadmap is being set up."
- **Activity feed empty.** "Nothing yet this week. Be the first to post a status update." with a button that targets one of the user's initiatives.
- **No initiatives yours.** Quiet line, no card. The "All initiatives" section still loads.

## 6. Screen 2 — Initiative card (collapsed and expanded)

### Collapsed card anatomy

```
┌───────────────────────────────────────────────────────────────┐
│ 🟢 Brand refresh launch                ●●●●●○○○  62%      ⋯  │
│                                                               │
│ Why this matters                                              │
│   "Positions us for the B2C push in H2."                      │
│                                                               │
│ Owner  Sarah K (avatar)                                       │
│ Lane   Brand   ·   Q2 FY26                                    │
│ Tasks  18 done · 6 in flight · 4 due to you this week         │
│                                                               │
│ ──── status ────                                              │
│ 🟢 On track · updated 2d ago by Sarah                         │
│ "Creative review locked for Mon. Agency confirmed deliverable │
│  by 5/12."                                                    │
│                                                               │
│ [ Expand ▾ ]   [ Watch ]   ❤️ 3    💬 2                       │
└───────────────────────────────────────────────────────────────┘
```

### Expanded card

Expansion is **inline**, not a modal. The card height grows; the rest of the page reflows.

```
┌───────────────────────────────────────────────────────────────┐
│  …collapsed content above…                                    │
│                                                               │
│  TASKS (24)                              [+ Add task ]        │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │ ☑ Draft Q2 brief                  Maya · done 2h ago    │  │
│  │ ☑ Persona doc                     Kev · done yesterday  │  │
│  │ ☐ Creative review prep            You · due Mon  ●●○○   │  │
│  │ ☐ Agency kickoff deck             Sarah · due 5/15      │  │
│  │ … 4 more                                  [ Show all ]  │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                               │
│  COMMENTS                                                     │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │ Maya · 3d ago                                           │  │
│  │   "Should we loop in @kev on the kickoff?"              │  │
│  │   ❤️ 1   ↩ Reply                                        │  │
│  ├─────────────────────────────────────────────────────────┤  │
│  │ [ Write a comment… ]                                    │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                               │
│  [ Collapse ▴ ]                                               │
└───────────────────────────────────────────────────────────────┘
```

### Component breakdown

**Status pill.** Three colors, one optional micro-state.
- 🟢 On track  ·  🟡 Watch  ·  🔴 Blocked  ·  ⚪ No update (>14 days stale)
- Stale state shows an inline "Update needed" prompt to the owner only.
- Click the pill (owner only) → inline status update sheet:
  ```
  How's it going?  [🟢] [🟡] [🔴]
  Note (1 line)    [_____________________________________]
                                            [ Cancel ] [ Post ]
  ```

**Progress ring.** SVG circular ring + numeric percent. Drives off `tasksDone / tasksTotal` for the initiative. Animates on tick (300ms ease-out). If no tasks yet, ring shows dashed outline + "No tasks yet."

**"Why this matters" line.** Owner-editable, max 140 chars. If empty, shown only to owner with a "+ Add the why" placeholder. Required on initiative creation going forward.

**Last update line.** Pulls from the most recent status post. Format: `<status emoji> <status label> · updated <relative time> by <name>` followed by the note in quotes on the next line. Falls back to "Owner hasn't posted an update yet" with stale prompt.

**Action row.** Expand · Watch (toggle, persists) · Reactions · Comment count. All actions optimistic.

**Owner inline edit (owner-only).** A `⋯` menu in the card top-right exposes: Edit details, Archive, Generate tasks (Gemini, existing endpoint). Edit details opens an inline edit drawer in the card — not the full creation modal.

### States

| State | Trigger | Treatment |
|---|---|---|
| Default | Standard card | As shown above |
| Stale | No status update in 14 days | Status pill becomes ⚪, owner sees prompt |
| Blocked | Owner posts 🔴 | Card border accent (red 6px left bar), surfaces to top of "All initiatives" |
| Launched/Done | All tasks done OR status `launched` | Ring fills 100%, status pill replaced by "✓ Launched <date>", card moves to a "Launched this quarter" subgroup |
| At risk | Status 🟡 | Subtle yellow accent in status pill only, no border treatment |
| Owner viewing own card | User is `ownerId` | Shows ⋯ menu, inline edit affordances |
| Contributor viewing | User in `contributors` | Same as default + "You're contributing" chip |
| Watcher viewing | User in `watchers` | Watch button toggled on |

## 7. Screen 3 — Mobile

Mobile is not a separate design — it's the same components stacked single-column. Three rules govern adaptation:

1. **Single column at <640px.** Cards take full width minus 16px padding.
2. **Inline expansion becomes a bottom sheet.** Tapping "Expand" on mobile opens a sheet that takes 92vh, with a drag handle to dismiss. This avoids the page reflow problem on small screens where expanding pushes content off-screen.
3. **Sticky header collapses.** Hero stats become a single-line "14/18 on track" at the top once scrolled past.

```
Mobile: Team landing (≤640px)
┌─────────────────────────┐
│ Roadmap · Q2 FY26   ⋯  │
│ 14/18 on track          │
├─────────────────────────┤
│ YOUR INITIATIVES        │
│ ┌─────────────────────┐ │
│ │ 🟢 Brand refresh    │ │
│ │ ●●●●●○○○  62%       │ │
│ │ "Positions us for   │ │
│ │  the B2C push…"     │ │
│ │ Sarah K · 4 due     │ │
│ │ 2d ago · "Creative  │ │
│ │  review locked Mon" │ │
│ │ [ Open ] ❤️3  💬2   │ │
│ └─────────────────────┘ │
│ ┌── 2 more ──┐          │
├─────────────────────────┤
│ THIS WEEK               │
│ · Maya finished Q2 brief│
│ · Sarah → at risk       │
│ · 3 tasks closed        │
│ [ See more ]            │
├─────────────────────────┤
│ ALL  [ Q2 ] [ Q3 ] [Q4] │
│ ┌── card ──┐            │
│ ┌── card ──┐            │
└─────────────────────────┘
```

```
Mobile: Expanded card (bottom sheet)
┌─────────────────────────┐
│ ─── (drag handle)       │
│ 🟢 Brand refresh    ⋯  │
│ ●●●●●○○○ 62%            │
│ Sarah K · Brand · Q2    │
│                         │
│ "Positions us for the   │
│  B2C push in H2."       │
│                         │
│ 🟢 On track · 2d ago    │
│ "Creative review locked │
│  for Mon."              │
│                         │
│ TASKS (24)              │
│ ☑ Draft Q2 brief · Maya │
│ ☑ Persona doc · Kev     │
│ ☐ Creative review · You │
│ ☐ Kickoff deck · Sarah  │
│ [ Show all 24 ]         │
│                         │
│ [ + Add task ]          │
│                         │
│ COMMENTS                │
│ Maya · 3d               │
│  "Should we loop in…"   │
│ [ Write a comment… ]    │
└─────────────────────────┘
```

**Touch targets.** Minimum 44×44px for the checkbox, status pill (when interactive), and reaction. Watch toggle gets a 48×48 tap area.

## 8. Screen 4 — Planning view toggle

The Planning view is the **existing Gantt swimlane**, unchanged in content. Two adjustments:

1. **View switcher.** Top-right of the roadmap header: `[ Team ] [ Planning ]`. Default is Team. Choice persists in `localStorage` per user.
2. **Default for CMO.** First-time CMO load goes to Planning. First-time everyone-else load goes to Team. (Permission-driven default — overrideable by the toggle.)

The Planning view keeps:
- Lane × quarter swimlanes
- Track-packed initiative bars
- Bar expansion to Gantt task bars
- All current filters
- Sticky header z-index hierarchy (corner 11 / quarter 10 / lane 8)

The Planning view loses (moved into Team view only):
- "External roadmaps" bar — this is reference material, belongs at the top of Team view as a small links strip.
- The FY26 seed CTA — moves to a CMO-only section in Team view's settings.

## 9. Component anatomy reference

### Initiative card data model (no new schema fields beyond what `claude/roadmap-feature` already adds)

```
Initiative {
  id, title, description
  goal               // surfaced as "Why this matters" — see migration note below
  metric             // string, optional, surfaced as text on expanded card
  ownerId            // avatar + "Owner" line
  contributors[]     // avatar stack on expanded card
  watchers[]         // NEW — array of userIds
  lane               // badge
  fiscalYear, quarter // badge
  startDate, endDate // used by Planning view only on the new Team view
  roadmapStatus      // 'on_track' | 'watch' | 'blocked' | 'launched' | null
  statusUpdates[]    // NEW — array of { id, userId, status, note, postedAt }
  comments[]         // NEW — same shape as task comments
  reactions{}        // NEW — { emoji: [userId, ...] }
  whyThisMatters     // NEW — derived: alias of goal for clarity, or new short field if goal is too long
  supportingFunctions[]  // existing
  theme              // existing
}
```

**Migration note.** The current build uses `goal` (required) for the long-form goal. "Why this matters" should be a separate, shorter field (≤140 chars) optimized for skim. Two options:

- **A:** Add `whyThisMatters` field; backfill empty; prompt owners to add it.
- **B:** Repurpose `goal` if it's already short enough on existing initiatives; add a `goalDetail` field for the long form.

Recommend **A** — clearer separation, no risk to existing seed data.

### Activity feed item

```
ActivityItem {
  id, type        // 'task_done' | 'status_posted' | 'comment_posted' | 'launched' | 'milestone'
  initiativeId
  actorId
  occurredAt
  payload         // shape varies by type
}
```

Generated server-side. Indexed by `occurredAt` desc, scoped to "last 7 days" for the landing feed and "last 30 days" for the full activity page.

## 10. Interactions and micro-feedback

| Action | Feedback |
|---|---|
| Toggle task complete | Optimistic check, ring fills with 300ms ease-out, percentage label counts up. If server rejects, revert with toast. |
| Post status update | Pill recolors immediately, "updated just now" replaces stale "updated Nd ago". Card moves to top of "Your initiatives" sort. |
| Add comment | Comment appears immediately under the input with a faint background, fades to default after 1s. |
| Add reaction | Heart fills, count increments, +1 micro-bounce (transform: scale 1.0 → 1.15 → 1.0, 200ms). |
| Watch initiative | Button state flips, toast: "You'll get Slack pings when status changes or a key task closes." Slack channel: existing bot DM. |
| Expand card | Card height animates 250ms ease-out. Tasks lazy-load. Mobile: bottom sheet slides up. |
| Launch (status set to launched) | Confetti animation (3s), card moves to "Launched this quarter" subgroup with celebratory copy. |

## 11. Copy and tone

- **Hero strip.** Numbers first, labels second. "14 of 18 on track" not "Initiatives on track: 14/18."
- **Empty states.** Short, action-oriented. "You're not on any initiatives yet." not "There are no initiatives associated with your account."
- **Status note placeholder.** "What changed since last week?" — prompts a real update, not a status code.
- **Activity verbs.** Past tense, named subject. "Maya finished X" not "X was completed."
- **Stale prompt.** To owner only: "Status is going stale — post a quick update." Not punitive.
- **Watch tooltip.** "Get a Slack ping when the status changes or a key task closes."

## 12. Build order

P0 → P3, smallest leverage-positive ship first.

### P0 — "Team view shell" (1–2 days)
- View switcher in header; Team view default for non-CMO.
- Card-based layout for "All initiatives," grouped by quarter.
- Card surface: status pill, progress ring, "Why this matters" (using current `goal` until field migration), owner, last update line.
- Hero stats strip.
- Filters collapsed under "More filters" by default.

**Ship gate:** A teammate can land on /roadmap and see all initiatives as cards with progress and status visible without expanding.

### P1 — "Engagement primitives" (2–3 days)
- "Your initiatives" pinned section with personalized sort.
- Inline expansion (desktop) / bottom sheet (mobile) showing the task list.
- Optimistic task toggle with progress ring animation.
- "What changed this week" activity feed (server endpoint + client list).
- Add `whyThisMatters` field; owner prompt for missing values.

**Ship gate:** Closing a task on the roadmap visibly fills the ring and shows up in the activity feed within seconds.

### P2 — "Status as story" (2 days)
- Inline status update sheet on the card.
- Stale-state detection + owner prompt.
- Watchers (toggle + Slack ping via existing bot infra).
- Status update appears in activity feed.

**Ship gate:** A lane lead can post a status update from the card without opening a modal, and watchers get a Slack ping.

### P3 — "Social texture" (2 days)
- Reactions on initiatives and activity items.
- Comments on initiatives (reuse task comment infra).
- @mentions trigger Slack notifications.
- Mobile polish pass: sheet animations, touch targets, sticky-header collapse.

**Ship gate:** Two teammates can have a comment thread on an initiative card with reactions and Slack-delivered notifications.

### Out of scope for this design
- Metric-source integration (manual-entry only at first; auto-pull is a follow-on).
- Cross-initiative dependencies (visualized in Planning view if needed).
- Per-lane dashboards for lane leads (could come from filtering the Team view; no new view needed yet).

## 13. Accessibility

- Status conveyed by both color and icon/label — never color alone.
- Progress ring exposes `aria-valuenow`/`aria-valuemax`; numeric percent always visible next to it.
- All inline expansions are `<button aria-expanded>` with proper focus management on open.
- Bottom sheet on mobile traps focus and dismisses on Esc, swipe-down, or backdrop tap.
- Card headlines are `<h3>` so screen reader users can navigate the page by initiative.

## 14. Open questions

1. **Metric source.** Is the per-initiative `metric` something owners type weekly ("MQLs: 240/500"), or are some metrics pulled from a system (Google Analytics, HubSpot)? Decision changes whether the metric line gets an "edit" button or a "synced X ago" timestamp.
2. **Lane lead view.** Do leads need a dedicated "my lane" page, or is filtering Team view by lane sufficient? Recommend: filter is enough for V1; revisit if leads ask for it.
3. **Team size and ratio.** How many people are on the team versus in lead roles? Ratio sets whether the Team view should optimize for scanning (large team) or posting (small team, more owners).
4. **Slack channel for watcher pings.** DM the watcher, post in a channel, or both? Existing bot DMs the user — likely fine for V1.
5. **Activity feed scope.** Last 7 days on landing, 30 days on full view — is that the right window? Could be configurable per user.

## 15. Glossary

- **Initiative.** A workspace with `kind:'initiative'`. Has owner, contributors, lane, quarter, status, tasks.
- **Lane.** One of: Prospecting & BD, Growth Marketing, Brand, Consumer Marketing.
- **Status.** Owner-posted assessment: on track / watch / blocked / launched.
- **Stale.** Status not updated in 14+ days.
- **Watcher.** Anyone subscribed to status changes for an initiative; receives Slack pings.
- **Activity item.** A timestamped event surfaced in the "What changed" feed.
- **Team view.** New default landing for the roadmap (this spec).
- **Planning view.** The existing Gantt swimlane, gated behind a view toggle.
