# Auto-update notice — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a once-a-day, notice-only update check to the htmlcraft CLI and MCP server, and make the packaged skill ask the person before installing or upgrading the tools.

**Architecture:** A Node-only checker in `@htmlppt/host` reads/writes a 24 h cache, fetches `https://registry.npmjs.org/htmlcraft/latest`, and returns a one-line notice. The CLI awaits it for at most 250 ms after a command; the MCP server announces it on stderr in the background. Nothing installs or upgrades anything.

**Tech Stack:** TypeScript ESM, Node 20+ global `fetch`, Vitest, tsup, npm workspaces.

**Spec:** `docs/superpowers/specs/2026-11-11-auto-update-design.md`

## Global Constraints

- Never commit or push directly on `main`; the user performs merges. A push is authorized per round only.
- Full `npm run verify` on the final HEAD before the PR; build and verify never run concurrently.
- Never skip, delete, or loosen a test.
- Notice-only: no `npm install`, `npm update`, `npx`, `child_process`, or self-update in the new code.
- The checker lives in `@htmlppt/host`; `@htmlppt/core` stays browser-safe.
- No new runtime dependencies. Node.js 20+ only.
- All files, comments, and docs in English. Reply to the user in Traditional Chinese.
- Version stays `0.1.1`; every change here ships in that release.
- Tests must never hit the network: inject `fetchImpl` and use temp cache files; spawned MCP processes get `HTMLCRAFT_NO_UPDATE_CHECK=1`.

---

### Task 1: Host update checker

**Files:**
- Create: `packages/host/src/update-check.ts`
- Modify: `packages/host/src/index.ts`
- Create: `packages/host/test/update-check.test.ts`
- Modify: `docs/features.json`

**Interfaces:**
- Consumes: `@htmlppt/test-utils` `makeTempDir`.
- Produces:
  - `compareVersions(a: string, b: string): number`
  - `updateCheckCacheFile(env?: NodeJS.ProcessEnv): string`
  - `checkForUpdate(options: UpdateCheckOptions): Promise<UpdateCheckResult | null>`
  - `announceUpdateOn(stream: { write(chunk: string): unknown }, options: UpdateCheckOptions): void`
  - `updateNotice(currentVersion: string, latestVersion: string): string`
  - types `UpdateCheckOptions`, `UpdateCheckResult`, `UpdateFetch`

- [ ] **Step 1: Write the failing tests**

Create `packages/host/test/update-check.test.ts`:

