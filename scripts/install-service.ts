import { readFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomic } from '../src/files.ts';

// Installation writes a service definition. It does not load or start the service.
if(process.platform!=='darwin')throw new Error('This helper is for launchd on macOS. Use a service manager that restarts bin/z-loop serve on other POSIX hosts.');
const state=resolve(process.argv[2]||'.loop');await readFile(join(state,'config.json'),'utf8');
const xml=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const root=fileURLToPath(new URL('../',import.meta.url));
const target=join(homedir(),'Library/LaunchAgents/dev.z-loop.v2.plist');await mkdir(join(state,'service-logs'),{recursive:true});
const args=[process.execPath,'--experimental-strip-types',join(root,'src/cli.ts'),'serve','--home',state];
await atomic(target,`<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>
<key>Label</key><string>dev.z-loop.v2</string>
<key>ProgramArguments</key><array>${args.map(a=>`<string>${xml(a)}</string>`).join('')}</array>
<key>WorkingDirectory</key><string>${xml(root)}</string>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(process.env.PATH||'/usr/bin:/bin')}</string></dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer>
<key>StandardOutPath</key><string>${xml(join(state,'service-logs/stdout.log'))}</string>
<key>StandardErrorPath</key><string>${xml(join(state,'service-logs/stderr.log'))}</string>
</dict></plist>\n`);
console.log(`Installed ${target}\nStart: launchctl bootstrap gui/$(id -u) '${target}'\nStop: launchctl bootout gui/$(id -u) '${target}'`);
