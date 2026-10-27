# Changelog

## 0.1.0 - 2026-10-27

### Added

- Local per-deck credential store under `~/.htmlppt/decks` (override with
  `HTMLPPT_HOME`) that records the host port and capability token, so
  `htmlppt open` reuses the same URL across restarts until `htmlppt stop`.
- Liveness-verified host reuse: `open` probes both health and the editor shell,
  replaces a stale-build host, and the host serves an actionable 401 page that
  names the deck and the `htmlppt open` recovery command instead of a plain
  unauthorized body.
- Drill-in container editing: enter an unlocked, visible container from the
  canvas or the inspector, with a breadcrumb and an object list scoped to the
  entered context; Escape leaves the context.
- Nested geometry: drag, resize, rotate, and nudge a single nested selection,
  with a one-time notice and Undo when a flow element is pinned to absolute
  positioning.
- Generic appearance panel: background, border, radius, and opacity apply to
  any single non-image element at any depth, while images keep crop/alt and SVG
  keeps its paint-target handling.
- Edit feedback and accessibility: double-click hints explain why a target
  cannot be edited, persistent polite live regions announce hints, pin notices,
  and context changes, and the breadcrumb and object rows are keyboard-operable
  with ARIA state.

### Fixed

- Locked or hidden containers exposed an enter chevron and could be entered
  with Enter; they now show no enter affordance and the shared predicate
  refuses them.
- The appearance panel stayed enabled for nested elements inside a locked,
  hidden, or grouped wrapper; every appearance field now follows the same lock
  rules as geometry.
- Image upload bypassed the top-level lock and could rewrite a locked subtree;
  uploads now check the owning wrapper.
- MCP `open_editor` reported success when the spawned host answered
  `/api/health` but its editor shell was broken; it now requires a healthy
  editor probe and surfaces `editor-failed`.
- The credential store could drift from the live host: a stale token or port
  was not adopted, and a deck switch left the old deck's credential behind;
  `open` now rewrites the live identity and a switch moves the credential.
- A border could not be created from an empty style because the colour and
  width fields sent independent patches that erased each other; they now commit
  a consistent pair, with defaults for the missing half.
- An SVG colour edit wrote the first paint target's width onto every target;
  colour-only SVG edits now leave per-target widths alone.
- Text-edit detection used `instanceof HTMLElement`, which is false for
  elements from the preview iframe realm and disabled inline editing; detection
  now compares tag names.
- The edit hint mounted its `role="status"` region together with its text,
  which some screen readers miss; an always-mounted polite region now carries
  the copy.
- `stop` advised starting a new editor when the registered host could not be
  verified under another deck spelling; it now says the editor could not be
  verified and leaves it running.
- A replaced host could hold its recorded port for a moment (Windows
  `TIME_WAIT`), so `open` fell back to an ephemeral port and invalidated
  bookmarks; it now retries the recorded port before warning and falling back.
- `stop --all` did not rotate credentials for dead registry entries pruned
  before the stop loop; those credentials are now rotated as well.

### Changed

- Browser sessions use a 30-day HttpOnly `SameSite=Strict` cookie renewed on
  successful page loads; the tokenized URL is exchanged once, and CLI and MCP
  traffic keeps bearer auth.
- Documentation updated across the root README, SECURITY, and architecture
  docs, the published package README and SECURITY, and the skill references for
  the credential store, liveness checks, and drill-in editing.

### Notes

- npm publish, tags, GitHub releases, and other shipping actions require
  explicit authorization.
- Deck credentials live at `~/.htmlppt/decks`; `htmlppt stop` rotates the token.