```ts
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { makeTempDir } from '@htmlppt/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  announceUpdateOn,
  checkForUpdate,
  compareVersions,
  updateCheckCacheFile,
  updateNotice
} from '../src/update-check.js';

const homes: string[] = [];

async function tempHome(): Promise<string> {
  const home = await makeTempDir('htmlcraft-update-');
  homes.push(home);
  return home;
}

function ok(version: string) {
  return { ok: true, json: async () => ({ version }) };
}

describe('update check @feature:update-check', () => {
  afterEach(async () => {
    await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
  });

  it('compares numeric versions and ignores pre-release suffixes', () => {
    expect(compareVersions('0.1.1', '0.2.0')).toBe(-1);
    expect(compareVersions('0.2.0', '0.2.0')).toBe(0);
    expect(compareVersions('1.0.0', '0.9.9')).toBe(1);
    expect(compareVersions('0.2.0-beta.1', '0.2.0')).toBe(0);
  });

  it('resolves the cache under HTMLCRAFT_HOME', async () => {
    const home = await tempHome();
    expect(updateCheckCacheFile({ HTMLCRAFT_HOME: home })).toBe(join(home, 'update-check.json'));
  });

  it('fetches once and reports a newer version with the upgrade hint', async () => {
    const home = await tempHome();
    const fetchImpl = vi.fn(async () => ok('0.2.0'));
    const result = await checkForUpdate({
      currentVersion: '0.1.1',
      cacheFile: join(home, 'update-check.json'),
      fetchImpl
    });
    expect(result?.latestVersion).toBe('0.2.0');
    expect(result?.notice).toBe(updateNotice('0.1.1', '0.2.0'));
    expect(result?.notice).toContain('npm install -g htmlcraft@latest');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('uses a fresh cache without a network call', async () => {
    const home = await tempHome();
    const cacheFile = join(home, 'update-check.json');
    await writeFile(
      cacheFile,
      JSON.stringify({
        checkedAt: new Date().toISOString(),
        latestVersion: '9.9.9',
        notifiedVersion: '0.0.0'
      })
    );
    const fetchImpl = vi.fn(async () => ok('0.2.0'));
    const result = await checkForUpdate({
      currentVersion: '0.1.1',
      cacheFile,
      fetchImpl
    });
    expect(result?.latestVersion).toBe('9.9.9');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refetches after the 24 hour TTL', async () => {
    const home = await tempHome();
    const cacheFile = join(home, 'update-check.json');
    const stale = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    await writeFile(
      cacheFile,
      JSON.stringify({ checkedAt: stale, latestVersion: '0.1.1' })
    );
    const fetchImpl = vi.fn(async () => ok('0.3.0'));
    const result = await checkForUpdate({
      currentVersion: '0.1.1',
      cacheFile,
      fetchImpl
    });
    expect(result?.latestVersion).toBe('0.3.0');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('ignores a corrupt cache and still checks', async () => {
    const home = await tempHome();
    const cacheFile = join(home, 'update-check.json');
    await mkdir(home, { recursive: true });
    await writeFile(cacheFile, 'not json');
    const fetchImpl = vi.fn(async () => ok('0.2.0'));
    const result = await checkForUpdate({
      currentVersion: '0.1.1',
      cacheFile,
      fetchImpl
    });
    expect(result?.latestVersion).toBe('0.2.0');
  });

  it('stays silent on fetch failure and does not notify from a stale cache', async () => {
    const home = await tempHome();
    const cacheFile = join(home, 'update-check.json');
    const stale = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    await writeFile(
      cacheFile,
      JSON.stringify({ checkedAt: stale, latestVersion: '9.9.9' })
    );
    const result = await checkForUpdate({
      currentVersion: '0.1.1',
      cacheFile,
      fetchImpl: vi.fn(async () => {
        throw new Error('offline');
      })
    });
    expect(result).toBeNull();
  });

  it('honors both opt-out variables', async () => {
    const home = await tempHome();
    const fetchImpl = vi.fn(async () => ok('0.2.0'));
    await expect(
      checkForUpdate({
        currentVersion: '0.1.1',
        cacheFile: join(home, 'a.json'),
        env: { HTMLCRAFT_NO_UPDATE_CHECK: '1' },
        fetchImpl
      })
    ).resolves.toBeNull();
    await expect(
      checkForUpdate({
        currentVersion: '0.1.1',
        cacheFile: join(home, 'b.json'),
        env: { CI: 'true' },
        fetchImpl
      })
    ).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports each new version once', async () => {
    const home = await tempHome();
    const cacheFile = join(home, 'update-check.json');
    const fetchImpl = vi.fn(async () => ok('0.2.0'));
    const first = await checkForUpdate({ currentVersion: '0.1.1', cacheFile, fetchImpl });
    const second = await checkForUpdate({ currentVersion: '0.1.1', cacheFile, fetchImpl });
    expect(first?.latestVersion).toBe('0.2.0');
    expect(second).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('writes the cache atomically with the notified version', async () => {
    const home = await tempHome();
    const cacheFile = join(home, 'update-check.json');
    await checkForUpdate({
      currentVersion: '0.1.1',
      cacheFile,
      fetchImpl: vi.fn(async () => ok('0.2.0'))
    });
    const cache = JSON.parse(await readFile(cacheFile, 'utf8'));
    expect(cache.latestVersion).toBe('0.2.0');
    expect(cache.notifiedVersion).toBe('0.2.0');
    expect(Number.isFinite(Date.parse(cache.checkedAt))).toBe(true);
  });

  it('writes the notice to the provided stream only', async () => {
    const home = await tempHome();
    const chunks: string[] = [];
    announceUpdateOn(
      { write: (chunk: string) => chunks.push(chunk) },
      {
        currentVersion: '0.1.1',
        cacheFile: join(home, 'update-check.json'),
        fetchImpl: async () => ok('0.2.0')
      }
    );
    await vi.waitFor(() => {
      expect(chunks.join('')).toContain('htmlcraft 0.2.0 is available');
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -w @htmlppt/host -- update-check`
Expected: FAIL — `Cannot find module '../src/update-check.js'`.

