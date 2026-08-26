# signals/

Kind: signal. Evidence with frequency, written only by the Gardener.
One file per distinct signal (dedupe by slug BEFORE creating):

    ---
    kind: signal
    category: feedback | idea | friction | observation
    frequency: N
    sources: [ids/urls]
    domain: [implement | spec-sync | ticket-factory | gardener]
    status: open | triaged | actioned | closed
    ---

Rules:
- Recurrence bumps `frequency` and adds a Timeline line. Never a new file.
- frequency == Timeline entry count. If they disagree, the file is wrong.
- frequency >= 3 makes the signal eligible for a proposed issue.
