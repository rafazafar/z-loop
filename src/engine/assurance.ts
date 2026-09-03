export interface ParsedVerdict {
  verdict: 'PASS' | 'BLOCK';
  task: string;
  bench: string;
  round: number;
  expected?: string;
  observed?: string;
  blockers: string[];
  advisories: string[];
}

export function parseVerdict(markdown: string): ParsedVerdict {
  const lines = markdown.split('\n');

  const getField = (prefix: string): string => {
    const line = lines.find((l) => l.startsWith(prefix));
    return line ? line.slice(prefix.length).trim() : '';
  };

  const verdictMatch = getField('VERDICT:');
  const verdict = verdictMatch === 'PASS' ? 'PASS' : 'BLOCK';
  const task = getField('TASK:') || 'unproven';
  const bench = getField('BENCH:') || 'none';
  const round = parseInt(getField('ROUND:') || '1', 10) || 1;
  const expected = getField('expected:');
  const observed = getField('observed:');

  const blockers: string[] = [];
  const advisories: string[] = [];

  let inBlockers = false;
  let inAdvisories = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('blockers:')) {
      inBlockers = true;
      inAdvisories = false;
      continue;
    }
    if (trimmed.startsWith('advisories:')) {
      inBlockers = false;
      inAdvisories = true;
      continue;
    }
    if (inBlockers && trimmed.startsWith('- ') && trimmed !== '- none') {
      blockers.push(trimmed.slice(2));
    }
    if (inAdvisories && trimmed.startsWith('- ') && trimmed !== '- none') {
      advisories.push(trimmed.slice(2));
    }
  }

  return {
    verdict,
    task,
    bench,
    round,
    expected,
    observed,
    blockers,
    advisories
  };
}

export function isBlockingVerdict(v: ParsedVerdict): boolean {
  // Only blockers (P0/P1) trigger blocking. Advisories (P2/P3) do not.
  return v.verdict === 'BLOCK' || v.blockers.some((b) => /^(P0|P1)\b/.test(b));
}