- [ ] **Step 3: Implement the checker**

Create `packages/host/src/update-check.ts`:

```ts
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

export const UPDATE_CHECK_URL = 'https://registry.npmjs.org/htmlcraft/latest';
export const UPDATE_CHECK_TTL_MS = 24 * 60 * 60 * 1000;
export const UPDATE_CHECK_TIMEOUT_MS = 1_000;

export interface UpdateFetchResponse {
  ok: boolean;
  json(): Promise<unknown>;
}

export type UpdateFetch = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal }
) => Promise<UpdateFetchResponse>;

export interface UpdateCheckOptions {
  currentVersion: string;
  cacheFile?: string;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  fetchImpl?: UpdateFetch;
  timeoutMs?: number;
  ttlMs?: number;
}

export interface UpdateCheckResult {
  currentVersion: string;
  latestVersion: string;
  notice: string;
}

interface UpdateCache {
  checkedAt: string;
  latestVersion: string;
  notifiedVersion?: string;
}

export function updateCheckCacheFile(
  env: NodeJS.ProcessEnv = process.env
): string {
  const override = env.HTMLCRAFT_HOME;
  const base =
    override && override.length > 0
      ? path.resolve(override)
      : path.join(homedir(), '.htmlcraft');
  return path.join(base, 'update-check.json');
}

export function compareVersions(a: string, b: string): number {
  const parse = (value: string): [number, number, number] | null => {
    const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(value.trim());
    return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
  };
  const left = parse(a);
  const right = parse(b);
  if (!left || !right) return 0;
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
  }
  return 0;
}

export function updateNotice(currentVersion: string, latestVersion: string): string {
  return (
    `htmlcraft ${latestVersion} is available (you have ${currentVersion}). ` +
    'Update: npm install -g htmlcraft@latest (or npx -y htmlcraft@latest ...)'
  );
}

export async function checkForUpdate(
  options: UpdateCheckOptions
): Promise<UpdateCheckResult | null> {
  const env = options.env ?? process.env;
  if (env.HTMLCRAFT_NO_UPDATE_CHECK || env.CI) return null;

  const now = options.now ?? Date.now;
  const cacheFile = options.cacheFile ?? updateCheckCacheFile(env);
  const ttlMs = options.ttlMs ?? UPDATE_CHECK_TTL_MS;

  let cache = await readCache(cacheFile);
  if (!isFresh(cache, now(), ttlMs)) {
    const latestVersion = await fetchLatestVersion(options);
    if (!latestVersion) return null;
    cache = {
      checkedAt: new Date(now()).toISOString(),
      latestVersion,
      notifiedVersion: cache?.notifiedVersion
    };
    await writeCache(cacheFile, cache);
  }
  if (!cache) return null;
  if (compareVersions(cache.latestVersion, options.currentVersion) <= 0) {
    return null;
  }
  if (
    cache.notifiedVersion &&
    compareVersions(cache.notifiedVersion, cache.latestVersion) >= 0
  ) {
    return null;
  }
  const notice = updateNotice(options.currentVersion, cache.latestVersion);
  await writeCache(cacheFile, { ...cache, notifiedVersion: cache.latestVersion });
  return {
    currentVersion: options.currentVersion,
    latestVersion: cache.latestVersion,
    notice
  };
}

export function announceUpdateOn(
  stream: { write(chunk: string): unknown },
  options: UpdateCheckOptions
): void {
  void checkForUpdate(options)
    .then((result) => {
      if (result) stream.write(`${result.notice}\n`);
    })
    .catch(() => {});
}

async function fetchLatestVersion(
  options: UpdateCheckOptions
): Promise<string | null> {
  const fetchImpl = options.fetchImpl ?? (fetch as unknown as UpdateFetch);
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? UPDATE_CHECK_TIMEOUT_MS
  );
  timer.unref();
  try {
    const response = await fetchImpl(UPDATE_CHECK_URL, {
      headers: { accept: 'application/json' },
      signal: controller.signal
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { version?: unknown };
    if (typeof body.version !== 'string' || !/^\d+\.\d+\.\d+/.test(body.version)) {
      return null;
    }
    return body.version;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function isFresh(cache: UpdateCache | null, now: number, ttlMs: number): boolean {
  if (!cache) return false;
  const age = now - Date.parse(cache.checkedAt);
  return age >= 0 && age < ttlMs;
}

async function readCache(file: string): Promise<UpdateCache | null> {
  try {
    const value = JSON.parse(await readFile(file, 'utf8')) as Partial<UpdateCache>;
    if (typeof value.checkedAt !== 'string') return null;
    if (!Number.isFinite(Date.parse(value.checkedAt))) return null;
    if (typeof value.latestVersion !== 'string') return null;
    if (!/^\d+\.\d+\.\d+/.test(value.latestVersion)) return null;
    return {
      checkedAt: value.checkedAt,
      latestVersion: value.latestVersion,
      notifiedVersion:
        typeof value.notifiedVersion === 'string' ? value.notifiedVersion : undefined
    };
  } catch {
    return null;
  }
}

async function writeCache(file: string, cache: UpdateCache): Promise<void> {
  const temp = `${file}.${process.pid}.tmp`;
  try {
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    await writeFile(temp, JSON.stringify(cache), { mode: 0o600 });
    await rename(temp, file);
  } catch {
    await rm(temp, { force: true }).catch(() => {});
  }
}
```

