# Diagnose across modules

Use for multi-file bugs, competing explanations, or repeated failed fixes. Keep a compact working note proportional to the task.

## Pin the failure

Record the failing input or event sequence, expected behavior and its contract source, observed behavior, environment, and revision. Run the smallest reproduction through the real entry point before changing code. If the bug depends on persisted state or event order, preserve those conditions in isolated test data.

A failure caused by missing dependencies is an environment problem, not a reproduced product bug. If the intended environment is unavailable, state which evidence is missing and which claims remain hypotheses.

## Trace the first broken invariant

Follow the failing value or transition across module boundaries. At each boundary, identify the producer, representation, consumer, and assumption. Inspect where that assumption first becomes false. Include background writers, caches, generated clients, and compatibility adapters when the path uses them.

Distinguish the place that creates invalid state from the place that notices it. If the state is legitimate, handle it at the responsible boundary. If a producer violates its contract, correcting a downstream symptom leaves other consumers exposed.

When evidence supports competing causes, list each hypothesis and the cheapest observation that would distinguish it. Run that check before another patch. Two failed fixes sharing an assumption are a reason to test the assumption itself.

Stop tracing when the cause explains both the original failure and a nearby case without special pleading. Describe the causal chain with file locations and observed evidence. Label any unobserved link.

## Test the extent of the cause

Search for the same faulty assumption in related entry points, producers, consumers, and alternate representations. Choose cases based on the mechanism, not an exhaustive combination of inputs.

A useful comparison includes the reported failure, a sibling case that a narrow symptom fix would miss, and a legitimate case that must keep working. For ordering or concurrency bugs, vary the relevant event order and retry boundary.

List affected paths as checked, changed, or unverified with a reason. External consumers and old persisted records may need compatibility work even if local callers compile.

## Change and verify in units

For a change spanning modules, name the contract each edit restores. Order edits around a runnable checkpoint, such as one boundary test plus its consumers. Keep unrelated architecture work separate.

After each unit, run its failing case and affected consumer checks. At completion, run the original entry point end to end and inspect side effects separately. A helper test alone cannot prove that every caller reaches the corrected helper.
