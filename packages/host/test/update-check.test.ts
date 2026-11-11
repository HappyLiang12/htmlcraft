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
      env: {},
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
      env: {},
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
      env: {},
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
      env: {},
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
      env: {},
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
    const first = await checkForUpdate({
      currentVersion: '0.1.1',
      cacheFile,
      env: {},
      fetchImpl
    });
    const second = await checkForUpdate({
      currentVersion: '0.1.1',
      cacheFile,
      env: {},
      fetchImpl
    });
    expect(first?.latestVersion).toBe('0.2.0');
    expect(second).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('ignores a malformed notified version instead of suppressing the notice', async () => {
    const home = await tempHome();
    const cacheFile = join(home, 'update-check.json');
    await writeFile(
      cacheFile,
      JSON.stringify({
        checkedAt: new Date().toISOString(),
        latestVersion: '0.2.0',
        notifiedVersion: 'not-a-version'
      })
    );
    const fetchImpl = vi.fn(async () => ok('0.2.0'));
    const result = await checkForUpdate({
      currentVersion: '0.1.1',
      cacheFile,
      env: {},
      fetchImpl
    });
    expect(result?.latestVersion).toBe('0.2.0');
    expect(fetchImpl).not.toHaveBeenCalled();
    const cache = JSON.parse(await readFile(cacheFile, 'utf8'));
    expect(cache.notifiedVersion).toBe('0.2.0');
  });

  it('writes the cache atomically with the notified version', async () => {
    const home = await tempHome();
    const cacheFile = join(home, 'update-check.json');
    await checkForUpdate({
      currentVersion: '0.1.1',
      cacheFile,
      env: {},
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
        env: {},
        fetchImpl: async () => ok('0.2.0')
      }
    );
    await vi.waitFor(() => {
      expect(chunks.join('')).toContain('htmlcraft 0.2.0 is available');
    });
  });
});
