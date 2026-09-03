import { loadConfig } from '../config.ts';
import { LoopDatabase } from '../db/index.ts';
import { GithubClient } from '../core/github.ts';
import { ProcessSupervisor } from '../core/supervisor.ts';
import { runTick } from '../engine/tick.ts';
import { checkCircuitBreaker } from '../engine/circuit-breaker.ts';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const command = args[0] || 'status';

const rootDir = process.cwd();
const { config, configPath } = loadConfig(rootDir);
const dbPath = join(rootDir, 'state', 'loop.db');
const db = new LoopDatabase(dbPath);

async function main() {
  switch (command) {
    case 'status': {
      console.log(`== Loop 2.0 · ${config.project.name} ==`);
      console.log(`Config: ${configPath}`);
      console.log(`Repo:   ${config.project.repo_path}`);

      const cb = checkCircuitBreaker(db);
      if (cb.status === 'tripped') {
        console.log(`\n[CIRCUIT BREAKER TRIPPED] Model ${cb.model} cooling down until ${cb.cooldownUntil}`);
      }

      const tickets = db.listTickets();
      console.log(`\n-- Tracked Tickets (${tickets.length}) --`);
      if (tickets.length === 0) {
        console.log('  (no active tickets tracked in database)');
      } else {
        for (const t of tickets) {
          const prStr = t.pr_number ? `· PR #${t.pr_number} (${t.pr_url || ''})` : '';
          console.log(`  #${t.id} [${t.state.toUpperCase()}] ${t.title} ${prStr}`);
        }
      }

      const sessions = db.listSessions().filter((s) => s.status === 'running');
      console.log(`\n-- Active Sessions (${sessions.length}) --`);
      if (sessions.length === 0) {
        console.log('  (none running)');
      } else {
        for (const s of sessions) {
          console.log(`  ${s.id} (${s.role}, ${s.phase}) - model: ${s.model}`);
        }
      }
      break;
    }

    case 'tick': {
      const ghRepo = await GithubClient.resolveRepo(config.project.repo_path);
      const github = new GithubClient(ghRepo);
      const supervisor = new ProcessSupervisor();
      console.log(`Running tick for ${config.project.name} (${ghRepo})...`);
      const summary = await runTick(db, config, github, supervisor, rootDir);
      console.log(`Reconciled PRs:      ${summary.reconciledPrs}`);
      console.log(`Completed Sessions:  ${summary.completedSessions}`);
      console.log(`Active Sessions:     ${summary.activeCount}`);
      if (summary.warnings.length > 0) {
        console.log('\nWarnings:');
        for (const w of summary.warnings) console.log(`  - ${w}`);
      }
      supervisor.stop();
      break;
    }

    case 'doctor': {
      // Run doctor check
      const doctorProc = spawn('run/doctor', [], { stdio: 'inherit', cwd: rootDir });
      doctorProc.on('exit', (code) => process.exit(code || 0));
      return;
    }

    case 'ui': {
      const portArgIdx = args.indexOf('--port');
      const customPort = portArgIdx !== -1 ? parseInt(args[portArgIdx + 1], 10) : null;
      const port = customPort || config.daemon?.dashboard_port || 4177;

      const build = spawnSync('npm', ['run', 'ui:build', '--silent'], { cwd: rootDir, stdio: 'inherit' });
      if (build.status !== 0) {
        console.error('Could not build the dashboard.');
        process.exit(build.status || 1);
      }

      // Check if already running
      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/state`, { signal: AbortSignal.timeout(1000) });
        if (res.ok) {
          console.log(`Operator Console is already running at http://127.0.0.1:${port}`);
          console.log(`Opening browser...`);
          spawn('open', [`http://127.0.0.1:${port}`], { stdio: 'ignore' }).unref();
          return;
        }
      } catch {}

      console.log(`Starting Operator Console on http://127.0.0.1:${port}...`);
      const srv = spawn('node', ['web/server.mjs', '--port', String(port)], {
        stdio: 'inherit',
        cwd: rootDir
      });
      // Give server a moment to start and then open browser
      setTimeout(() => {
        spawn('open', [`http://127.0.0.1:${port}`], { stdio: 'ignore' }).unref();
      }, 1000);
      srv.on('exit', (code) => process.exit(code || 0));
      return;
    }

    default:
      console.log(`Unknown command: ${command}`);
      console.log(`Usage: loop <status|tick|doctor|ui>`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
}).finally(() => {
  db.close();
});
