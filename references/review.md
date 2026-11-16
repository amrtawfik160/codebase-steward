# Review with evidence

Keep the review read-only. Respect the requested files, subsystem, or comparison base. Examine adjacent code to verify a claim, and identify anything outside the reviewed scope.

## Establish what the code promises

Read the contract, relevant tests, and actual call path before judging an implementation. For a diff review, distinguish introduced defects from pre-existing problems. For an architecture review, read [architecture guidance](architecture.md) and follow one representative operation across its boundaries.

Map the relevant inputs, state owners, writers, readers, and failure paths. Prioritize boundaries where a violated assumption could cause data loss, incorrect results, broken compatibility, or an unusable workflow.

## Confirm or discard each candidate

For every suspected issue:

1. Locate the reachable entry point and a concrete input, state, or event order that triggers it.
2. State the expected behavior and its source. Separate a documented guarantee from an inferred convention.
3. Trace the causal path with exact file and line evidence. Run a safe minimal reproduction when possible. If execution is unavailable, show the static path and label the runtime claim unverified.
4. Look for disconfirming evidence in upstream validation, synchronization, compatibility adapters, configuration, and tests. Inspect actual callers before asserting that a case is reachable.
5. Keep the finding only if the evidence supports a practical consequence. Merge findings with the same cause. Put unresolved candidates in a clearly separate hypotheses section with the next check, or omit low-value speculation.

A large file, duplicate writer, timer, retry, cast, or wrapper is a lead, not proof of a defect. Two writers may share a valid transaction. A guard may make the suspected state unreachable. State which protection was checked and why it fails before claiming a bug.

## Make the next step executable

Order confirmed findings by impact and likelihood, not by how unusual the code looks. Each finding needs:

- Exact location and the affected caller or workflow.
- Trigger, expected behavior, observed result or static evidence, and practical consequence.
- Confidence and verification limits.
- Smallest safe correction, affected consumers, and compatibility risk.
- A regression check with concrete input and expected outcome that would catch the fault.

Architecture recommendations also need the violated invariant or observed maintenance obstacle and a staged next step. Compare a local correction with a boundary change before proposing a migration. A diagram or pattern name alone is not a finding.

When the current test suite already fails, name the failing case and explain why the present checks did not prevent the issue. Recommend a missing regression test only when you can identify what it adds.

Close with the reviewed scope and checks actually run. No confirmed findings is a useful result. Do not invent defects or architecture advice to fill a quota.
