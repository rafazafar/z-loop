import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, rmSync } from 'node:fs';

const exec = promisify(execFile);

export function branchSlug(title: string): string {
  const clean = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/, '');
  return clean || 'work';
}

export async function createWorktree(
  repoPath: string,
  worktreePath: string,
  branchName: string,
  baseRef: string = 'origin/main'
): Promise<void> {
  if (existsSync(worktreePath)) {
    await removeWorktree(repoPath, worktreePath);
  }
  // Ensure base ref is fetched
  await exec('git', ['-C', repoPath, 'fetch', 'origin', baseRef.replace('origin/', '')], { timeout: 30000 }).catch(() => null);

  // Add worktree branching from baseRef
  await exec('git', ['-C', repoPath, 'worktree', 'add', '-B', branchName, worktreePath, baseRef], {
    timeout: 30000
  });
}

export async function removeWorktree(repoPath: string, worktreePath: string): Promise<void> {
  try {
    await exec('git', ['-C', repoPath, 'worktree', 'remove', '--force', worktreePath], { timeout: 15000 });
  } catch {
    // If git worktree remove fails, remove directory and prune
    if (existsSync(worktreePath)) {
      rmSync(worktreePath, { recursive: true, force: true });
    }
    await exec('git', ['-C', repoPath, 'worktree', 'prune'], { timeout: 10000 }).catch(() => null);
  }
}

export async function getCurrentHead(worktreePath: string): Promise<string> {
  const { stdout } = await exec('git', ['-C', worktreePath, 'rev-parse', 'HEAD'], { timeout: 5000 });
  return stdout.trim();
}

export async function getDiff(
  worktreePath: string,
  baseOid: string,
  headOid: string
): Promise<{ files: string[]; patch: string }> {
  const [filesRes, patchRes] = await Promise.all([
    exec('git', ['-C', worktreePath, 'diff', '--name-only', `${baseOid}...${headOid}`], { timeout: 10000 }),
    exec('git', ['-C', worktreePath, 'diff', '--no-ext-diff', `${baseOid}...${headOid}`], { timeout: 15000 })
  ]);

  const files = filesRes.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  return { files, patch: patchRes.stdout };
}
