// This supervisor survives controller failure long enough to stop its process group.
// Do not import application state here. It must work during runtime upgrades.
import { spawn } from 'node:child_process';
const options = JSON.parse(process.argv[2]);
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  try { process.kill(-process.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
  setTimeout(() => { try { process.kill(-process.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); process.exit(124); } }, 500);
}
process.on('SIGTERM', stop); process.on('SIGINT', stop); process.on('SIGHUP', stop);
const child = spawn(options.argv[0], options.argv.slice(1), { cwd: options.cwd, env: process.env, stdio: 'inherit' });
child.on('error', e => { console.error(`Cannot start command: ${e.message}`); process.exit(127); });
child.on('exit', (code, signal) => { if (!stopping) process.exit(code ?? 128); });
setTimeout(stop, options.timeoutMs);
setInterval(() => { try { process.kill(options.parentPid, 0); } catch { stop(); } }, 250);
