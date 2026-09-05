// Deterministic protocol fixture. Used only by tests and the disposable demo.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const request = JSON.parse(await readFile(process.argv[2], 'utf8'));
const meta = request.work.metadata || {}, feedback = request.feedback.feedback;
const need = { category: 'external_fact', question: 'What is the required external identifier?', reason: 'The acceptance contract requires an identifier owned by an external party.', attempted: ['Checked the supplied specification and available fixtures.'], noSafeDefault: 'A fabricated identifier would not satisfy the contract.' };
let result;
switch (request.role) {
  case 'implement':
    if (meta.mode === 'external' && !feedback) { result = { outcome: 'needs_external', need }; break; }
    await writeFile(join(process.cwd(), 'answer.mjs'), `export const answer = ${meta.mode === 'repair' && !feedback ? 41 : 42};\n`);
    if (meta.mode === 'missing-once' && request.attempt === 1) process.exit(0);
    result = { outcome: 'complete' }; break;
  case 'review': case 'check_plan':
    if (meta.mode === 'mutating-review') await writeFile(join(process.cwd(), 'unapproved.txt'), 'review mutation');
    result = { outcome: 'pass', advisories: [] }; break;
  case 'plan': result = { outcome: 'plan', proposals: meta.proposals || [] }; break;
  case 'resolve': result = meta.defaultAllowed ? { outcome: 'default', choice: 'Use the documented local fixture identifier.', refinement: { key: 'identifier-refinement', title: 'Review the fixture identifier', specification: 'Review whether the current fixture identifier needs refinement.', acceptance: ['Record the decision.'] } } : { outcome: 'needs_external', need }; break;
  default: throw new Error('Unsupported fixture role');
}
await writeFile(request.outputFile, JSON.stringify({ version: 1, summary: `Fixture ${request.role} completed`, ...result }));
