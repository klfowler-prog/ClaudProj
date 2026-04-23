# Link Handling — DO NOT BREAK

This file exists because link handling has been broken multiple times by
well-intentioned "fixes" that end up causing silent failures on iOS Safari
or desktop browsers. Read this before touching any link-related code.

## The Rule

**Regular external URL links must use native browser behavior. Do NOT call
`window.open()` on them from a global click handler.**

## Why

### Native `<a target="_blank">` works everywhere
When a user taps `<a href="https://..." target="_blank" rel="noopener">`,
every browser (including iOS Safari) opens the link in a new tab. This is
treated as a direct user gesture and is never blocked.

### `window.open()` from JS fails on mobile
iOS Safari and some other mobile browsers block `window.open()` calls that
aren't unambiguous direct user gestures. If you add a global `click`
listener that calls `window.open(href)`, on iOS it often silently does
nothing — which is indistinguishable from "link is broken" to the user.

### contentEditable is the ONE exception
Inside a `contentEditable` element (only the note editor in this app),
the browser's default behavior is to place the cursor on a link click
instead of navigating. For THAT specific case only, we call `window.open()`
to force navigation. See `public/js/app.js` — the `editor-content` click
listener. Don't copy this pattern elsewhere.

## What the Global Click Handler Should Do

Located in `public/js/app.js` inside `init()`:

```js
document.addEventListener('click', (e) => {
  // File downloads — intercept because we fetch a signed URL first
  const fileDownload = e.target.closest('.file-download-link[data-gcs-path], .ai-link-file[data-gcs-path]');
  if (fileDownload) { e.preventDefault(); downloadFile(fileDownload.dataset.gcsPath); return; }

  // AI task/note links — intercept because we open in-app (not navigate)
  const aiLink = e.target.closest('.ai-link-task');
  if (aiLink) { e.preventDefault(); showTaskDetail(aiLink.dataset.taskId); return; }
  const noteLink = e.target.closest('.ai-link-note');
  if (noteLink) { e.preventDefault(); switchView('notes'); openNote(noteLink.dataset.noteId); return; }

  // Search results — NOT anchors, caught via data attributes
  // (these are buttons/divs, not <a> tags)
});
```

**That is the entire list.** Do NOT add:
- `a[href]` catch-all
- `a.external-link` interceptor
- `a.inline-link` interceptor
- Any `window.open(href)` for links with valid hrefs

## How the Different Link Types Render

| Link type | HTML | How it opens |
|---|---|---|
| Task attachment (file) | `<a class="file-download-link" data-gcs-path="...">` | Global handler → `downloadFile()` |
| Task attachment (URL) | `<a href="https://..." target="_blank" rel="noopener">` | Native browser |
| Inline URL in notes | `<a href="https://..." target="_blank" class="inline-link">` | Native browser |
| AI chat task ref | `<a class="ai-link-task" data-task-id="...">` | Global handler → `showTaskDetail()` |
| AI chat note ref | `<a class="ai-link-note" data-note-id="...">` | Global handler → `openNote()` |
| AI chat file ref | `<a class="ai-link-file" data-gcs-path="...">` | Global handler → `downloadFile()` |
| Note editor link | `<a href="https://...">` inside contentEditable | Editor-specific handler → `window.open()` |

## Testing Checklist

Before merging any link-related change, verify on **iOS Safari**:

1. Tap a URL in task notes → opens in new tab
2. Tap a link attachment on a task → opens in new tab
3. Tap a file attachment on a task → downloads/opens the file
4. Tap a task link in AI chat → opens task detail modal
5. Tap a note link in AI chat → opens the note
6. Tap a URL in a comment → opens in new tab
7. Tap a URL in the note editor (while editing) → opens in new tab

If any of these fail on iOS Safari, the global handler is likely
over-intercepting. Revert and try again.

## Symptoms of Regressions

- "Links don't work" complaints on mobile
- Links work on desktop but not iOS
- File downloads work but URLs don't (or vice versa)
- Links inside task detail fail but AI chat links work
