export type Workflow = 'code' | 'plan';
export type StepKind = 'implement' | 'verify' | 'review' | 'publish' | 'integrate' | 'observe' | 'plan' | 'check_plan' | 'apply_plan' | 'resolve';
export type StepState = 'queued' | 'running' | 'waiting' | 'retry_scheduled' | 'succeeded' | 'rejected' | 'failed' | 'cancelled';
export type FailureClass = 'transient' | 'provider' | 'contract' | 'verification' | 'review' | 'revision' | 'environment' | 'external' | 'cancelled';
export interface Check { name: string; command: string[]; cwd: string; timeoutMs: number }
export interface Config {
  version: 1;
  repository: string;
  baseBranch: string;
  integration: 'local' | 'github';
  githubRepository?: string;
  worker: { kind: 'opencode' | 'command'; command?: string[]; model?: string; variant?: string };
  checks: Check[];
  limits: { concurrency: number; leaseMs: number; attemptMs: number; retryBaseMs: number; maxAttempts: number; maxRepairs: number; dailyAttempts: number; maxOutputBytes: number };
  server: { host: '127.0.0.1'; port: number };
}
export interface WorkInput {
  title: string; specification: string; acceptance: string[];
  sourceKey?: string; workflow?: Workflow; dependencies?: string[];
  priority?: number; metadata?: Record<string, unknown>;
}
export interface Step {
  id: string; run_id: string; kind: StepKind; state: StepState; position: number;
  input_json: string; result_json: string | null; next_at: number; generation: number;
  attempt_count: number; failure_class: string | null; error: string | null;
  wait_kind: string | null; wait_key: string | null; resource: string | null;
}
export interface Run {
  id: string; work_id: string; status: string; revision: number;
  repair_count: number; context_json: string; workflow_version: number;
}
export interface Attempt {
  id: string; step_id: string; generation: number; owner: string; status: string;
  lease_until: number; started_at: number; ended_at: number | null;
  result_json: string | null; failure_json: string | null;
}
export interface Claim { step: Step; run: Run; attempt: Attempt; work: WorkInput & { id: string } }
export interface ExternalNeed {
  category: 'external_fact' | 'external_authority' | 'physical_action';
  question: string; reason: string; attempted: string[]; noSafeDefault: string;
}
export type AgentResult =
  | { version: 1; outcome: 'complete'; summary: string }
  | { version: 1; outcome: 'pass'; summary: string; advisories: Proposal[] }
  | { version: 1; outcome: 'repair'; summary: string; findings: string[] }
  | { version: 1; outcome: 'plan'; summary: string; proposals: Proposal[] }
  | { version: 1; outcome: 'needs_external'; summary: string; need: ExternalNeed }
  | { version: 1; outcome: 'default'; summary: string; choice: string; refinement: Proposal };
export interface Proposal { title: string; specification: string; acceptance: string[]; key: string; dependsOn?: string[] }
export interface Receipt { artifact: string; sha256: string; data: Record<string, unknown> }
export interface StepResult {
  context?: Record<string, unknown>;
  summary: string;
  artifact?: { path: string; sha256: string; kind: string };
  repair?: string[];
  need?: ExternalNeed;
  defaultChoice?: { choice: string; refinement: Proposal };
  proposals?: Proposal[];
  advisories?: Proposal[];
}
export class StepError extends Error {
  category: FailureClass; details: Record<string, unknown>;
  constructor(category: FailureClass, message: string, details: Record<string, unknown> = {}) {
    super(message); this.name = 'StepError'; this.category = category; this.details = details;
  }
}
export class WaitError extends Error {
  kind: string; delayMs: number;
  constructor(kind: string, message: string, delayMs = 30_000) { super(message); this.kind = kind; this.delayMs = delayMs; }
}