Add to `packages/host/src/index.ts`:

```ts
export {
  announceUpdateOn,
  checkForUpdate,
  compareVersions,
  updateCheckCacheFile,
  updateNotice,
  UPDATE_CHECK_TIMEOUT_MS,
  UPDATE_CHECK_TTL_MS,
  UPDATE_CHECK_URL
} from './update-check.js';
export type {
  UpdateCheckOptions,
  UpdateCheckResult,
  UpdateFetch
} from './update-check.js';
```

Add to `docs/features.json` after the `component-dragging` entry:

```json
{ "id": "update-check", "spec": "Auto-update notice 2026-11-11", "status": "active", "tests": ["@feature:update-check"] }
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `npm run test -w @htmlppt/host -- update-check`
Expected: PASS (11 tests).

Run: `npm run typecheck -w @htmlppt/host`
Expected: exit 0.

Run: `npm run build -w @htmlppt/host`
Expected: build success.

Run: `npm run test:matrix`
Expected: `Feature matrix OK`.

- [ ] **Step 5: Commit**

```bash
git add packages/host/src/update-check.ts packages/host/src/index.ts packages/host/test/update-check.test.ts docs/features.json
git commit -m "feat(host): add a once-a-day update notice checker"
```

---

### Task 2: CLI integration

**Files:**
- Modify: `packages/cli/src/index.ts`
- Modify: `packages/cli/test/cli.test.ts`

**Interfaces:**
- Consumes: `checkForUpdate` from `@htmlppt/host`; `CLI_VERSION`.
- Produces: `CLI_VERSION` (exported), `shouldCheckForUpdates(argv: string[], tty: boolean, env?: NodeJS.ProcessEnv): boolean`, `CliIO.tty?: boolean`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/cli/test/cli.test.ts` inside the top-level `describe` that already holds the CLI tests (near the other `runCli` tests):

