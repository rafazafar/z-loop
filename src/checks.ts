import type { Check } from './types.ts';
// Supported patterns are exact paths, directory/**, and a single path segment '*'.
export function matchesPath(file: string, pattern: string): boolean {
  const parts=pattern.split('/');
  const expression=parts.map(p=>p==='**'?'.*':p.split('*').map(x=>x.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('[^/]*')).join('/');
  return new RegExp(`^${expression}$`).test(file);
}
export function selectChecks(checks: Check[], changed: string[]): Check[] {
  const selected=checks.filter(c=>!changed.length || c.setup || !c.paths?.length || changed.some(file=>c.paths!.some(p=>matchesPath(file,p))));
  if(!selected.some(c=>!c.setup))throw new Error('No mandatory verification check covers this change');
  for(const file of changed)if(!selected.some(c=>!c.setup&&(!c.paths?.length||c.paths.some(p=>matchesPath(file,p)))))throw new Error(`No mandatory verification check covers ${file}`);
  return selected;
}
