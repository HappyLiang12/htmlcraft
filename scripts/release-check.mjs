import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(command) {
  process.stdout.write(`\n$ ${command}\n`);
  execSync(command, { cwd: root, stdio: 'inherit', shell: true });
}

run('npm audit --omit=dev');
run('npm run build');
run('git diff --exit-code -- packages/htmlppt/THIRD-PARTY-LICENSES.md');
run('node scripts/package-smoke.mjs');

const manifest = JSON.parse(
  readFileSync(path.join(root, 'packages/htmlppt/package.json'), 'utf8')
);
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version)) {
  throw new Error(`Refusing to interpolate version "${manifest.version}"`);
}
try {
  const published = execSync(`npm view htmlcraft@${manifest.version} version`, {
    cwd: root,
    stdio: 'pipe',
    shell: true
  })
    .toString()
    .trim();
  console.error(
    `\nhtmlcraft@${manifest.version} is already published (${published}).`
  );
  process.exit(1);
} catch {
  process.stdout.write(`\nhtmlcraft@${manifest.version} is unpublished.\n`);
}

run('npm publish -w htmlcraft --access public --dry-run');
process.stdout.write('\nRelease checks passed.\n');
