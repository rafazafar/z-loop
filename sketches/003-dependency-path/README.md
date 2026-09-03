## Variant: Dependency path

### Design stance
Show ownership inside the critical paths and make convergence explicit.

### Key choices
- Layout: horizontal dependency paths with actor labels on every node.
- Typography: narrative flow from now to later.
- Color: ownership is encoded consistently without dominating the graph.
- Interaction: isolate owner actions and expand nodes for details.

### Trade-offs
- Strong at: explaining why an action matters and what it unlocks.
- Weak at: dense queues with many parallel branches.

### Best for
- Planning sessions and users who need to understand dependency sequence.
