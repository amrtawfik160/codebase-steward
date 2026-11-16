# Architecture decisions

Start with a concrete obstacle in the current task. A folder layout, library, or pattern is not wrong merely because another style exists

## Trace a representative operation

For an architecture review or boundary change, follow one real operation from entry point through state changes to its consumers and effects. Record each boundary's input, output, owner, and invariant. Follow a failure path too. Use file locations and actual calls, not folder names alone.

Check whether multiple writers coordinate through a transaction or shared operation. Check whether a wrapper enforces policy, adapts a platform, or supports compatibility before calling it redundant. Separate observed defects from maintainability costs and proposed alternatives.

## Recognize the problem

- **Split ownership:** more than one component independently writes the same state. Trace writers and reconcile invariants before recommending one owner
- **Leaking internals:** callers need knowledge of storage, transport, or lifecycle details to use an API. Identify which knowledge can move behind the boundary
- **Parallel paths:** old and new APIs both gain callers. Check compatibility obligations and migration status before consolidating
- **Scattered decisions:** changing one business rule requires edits in unrelated modules. Identify the rule's real owner, not simply similarly spelled code
- **Pass-through layers:** wrappers add navigation without policy or adaptation. Keep boundaries with real responsibilities; remove only demonstrably redundant ones
- **Repeated patches:** the same timing fix, synchronization flag, or special case appears across unrelated features. Reproduce the original problem before changing the design
- **Hand-synchronized data:** several lists or shapes must stay identical. Derive them from one source when possible; otherwise add a consistency check

## Before calling for a redesign

1. Cite exact readers, writers, and callers, not just a file size or name
2. Check history and tests for the reason the current shape exists
3. Explain a real consequence: a reproducible bug, contradictory state, repeated changes, or fragile verification
4. Separate essential domain complexity from accidental implementation complexity
5. Compare the smallest local fix with one boundary-level alternative

Choose the simpler option that meets the actual requirement. A speculative framework or a new abstraction used once needs a clear benefit, not a future-use story

Make the trade-off concrete. Name the invariant each option preserves, the consumers it affects, and its migration cost. For a maintenance concern, show an actual rule change that required coordinated edits or another inspected obstacle. If neither option has a demonstrated benefit, retain the current design.

## Design constraints that pay off

- Express mutually exclusive states with a discriminated union or state machine instead of independent booleans
- Parse external inputs at the boundary; rely on validated types internally where that trust is justified
- Keep business rules testable without starting the UI or transport layer
- Give state an explicit owner and make mutation paths visible
- Hide platform-specific primitives behind a focused API only when it removes recurring misuse

These are options, not universal prescriptions. A small script and a distributed service need different structure

## Propose a safe migration

State the current problem, target boundary, affected consumers, and compatibility constraints. Break the migration into behavior-preserving steps with a verification checkpoint after each

Make the first step actionable with the file or boundary to change and an observable acceptance check. Name how to handle existing records and mixed versions when they apply. For example, a state transition migration needs a test that exercises each writer and verifies the stored result, including a retry or reordered event if relevant.

For controlled internal consumers, migrate them together and remove the old path once unused. For public APIs, persisted data, or rolling deployments, provide a staged transition and rollback plan. “Delete the old code” is not a compatibility strategy

Keep the recommendation proportionate: if a small, verified local change solves the problem, do not turn it into a platform rewrite