```ts
it('checks for updates only on an interactive terminal and outside mcp', () => {
  expect(shouldCheckForUpdates(['new'], true, {})).toBe(true);
  expect(shouldCheckForUpdates(['mcp'], true, {})).toBe(false);
  expect(shouldCheckForUpdates(['new'], false, {})).toBe(false);
  expect(shouldCheckForUpdates(['new'], true, { HTMLCRAFT_NO_UPDATE_CHECK: '1' })).toBe(false);
  expect(shouldCheckForUpdates(['new'], true, { CI: 'true' })).toBe(false);
});

it('prints the update notice to stderr after a command', async () => {
  const home = await makeTempDir('htmlcraft-update-home-');
  const previousHome = process.env.HTMLCRAFT_HOME;
  process.env.HTMLCRAFT_HOME = home;
  try {
    await writeFile(
      join(home, 'update-check.json'),
      JSON.stringify({
        checkedAt: new Date().toISOString(),
        latestVersion: '9.9.9',
        notifiedVersion: '0.0.0'
      })
    );
    const output = capture();
    const cwd = await makeTempDir('htmlcraft-cli-');
    const code = await runCli(['new', 'notice.html'], {
      cwd,
      tty: true,
      ...output.io
    });
    expect(code).toBe(0);
    expect(output.stderr.join('\n')).toContain('htmlcraft 9.9.9 is available');
    expect(output.stdout.join('\n')).not.toContain('9.9.9');
  } finally {
    if (previousHome === undefined) delete process.env.HTMLCRAFT_HOME;
    else process.env.HTMLCRAFT_HOME = previousHome;
    await rm(home, { recursive: true, force: true });
  }
});

it('stays quiet without a terminal for the update notice', async () => {
  const home = await makeTempDir('htmlcraft-update-home-');
  const previousHome = process.env.HTMLCRAFT_HOME;
  process.env.HTMLCRAFT_HOME = home;
  try {
    await writeFile(
      join(home, 'update-check.json'),
      JSON.stringify({
        checkedAt: new Date().toISOString(),
        latestVersion: '9.9.9',
        notifiedVersion: '0.0.0'
      })
    );
    const output = capture();
    const cwd = await makeTempDir('htmlcraft-cli-');
    expect(await runCli(['new', 'quiet.html'], { cwd, tty: false, ...output.io })).toBe(0);
    expect(output.stderr.join('\n')).not.toContain('is available');
  } finally {
    if (previousHome === undefined) delete process.env.HTMLCRAFT_HOME;
    else process.env.HTMLCRAFT_HOME = previousHome;
    await rm(home, { recursive: true, force: true });
  }
});
```

Import `shouldCheckForUpdates` from `../src/index.js` next to the existing imports.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -w @htmlppt/cli -- -t "update"`
Expected: FAIL — `shouldCheckForUpdates is not exported` / no notice printed.

- [ ] **Step 3: Implement the CLI wiring**

In `packages/cli/src/index.ts`:

1. Import the checker:

```ts
import { checkForUpdate } from '@htmlppt/host';
```

2. Add near the other constants:

```ts
export const CLI_VERSION = '0.1.1';
const CLI_UPDATE_WAIT_MS = 250;
```

3. Extend `CliIO`:

```ts
export interface CliIO {
  cwd: string;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  tty?: boolean;
}
```

4. Add the eligibility helper:

```ts
export function shouldCheckForUpdates(
  argv: string[],
  tty: boolean,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return (
    tty &&
    argv[0] !== 'mcp' &&
    !env.HTMLCRAFT_NO_UPDATE_CHECK &&
    !env.CI
  );
}
```

5. In `runCli`, replace the `io` construction and `.version('0.1.1')`:

```ts
  const tty = overrides.tty ?? Boolean(process.stderr.isTTY);
  const io: CliIO = { cwd: process.cwd(), tty, ...DEFAULT_STREAMS, ...overrides };
  let exitCode = 0;
  const updateCheck = shouldCheckForUpdates(argv, tty)
    ? checkForUpdate({ currentVersion: CLI_VERSION })
    : null;
