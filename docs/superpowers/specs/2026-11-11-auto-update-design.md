# Auto-update notice — design

**Date:** 2026-11-11
**Status:** Draft for approval
**Release:** ships in `0.1.1`

## Goal

Keep an installed `htmlcraft` current without modifying the user's machine on
its own. The CLI and the MCP server check the public registry at most once per
24 hours and print a one-line notice when a newer release exists. Nothing is
installed or upgraded automatically: the notice is informational, and the
packaged skill asks the person before running any upgrade command.

**Consent invariant:** no code path runs `npm install`, `npm update`,
`npx htmlcraft@latest`, or any other upgrade. The only output is a stderr
notice; the skill's upgrade step requires the person's explicit agreement.

## Non-goals

- No silent self-update and no automatic `npm install`.
- No telemetry or identifiers; the only network call is a public registry GET.
- No editor chrome, no locale strings (the notice is CLI/MCP output in English).

## Shared checker

Node-only module `packages/host/src/update-check.ts`, exported from the host
package. The CLI and the MCP server both already depend on host, and host is the
local-process layer; core stays browser-safe.

```ts
export interface UpdateCheckOptions {
  currentVersion: string;
  cacheFile?: string;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  ttlMs?: number;
}
export interface UpdateCheckResult {
  currentVersion: string;
  latestVersion: string;
  notice: string;
}
export function compareVersions(a: string, b: string): number;
export async function checkForUpdate(
  options: UpdateCheckOptions
): Promise<UpdateCheckResult | null>;
```

Behavior:

- Request `GET https://registry.npmjs.org/htmlcraft/latest` with
  `Accept: application/json` and an abort timeout of 1000 ms.
- Cache in `${HTMLCRAFT_HOME:-~/.htmlcraft}/update-check.json`:
  `{ "checkedAt": "<ISO-8601>", "latestVersion": "x.y.z", "notifiedVersion": "x.y.z" }`.
- TTL 24 h from `checkedAt`. A fresh cache skips the network entirely, so a
  successful check contacts the registry at most once per day; an expired or
  corrupt cache is replaced only after a successful fetch, so a failed fetch
  is retried on the next run. Writes are atomic (temp file + rename) and
  best-effort.
- The notice prints at most once per version. `checkForUpdate` never marks a
  notice as delivered; the caller persists `notifiedVersion` only after it
  writes the notice (`markUpdateNotified`). A check whose result is abandoned
  — the CLI's 250 ms wait expiring — therefore does not consume the reminder,
  and the next run reads the fresh cache and prints it immediately. A newer
  release prints again. Repeated CLI invocations never spam the same reminder.
- Comparisons are numeric `major.minor.patch`; pre-release and build suffixes
  are ignored. A malformed registry version or any fetch error returns `null`
  and never throws.
- The cache is written even when the latest version is not newer, so a second
  run the same day does not re-request.
- Opt-outs: any non-empty `HTMLCRAFT_NO_UPDATE_CHECK`, or a non-empty `CI`.
  A fresh cache still honors the opt-out (no notice).

Notice text, one line on stderr:

```text
htmlcraft 0.2.0 is available (you have 0.1.1). Update: npm install -g htmlcraft@latest (or npx -y htmlcraft@latest ...)
```

The notice is emitted only when `latestVersion` is strictly newer than
`currentVersion`.

## CLI integration

- `runCli` starts the check once per invocation and waits at most 250 ms for it
  before returning; if the request finishes later it still writes the cache for
  the next run. The command result never depends on the check.
- Skipped when `process.stderr` is not a TTY, for the `mcp` subcommand (the
  server checks itself), and for the two opt-out variables. `CliIO` gains an
  optional `tty` flag (default `Boolean(process.stderr.isTTY)`) so tests do not
  need a real terminal.
- The notice goes through `io.stderr`, so machine-readable stdout stays clean.

## MCP integration

- `startStdio` triggers the check without blocking `createMcpServer` or
  `server.connect`; when it resolves, the notice is written to
  `process.stderr`. Nothing is ever written to stdout, and the process exit code
  is unchanged.
- Same cache, TTL, URL, and opt-outs. There is no TTY gate because an MCP stdio
  transport is always a pipe; `CI` remains the automation opt-out.

## Skill changes

In `skills/htmlcraft/SKILL.md`:

- The Setup section registers `npx -y htmlcraft@latest mcp` so the npx path
  always runs the newest release.
- Add “Keep the tools current”: if the CLI or MCP prints an update notice, or
  the person asks, run `npm view htmlcraft version`, compare it with
  `htmlcraft --version`, and offer `npm install -g htmlcraft@latest`. Never
  upgrade without the person's agreement.
- The no-install path stays available and is unaffected.

## Privacy and documentation

- `README.md` and `SECURITY.md` gain an “Update check” paragraph: one HTTPS GET
  to the npm registry per 24 h, no identifiers, no automatic install, disabled
  with `HTMLCRAFT_NO_UPDATE_CHECK=1` or in CI.
- `docs/mcp.md` notes that the server may print the notice to stderr.

## Testing

- Host unit tests (`@feature:update-check`): version comparison; newer, equal,
  and older; fresh cache avoids `fetch`; stale cache fetches; corrupt cache is
  ignored; fetch failure and timeout are silent; opt-out variables; notice
  content; the notice prints once per version and stays quiet on later runs;
  atomic cache write; no throw on malformed JSON.
- CLI tests: TTY gating, `mcp` skip, opt-out, and one notice-print case using a
  temp `HTMLCRAFT_HOME` and an injected checker result.
- MCP test: the notice never reaches stdout and the initialize handshake is
  unchanged; fixtures set `HTMLCRAFT_NO_UPDATE_CHECK=1` so tests stay
  hermetic.
- `docs/features.json` gains `update-check` with its test tag. No Playwright
  coverage is added; the notice is not rendered in the editor.

## Risks

- A successful check adds one registry request per 24 h per machine; a failed
  check retries on the next run. A slow request adds up to 250 ms to the first
  CLI run after the cache expires; later runs read the cache.
- If the trusted-publisher configuration expires while this feature is built,
  the user re-adds the trusted publisher on npmjs.com and the validation
  publish restarts its two-day window.
