export type TicketState =
  | 'ready'
  | 'in-progress'
  | 'review'
  | 'fix'
  | 'done'
  | 'parked'
  | 'merged'
  | 'merged-unverified'
  | 'merged-audited'
  | 'manual-takeover';

export interface TransitionEvent {
  type:
    | 'SPAWN_WORKER'
    | 'PR_OPENED'
    | 'VERDICT_PASS'
    | 'VERDICT_BLOCK'
    | 'REPAIR_SPAWNED'
    | 'PR_MERGED_ASSURED'
    | 'PR_MERGED_BYPASS'
    | 'AUDIT_RECORDED'
    | 'PARK_DECISION'
    | 'RESUME_ASSURANCE'
    | 'MANUAL_TAKEOVER'
    | 'CLEAN_RETRY';
  payload?: any;
}

export function transition(current: TicketState, event: TransitionEvent): TicketState {
  switch (event.type) {
    case 'SPAWN_WORKER':
      if (current === 'ready') return 'in-progress';
      break;

    case 'PR_OPENED':
      if (current === 'in-progress' || current === 'fix') return 'review';
      break;

    case 'VERDICT_PASS':
      if (current === 'review') return 'done';
      break;

    case 'VERDICT_BLOCK':
      if (current === 'review') return 'fix';
      break;

    case 'REPAIR_SPAWNED':
      if (current === 'fix') return 'fix';
      break;

    case 'PR_MERGED_ASSURED':
      if (current === 'done') return 'merged';
      break;

    case 'PR_MERGED_BYPASS':
      if (['ready', 'in-progress', 'review', 'fix'].includes(current)) return 'merged-unverified';
      break;

    case 'AUDIT_RECORDED':
      if (current === 'merged-unverified') return 'merged-audited';
      break;

    case 'PARK_DECISION':
      return 'parked';

    case 'RESUME_ASSURANCE':
      if (current === 'parked') return 'review';
      break;

    case 'MANUAL_TAKEOVER':
      return 'manual-takeover';

    case 'CLEAN_RETRY':
      if (['parked', 'review', 'fix', 'in-progress'].includes(current)) {
        return event.payload?.targetPhase || 'in-progress';
      }
      break;
  }

  throw new Error(`Invalid state transition: from ${current} via ${event.type}`);
}
