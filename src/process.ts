import { spawn } from 'node:child_process';
import { StepError } from './types.ts';
import { atomic, redact } from './files.ts';
import { fileURLToPath } from 'node:url';

export interface ProcessResult { code: number; stdout: string; stderr: string; elapsedMs: number }
export async function execute(argv: string[], options: {
  cwd: string; signal?: AbortSignal; timeoutMs?: number; maxBytes?: number;
  log?: string; env?: NodeJS.ProcessEnv;
}): Promise<ProcessResult> {
  if (options.signal?.aborted) throw new StepError('cancelled', 'Operation cancelled');
  const started = Date.now(), max = options.maxBytes ?? 8_000_000;
  let stdout = '', stderr = '', bytes = 0, stopped: string | null = null, killTimer: NodeJS.Timeout | undefined;
  const wrapper = fileURLToPath(new URL('./process-worker.mjs', import.meta.url));
  const child = spawn(process.execPath, [wrapper, JSON.stringify({ argv, cwd: options.cwd, timeoutMs: options.timeoutMs || 60_000, parentPid: process.pid })], { cwd: options.cwd, env: options.env || process.env,
    detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
  const kill = (signal: NodeJS.Signals) => {
    try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal); else child.kill(signal); } catch { /* Already exited. */ }
  };
  const stop = (reason: string) => {
    if (stopped) return;
    stopped = reason; kill('SIGTERM'); killTimer = setTimeout(() => kill('SIGKILL'), 500); killTimer.unref();
  };
  const abort = () => stop('cancelled');
  options.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => stop('timeout'), options.timeoutMs || 60_000);
  const capture = (chunk: Buffer, target: 'out' | 'err') => {
    bytes += chunk.length;
    if (bytes > max) { stop('output limit'); return; }
    if (target === 'out') stdout += chunk.toString(); else stderr += chunk.toString();
  };
  child.stdout.on('data', chunk => capture(chunk, 'out'));
  child.stderr.on('data', chunk => capture(chunk, 'err'));
  let code: number;
  try {
    code = await new Promise<number>((done, fail) => {
      child.once('error', e => fail(new StepError('environment', `Cannot start ${argv[0]}: ${e.message}`)));
      child.once('close', c => done(c ?? 128));
    });
  } finally {
    clearTimeout(timer); if (killTimer) clearTimeout(killTimer);
    // Kill any detached descendants that kept running after the direct child.
    kill('SIGKILL'); options.signal?.removeEventListener('abort', abort);
    if (options.log) await atomic(options.log, redact(`Command: ${JSON.stringify(argv)}\nWorking directory: ${options.cwd}\nElapsed ms: ${Date.now() - started}\n${stopped ? `Stopped: ${stopped}\n` : ''}\nSTDOUT\n${stdout}\nSTDERR\n${stderr}`));
  }
  if (stopped) throw new StepError(stopped === 'cancelled' ? 'cancelled' : 'transient', `Process stopped: ${stopped}`, { log: options.log });
  return { code, stdout, stderr, elapsedMs: Date.now() - started };
}
