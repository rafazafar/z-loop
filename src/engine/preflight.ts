import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { CommandsConfig, DiffBudgetConfig } from '../config.ts';

const execAsync = promisify(exec);

export interface PreflightResult {
  ok: boolean;
  testPassed?: boolean;
  lintPassed?: boolean;
  budgetPassed?: boolean;
  details: string[];
}

export async function runPreflight(
  worktreePath: string,
  commands: CommandsConfig = {},
  budget?: DiffBudgetConfig,
  changedFilesCount?: number
): Promise<PreflightResult> {
  const details: string[] = [];
  let ok = true;
  let testPassed = true;
  let lintPassed = true;
  let budgetPassed = true;

  // 1. Diff budget check
  if (budget && typeof changedFilesCount === 'number') {
    if (changedFilesCount > budget.max_files) {
      budgetPassed = false;
      details.push(`Diff budget exceeded: ${changedFilesCount} files changed (max ${budget.max_files})`);
    }
  }

  // 2. Lint check
  if (commands.lint) {
    try {
      await execAsync(commands.lint, { cwd: worktreePath, timeout: 60000 });
      details.push(`Lint passed: ${commands.lint}`);
    } catch (err: any) {
      lintPassed = false;
      ok = false;
      details.push(`Lint failed: ${err.message}`);
    }
  }

  // 3. Test check
  if (commands.test) {
    try {
      await execAsync(commands.test, { cwd: worktreePath, timeout: 120000 });
      details.push(`Tests passed: ${commands.test}`);
    } catch (err: any) {
      testPassed = false;
      ok = false;
      details.push(`Tests failed: ${err.message}`);
    }
  }

  return {
    ok,
    testPassed,
    lintPassed,
    budgetPassed,
    details
  };
}
