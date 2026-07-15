# @tv-automation/desk-domain

Pure deterministic Desk V2 domain rules.

This package contains only side-effect-free rule evaluators:

- `evaluateAntiLookahead`
- `evaluateGates`
- `evaluateRisk`
- `validateSetup`
- `transitionThesisState`

All services return the standard domain result shape:

```txt
ok: boolean
status: accepted | rejected | review_required
reasons: string[]
flags: string[]
evidence: object
```

The package must not import Firebase, OpenAI, React, broker clients, filesystem adapters, HTTP clients or implicit wall-clock calls. Callers provide every timestamp, decision, setup, gate and risk context explicitly.

## Tests

```bash
npm --prefix packages/desk-domain test
```

M8.1 does not integrate these services into MCP, dashboard, replay, worker or live execution. Consumer migration starts in later milestones after the package boundary is reviewed.
