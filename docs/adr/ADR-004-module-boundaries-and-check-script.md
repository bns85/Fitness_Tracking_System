# ADR-004: Strict Module Boundaries and Automated Lint Verification

## Status
Accepted

## Context
A common failure mode of monoliths is progressive architectural degradation ("architectural drift"). Developers under deadline pressure bypass encapsulation, import models from other modules, execute cross-module database joins, or tightly couple internal repositories. Over time, the monolith becomes impossible to test in isolation, difficult to refactor, and incapable of being incrementally migrated to microservices.

## Decision
We enforce strict structural modularity within the Modular Monolith through two mechanisms:
1. **Architectural Convention:**
   - Every module in `src/modules/<module-name>/` exposes its public interface exclusively via `index.js` (Facade pattern).
   - Each module owns its collections (`telemetry_*`, `goals_*`, `notifications_*`, `workouts_*`). No cross-module Mongoose model imports or direct database joins are permitted.
2. **Automated Enforcement Script (`scripts/check-modules.js`):**
   - An automated zero-dependency checker scans all files in `src/modules/**`.
   - It fails with exit code 1 if any file imports another module's internal files or imports a model belonging to another module.
   - It is integrated directly into `npm test`.

## Consequences

### Positive
- Enforces loose coupling and high cohesion at compile/test time.
- Prevents database spaghetti and hidden dependencies.
- Clear path for future decomposition into standalone microservices.

### Negative
- Requires developers to explicitly export functions on `index.js` facades.
- Cannot dynamically mock deep internals from the outside without going through facades.

## Governance
`npm test` must run `scripts/check-modules.js` on every build and pre-commit hook. Any pull request introducing a boundary violation will be rejected by CI.