```

```ts
    .version(CLI_VERSION)
```

6. Before `return exitCode;` at the end of `runCli`:

```ts
  if (updateCheck) {
    const result = await waitForPromise(updateCheck, CLI_UPDATE_WAIT_MS);
    if (result?.notice) io.stderr(result.notice);
  }

  return exitCode;
```

7. Add the bounded wait helper next to the other module functions:

```ts
function waitForPromise<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    timer.unref();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      }
    );
  });
}
```

- [ ] **Step 4: Run the tests**

Run: `npm run test -w @htmlppt/cli -- -t "update"`
Expected: PASS (3 tests).

Run: `npm run typecheck -w @htmlppt/cli`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/index.ts packages/cli/test/cli.test.ts
git commit -m "feat(cli): print the daily update notice on interactive runs"
```

---

### Task 3: MCP integration and hermetic test environments

**Files:**
- Modify: `packages/mcp/src/server.ts`
- Modify: `packages/mcp/test/mcp-stdio.test.ts`
- Modify: `scripts/package-smoke.mjs`

**Interfaces:**
- Consumes: `announceUpdateOn` from `@htmlppt/host`.
- Produces: `MCP_VERSION` (exported from `server.ts`).

- [ ] **Step 1: Implement the MCP announcement**

In `packages/mcp/src/server.ts`:

```ts
import { announceUpdateOn } from '@htmlppt/host';

export const MCP_VERSION = '0.1.1';

const server = new McpServer(
  { name: 'htmlcraft', version: MCP_VERSION },
  { instructions: 'Use htmlcraft://contract and htmlcraft://authoring before editing a deck.' }
);
```

At the end of `startStdio`, after `server.connect`:

```ts
  announceUpdateOn(process.stderr, { currentVersion: MCP_VERSION });
```

- [ ] **Step 2: Make spawned MCP tests hermetic**

In `packages/mcp/test/mcp-stdio.test.ts`, add to the transport `env`:

```ts
      HTMLCRAFT_NO_UPDATE_CHECK: '1'
```

In `scripts/package-smoke.mjs`, add to `childEnv`:

```js
      HTMLCRAFT_NO_UPDATE_CHECK: '1'
```

- [ ] **Step 3: Run the MCP tests**

Run: `npm run test -w @htmlppt/mcp`
Expected: PASS; the initialize handshake still returns `serverInfo` with `htmlcraft` `0.1.1`.

Run: `npm run typecheck -w @htmlppt/mcp`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add packages/mcp/src/server.ts packages/mcp/test/mcp-stdio.test.ts scripts/package-smoke.mjs
git commit -m "feat(mcp): announce available updates on stderr"
```

---

### Task 4: Skill, docs, and changelog

**Files:**
- Modify: `skills/htmlcraft/SKILL.md`
- Modify: `README.md`
- Modify: `SECURITY.md`
- Modify: `docs/mcp.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Update the skill**

In the Setup section, change the MCP bullet to:

```markdown
1. **MCP server through npx (no global install).** Register
   `npx -y htmlcraft@latest mcp` as a stdio server in the agent's MCP
   configuration. The first run downloads the package; Node.js 20 or newer is
   required.
```

Add after the Setup section:

```markdown
## Keep the tools current

The CLI and MCP server print a one-line notice to stderr when a newer release
exists. They never update themselves. If a notice appears, or the person asks,
compare `npm view htmlcraft version` with `htmlcraft --version` and offer
`npm install -g htmlcraft@latest`. Run an upgrade only after the person agrees.
With npx, `npx -y htmlcraft@latest ...` already uses the newest release.
```

