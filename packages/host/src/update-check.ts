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

export function updateNotice(
  currentVersion: string,
  latestVersion: string
): string {
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
  await writeCache(cacheFile, {
    ...cache,
    notifiedVersion: cache.latestVersion
  });
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
    if (
      typeof body.version !== 'string' ||
      !/^\d+\.\d+\.\d+/.test(body.version)
    ) {
      return null;
    }
    return body.version;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function isFresh(
  cache: UpdateCache | null,
  now: number,
  ttlMs: number
): boolean {
  if (!cache) return false;
  const age = now - Date.parse(cache.checkedAt);
  return age >= 0 && age < ttlMs;
}

async function readCache(file: string): Promise<UpdateCache | null> {
  try {
    const value = JSON.parse(
      await readFile(file, 'utf8')
    ) as Partial<UpdateCache>;
    if (typeof value.checkedAt !== 'string') return null;
    if (!Number.isFinite(Date.parse(value.checkedAt))) return null;
    if (typeof value.latestVersion !== 'string') return null;
    if (!/^\d+\.\d+\.\d+/.test(value.latestVersion)) return null;
    return {
      checkedAt: value.checkedAt,
      latestVersion: value.latestVersion,
      notifiedVersion:
        typeof value.notifiedVersion === 'string' &&
        /^\d+\.\d+\.\d+/.test(value.notifiedVersion)
          ? value.notifiedVersion
          : undefined
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
