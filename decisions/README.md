# decisions/

Kind: card + queue. Cards: `*.card.md` (schema templates/decision-card.md).
Queues: `<YYYY-MM-DD>-<HHMM>-queue.md`, assembled by the decision desk.
`decisions-log.md` is the append-only record of answers.

Rules:
- Any role may park a card. Only the human answers.
- `status: answered` cards keep their content — they are the ARD source.
- Queue overflow (cap 7) carries to the next batch, oldest first.
- Unanswered cards apply their stated default at the NEXT batch, and the
  applied default is logged like any answer.
