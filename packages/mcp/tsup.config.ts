import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'tsup';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  entry: ['src/bin.ts', 'src/index.ts'],
  format: ['esm'],
  target: 'node20',
  dts: true,
  clean: true,
  sourcemap: true,
  banner: { js: '#!/usr/bin/env node' },
  esbuildPlugins: [
    {
      name: 'raw-resources',
      setup(build) {
        // Virtual keys stay relative so the published bundles never embed the
        // build machine's absolute path.
        const sources = new Map<string, string>();
        build.onResolve({ filter: /\?raw$/ }, (args) => {
          const resolved = path.join(
            args.resolveDir,
            args.path.replace(/\?raw$/, '')
          );
          const key = path.relative(repoRoot, resolved).split(path.sep).join('/');
          sources.set(key, resolved);
          return { path: key, namespace: 'raw-resources' };
        });
        build.onLoad(
          { filter: /.*/, namespace: 'raw-resources' },
          async (args) => {
            const resolved = sources.get(args.path);
            if (!resolved) {
              throw new Error(`Unknown raw resource: ${args.path}`);
            }
            return { contents: await readFile(resolved, 'utf8'), loader: 'text' };
          }
        );
      }
    }
  ]
});