- [ ] **Step 2: Update README, SECURITY, and MCP docs**

README: change the MCP config args to the latest tag:

```json
      "args": ["-y", "htmlcraft@latest", "mcp"]
```

Add a short section after the Install section:

```markdown
## Updates

The CLI and MCP server check the public npm registry at most once a day and
print a one-line notice when a newer release exists. Nothing is installed or
upgraded automatically. Set `HTMLCRAFT_NO_UPDATE_CHECK=1` (or run in CI) to
disable the check; the only request is a `GET` for the package's latest version
and no identifiers are sent.
```

SECURITY.md: extend the local-first paragraph with:

```markdown
The CLI and MCP server make one public, unauthenticated `GET` to the npm registry
at most once per 24 hours to look up the latest version. No identifiers are sent,
nothing is installed automatically, and `HTMLCRAFT_NO_UPDATE_CHECK=1` or a CI
environment disables it.
```

docs/mcp.md: after the sentence that diagnostics are written to stderr, add:

```markdown
The stdio server may also print a one-line update notice to stderr (at most once
per version per day); it never writes the notice to stdout. Disable it with
`HTMLCRAFT_NO_UPDATE_CHECK=1` or by running in CI.
```

CHANGELOG: under `## 0.1.1` → `### Changed`, add:

```markdown
- The CLI and MCP server print a once-a-day update notice (one message per
  version) and never upgrade themselves. The packaged skill asks the person to
  choose npx, a global install, or no install, and asks before any upgrade.
```

- [ ] **Step 3: Rebuild the Agensi package**

Run:

```bash
rm .superpowers/sdd/release-0.1.0/assets/htmlcraft.zip
/c/Windows/System32/tar.exe -a -c -f .superpowers/sdd/release-0.1.0/assets/htmlcraft.zip -C skills htmlcraft
```

Expected: `htmlcraft/SKILL.md`, references, and examples with forward-slash entries.

- [ ] **Step 4: Commit**

```bash
git add skills/htmlcraft/SKILL.md README.md SECURITY.md docs/mcp.md CHANGELOG.md
git commit -m "docs: explain the update notice and the user-confirmed upgrade path"
```

---

### Task 5: Final gate, PR, and release operations

- [ ] **Step 1: Run the full local gate**

Run sequentially (never in parallel):

```bash
npm run build
npm run verify
```

Expected: `verify` exits 0.

- [ ] **Step 2: Push and open the PR**

```bash
git push -u origin feat/auto-update
gh pr create --repo HappyLiang12/htmlcraft --base main --head feat/auto-update \
  --title "feat: once-a-day update notice with user-confirmed upgrades" \
  --body-file .superpowers/sdd/release-0.1.0/pr-body-auto-update.md
```

The PR body must state: the notice is stderr-only, once per version per day, no
install path, opt-outs, tests, and the `0.1.1` release intent.

- [ ] **Step 3: Watch hosted CI**

`gh run watch <run-id> --exit-status`. A red Windows E2E is classified against
the known flakes (`ERR_NO_BUFFER_SPACE`, focus-ring `outlineWidth` 1) before any
product change; rerun failed jobs after a local reproduction attempt.

- [ ] **Step 4: After the user merges**

1. Wait for main CI green on the merge commit.
2. Dispatch `Release` with `dry_run: true`; the user approves the `npm-publish`
   environment.
3. Confirm the step env contains no `NODE_AUTH_TOKEN`, package smoke passes,
   and `npm publish --dry-run` reports `htmlcraft@0.1.1`.
4. Ask the user for the final publish approval, then dispatch with
   `dry_run: false`.
5. Verify `npm view htmlcraft@0.1.1 version`, `dist.integrity`, and the
   provenance attestation.
6. Rebuild the Agensi ZIP from the merged tree, submit the skill update
   (version 1.1) on agensi.io, and ask Agensi to correct the FAQ claim that the
   listing bundles the MCP server and CLI.
