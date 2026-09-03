import { spawn, ChildProcess } from 'node:child_process';
import { createWriteStream, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';

export interface SpawnOptions {
  sessionId: string;
  model: string;
  variant: string;
  cwd: string;
  promptFile: string;
  logsDir: string;
  inactivityTimeoutSec?: number;
  wallClockTimeoutSec?: number;
  graceSec?: number;
}

export interface ActiveProcess {
  sessionId: string;
  pid: number;
  pgid: number;
  child: ChildProcess;
  startedAt: number;
  lastOutputAt: number;
}

export class ProcessSupervisor extends EventEmitter {
  private active = new Map<string, ActiveProcess>();
  private watchInterval: NodeJS.Timeout | null = null;

  constructor() {
    super();
    this.startWatchdog();
  }

  public spawnWorker(opts: SpawnOptions): ActiveProcess {
    const { sessionId, model, variant, cwd, promptFile, logsDir } = opts;
    const logFile = join(logsDir, `${sessionId}.log`);
    const stream = createWriteStream(logFile, { flags: 'a' });

    // Format opencode command
    const args = [
      'run',
      '--pure',
      '--model', model,
      '--variant', variant,
      promptFile
    ];

    const child = spawn('opencode', args, {
      cwd,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        OPENCODE_CONFIG_CONTENT: JSON.stringify({ plugin: [], mcp: { 'google-docs': { enabled: false } } })
      }
    });

    const pid = child.pid!;
    const pgid = pid; // In detached mode on POSIX, child becomes group leader with PGID = PID

    const proc: ActiveProcess = {
      sessionId,
      pid,
      pgid,
      child,
      startedAt: Date.now(),
      lastOutputAt: Date.now()
    };

    this.active.set(sessionId, proc);

    child.stdout?.on('data', (chunk: Buffer) => {
      proc.lastOutputAt = Date.now();
      stream.write(chunk);
      this.emit('output', { sessionId, chunk: chunk.toString() });
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      proc.lastOutputAt = Date.now();
      stream.write(chunk);
      this.emit('output', { sessionId, chunk: chunk.toString(), isError: true });
    });

    child.on('exit', (code, signal) => {
      stream.end();
      this.active.delete(sessionId);
      this.emit('exit', { sessionId, code, signal });
    });

    child.on('error', (err) => {
      this.active.delete(sessionId);
      this.emit('error', { sessionId, error: err });
    });

    // Unref child to allow parent process to manage independently if needed
    child.unref();

    return proc;
  }

  public isRunning(sessionId: string): boolean {
    const proc = this.active.get(sessionId);
    if (!proc) return false;
    try {
      process.kill(-proc.pgid, 0);
      return true;
    } catch {
      this.active.delete(sessionId);
      return false;
    }
  }

  public async kill(sessionId: string, graceSec: number = 5): Promise<void> {
    const proc = this.active.get(sessionId);
    if (!proc) return;

    try {
      process.kill(-proc.pgid, 'SIGTERM');
    } catch {
      this.active.delete(sessionId);
      return;
    }

    const start = Date.now();
    while (Date.now() - start < graceSec * 1000) {
      if (!this.isProcessGroupAlive(proc.pgid)) {
        this.active.delete(sessionId);
        return;
      }
      await new Promise((r) => setTimeout(r, 250));
    }

    // Escalate to SIGKILL
    try {
      process.kill(-proc.pgid, 'SIGKILL');
    } catch {}
    this.active.delete(sessionId);
  }

  private isProcessGroupAlive(pgid: number): boolean {
    try {
      process.kill(-pgid, 0);
      return true;
    } catch {
      return false;
    }
  }

  private startWatchdog(): void {
    this.watchInterval = setInterval(() => {
      const now = Date.now();
      for (const [id, proc] of this.active.entries()) {
        // Inactivity check (1800s default)
        const silentMs = now - proc.lastOutputAt;
        if (silentMs > 1800 * 1000) {
          this.emit('timeout', { sessionId: id, reason: 'inactivity' });
          this.kill(id, 5);
        }
      }
    }, 10000);
    this.watchInterval.unref();
  }

  public stop(): void {
    if (this.watchInterval) {
      clearInterval(this.watchInterval);
      this.watchInterval = null;
    }
  }
}
