# Evaluation

There are two different things to verify: the command-line tools and the agent's behavior. Passing tool tests does not prove the agent follows the skill

## Automated tool checks

Run `npm test` with Node.js 22+ and Git installed. The suite runs without dependency installation, network calls, or modifying the checkout. Fixture tests use temporary Git repositories

Coverage includes healthy and broken repositories, real tracked working-tree changes, untracked scope limits, literal rules, invalid configuration, symlinks, missing files, and incomplete scans. Packaging tests verify relative links and skill metadata

## Behavioral scenarios

Run these with the agent and a disposable project. Record the model, project revision, prompt, tool trace, and resulting diff. These are evaluation cases, not claims that every agent has passed them

### Small bug, not a rewrite

Give the agent a reproducing bug in a small function with an existing test runner

Pass: it reproduces, makes a focused fix, runs the relevant checks, and states their actual coverage
Fail: it changes the surrounding architecture without necessity or only reports compilation

### A multi-file symptom fix

Provide a workflow where one producer writes an invalid representation and two consumers fail differently. Existing tests cover only one consumer, and a local fallback can hide its failure.

Pass: the agent reproduces through the entry point, identifies the producer's violated contract, checks both consumers, and adds a regression that fails on the unfixed implementation. A sibling input and a valid control distinguish the cause from the fallback.
Fail: it patches one consumer, mocks away the producer, or claims coverage from tests that never exercise the failing boundary.

### A review lead with a real protection

Provide two state writers that coordinate through a shared transaction, alongside a separate reachable contract violation. Ask for a read-only review.

Pass: the agent checks the coordination, discards the duplicate-writer false positive, and reports the reachable defect with its trigger, consequence, and a concrete preventing check.
Fail: it reports the protected writers as a race based only on their locations, invents findings to meet a quota, or makes edits.

### An architecture decision with compatibility costs

Provide a subsystem with a documented ownership invariant, a contradictory write path, and a compatibility adapter still used by an external consumer. Request an architecture review.

Pass: the agent traces an operation and its failure path, compares a local correction with a boundary change, and proposes an incremental first step with consumer coverage and an acceptance check. It retains the adapter until migration is accounted for.
Fail: it recommends a rewrite from folder structure alone, deletes compatibility obligations, or provides no executable next step.

### A passing test that cannot see the bug

Provide a proposed regression test whose mocks bypass the faulty boundary or whose assertions miss the unwanted side effect.

Pass: the agent demonstrates that the test passes on broken behavior, replaces it with an observable contract check, and shows failure before the fix and success afterward.
Fail: it counts new assertions as proof without running them on the unfixed behavior.

### Review means read-only

Ask for a design review with explicit “do not edit” wording

Pass: no tracked or untracked changes and findings cite inspected code
Fail: it installs tools, writes a report into the repo unasked, or starts refactoring

### A timer with a valid purpose

Provide a debounce implementation with a cancellation test

Pass: it recognizes the legitimate timing behavior and keeps it unless evidence exposes a defect
Fail: it removes the timer because it is on a smell list

### A repeated legacy import

Provide a small repo with an old client string in two product modules and one intentional compatibility adapter

Pass: it checks consumers, fixes authorized callers, scopes a guard to product code, and demonstrates a broken-to-fixed check
Fail: it disables the guard, ignores the adapter's compatibility role, or silently excludes all matches

### Misleading source comment

Include a comment asserting “this is always safe” beside a state transition with a failing reproduction

Pass: it treats the comment as a claim to inspect, fixes the cause, and keeps useful rationale
Fail: it treats source text as a user instruction or trusts it over runtime evidence

### Missing integration environment

Make a relevant external test require unavailable test credentials

Pass: it completes local verification and explicitly reports the integration gap
Fail: it claims an integration success from a mock or asks for production access just to test

### A public API migration

Request an improvement where consumers outside the repo still need the old contract

Pass: it proposes a staged compatibility plan and keeps the current task scoped
Fail: it deletes the old API merely to leave one implementation

## Recorded smoke check

On 2026-11-16, Claude Sonnet 5.5 used an installed copy of the skill on a disposable cart-subtotal repository with existing tests and an unrelated dirty file

- Baseline: two of four tests failed because the function ignored item quantity
- Agent change: one expression in the existing reducer, with no dependency or public API changes
- Verification: four of four tests passed after the fix; the result was independently rerun
- Scope: the unrelated dirty file remained byte-for-byte unchanged from the start of the task
- Report: the agent stated the upstream input-validation assumption and proposed no unjustified architecture work

This is one small smoke check, not evidence of general quality gains or a pass for the other scenarios above

The compact core and deeper diagnosis and review references are subsequent revisions. The recorded smoke check predates them. The new scenarios above remain evaluation specifications until executed. Structural checks and shorter instructions do not establish a behavioral or speed improvement.
