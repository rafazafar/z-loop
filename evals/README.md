# evals/

Canned tickets for prompt/model regression testing. When an agent prompt or a
routing pin changes, replay every eval against the change before committing.

Format: one file per eval, the exact prompt+inputs a real run would get,
plus `expected.md` describing the acceptable output shape (not the exact
text). Run manually for now; auto-run is a deferred feature (see README).

- eval-001-qr-decompose.md — a too-big fake ticket; implementer must answer
  DECOMPOSE, not start work. (write when first needed)

Keep 5-10 evals alive. Delete stale ones shamelessly.
