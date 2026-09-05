import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import type { Check } from './types.ts';

// Inspect declared repository checks. Do not execute setup during initialization.
export async function discoverChecks(repository: string): Promise<Check[]> {
  const exists = async (file: string) => { try { await access(join(repository, file)); return true; } catch { return false; } };
  const check = (name: string, command: string[]): Check => ({ name, command, cwd: '.', timeoutMs: 600_000 });
  if (await exists('package.json')) {
    const pkg = JSON.parse(await readFile(join(repository, 'package.json'), 'utf8'));
    const scripts = pkg.scripts || {}, checks: Check[] = [];
    let manager = 'npm';
    if (await exists('pnpm-lock.yaml')) { manager = 'pnpm'; checks.push(check('dependencies', ['pnpm', 'install', '--frozen-lockfile'])); }
    else if (await exists('package-lock.json')) checks.push(check('dependencies', ['npm', 'ci']));
    // A generic npm initializer test is not a project verification command.
    if (scripts.test && !scripts.test.includes('no test specified')) checks.push(check('test', [manager, 'run', 'test']));
    for (const name of ['check', 'typecheck', 'lint', 'build']) if (scripts[name]) checks.push(check(name, [manager, 'run', name]));
    return checks.some(c => c.name !== 'dependencies') ? checks : [];
  }
  if (await exists('Cargo.toml')) return [check('test', ['cargo', 'test', '--locked']), check('lint', ['cargo', 'clippy', '--locked', '--', '-D', 'warnings'])];
  if (await exists('go.mod')) return [check('test', ['go', 'test', './...']), check('vet', ['go', 'vet', './...'])];
  if (await exists('pubspec.yaml')) return [check('dependencies', ['flutter', 'pub', 'get']), check('test', ['flutter', 'test']), check('analyze', ['flutter', 'analyze'])];
  return [];
}
