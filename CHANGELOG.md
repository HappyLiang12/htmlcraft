# Changelog

## 0.1.1 - 2026-11-10

### Fixed

- Package metadata now points at the renamed repository
  (`github.com/HappyLiang12/htmlcraft`); `0.1.0` still carried the old
  `htmlppt` URLs.
- The CLI `--version`, the host health payload, and the MCP `serverInfo`
  report `0.1.1` instead of the stale `0.1.0`.

### Changed

- Releases publish through npm trusted publishing (GitHub OIDC) instead of a
  long-lived `NPM_TOKEN`, and the published tarball carries npm provenance
  attestations.
- The CLI and MCP server print a once-a-day update notice (one message per
  version) and never upgrade themselves. The packaged skill asks the person to
  choose npx, a global install, or no install, and asks before any upgrade.

No functional changes.

## 0.1.0 - 2026-11-07

### Added

- Component-first selection: a slide-level click selects the innermost visible
  component under the pointer, the hover outline previews exactly that target,
  and click and drag agree; double-click, Enter, the OBJECTS chevron, or the
  Inspector Enter action drills in without a hotkey.
- SVG-internal dragging: a selected shape or nested `<svg>` moves through a
  post-multiplied `transform="translate(...)"` in local user units, while
  CSS-owned transforms stay selectable but drag-inert.
- Nested structural operations: delete, duplicate, and copy/paste inside the
  parent at any depth, with fresh `data-ppt-el` ids on copies; group and ungroup
  remain top-level operations.
- Table cells remain selectable for the table toolbar and native text
  selection, but cannot be geometry-dragged; the drag hint explains the rule.
- Local per-deck credential store under `~/.htmlcraft/decks` (override with
  `HTMLCRAFT_HOME`) that records the host port and capability token, so
  `htmlcraft open` reuses the same URL across restarts until `htmlcraft stop`.
- Liveness-verified host reuse: `open` probes both health and the editor shell,
  replaces a stale-build host, and the host serves an actionable 401 page that
  names the deck and the `htmlcraft open` recovery command instead of a plain
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

- Nested edits respect locked, hidden, and group wrappers for geometry,
  appearance, copy/paste, duplicate, and delete, including a guarded paste
  destination.
- Paste keeps the clipboard kind: HTML stays HTML, SVG internals stay in an SVG
  destination, mixed or table-internal destinations are refused with a specific
  hint, and an empty paste does not commit.
- Chart data edits reselect the owning figure after regeneration so the next
  gesture cannot target a stale chart child.
- Multi-selection chart and table panels are gated on a single selection, and
  mixed-depth selections no longer expose structural commands.
- Locked or hidden containers exposed an enter chevron and could be entered
  with Enter; they now show no enter affordance and the shared predicate
  refuses them.
- The appearance panel stayed enabled for nested elements inside a locked,
  hidden, or grouped wrapper; every appearance field now follows the same lock
  rules as geometry.
- Image upload bypassed the top-level lock and could rewrite a locked subtree;
  uploads now check the owning wrapper.
- MCP `open_editor` reported success when the spawned host answered
  `/api/health` but its editor shell was broken; a broken editor now fails the
  open instead of reporting success (`editor-timeout` after the spawn timeout;
  `editor-failed` when the CLI exits non-zero).
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

- Component selection is editor-only: paths are not persisted, the deck format
  and MCP surface are unchanged, and every move is an inline style or SVG
  transform attribute.
- Browser sessions use a 30-day HttpOnly `SameSite=Strict` cookie renewed on
  successful page loads; the tokenized URL is exchanged once, and CLI and MCP
  traffic keeps bearer auth.
- Documentation updated across the root README, SECURITY, and architecture
  docs, the published package README and SECURITY, and the skill references for
  the credential store and liveness checks; drill-in editing is documented in
  the README, `docs/architecture.md`, and `docs/contract.md`.

### Notes

- npm publish, tags, GitHub releases, and other shipping actions require
  explicit authorization.
- Deck credentials live at `~/.htmlcraft/decks`; `htmlcraft stop` rotates the token.
