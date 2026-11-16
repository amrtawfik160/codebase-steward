# Turn corrections into checks

A correction can be local, conditional, or general. Preserve that scope: “this effect is unnecessary” is not “ban all effects”

## Choose the strongest economical prevention

1. **Design:** remove the invalid state or make the unsafe API inaccessible
2. **Types:** reject bad states or confused identifiers at compilation
3. **Existing lint or build checks:** catch invalid imports or banned constructs with the repo's actual parser and configuration
4. **Behavior tests:** observe the contract and its failure modes through a stable interface
5. **Literal guard:** catch a narrow, explicit forbidden token when a semantic rule is unnecessary or unavailable
6. **Documentation:** retain rationale that still needs judgment; do not treat prose as enforcement

Use the repo's current tooling first. A new dependency or parallel policy system needs a concrete advantage

## Prove the prevention

- Find a real instance of the mistake or create a minimal broken fixture
- Watch the proposed check fail for the intended reason
- Apply the correction and watch it pass
- Make a behavior-preserving internal change and confirm the test is not unnecessarily pinned to implementation
- Give the failure message a useful replacement or next step

Do not weaken tests, blanket-disable a rule, or silently exclude the offending files to produce a green result. Existing violations need an explicit cleanup or staged-adoption plan

## Optional literal guard

The bundled `scripts/guard.mjs` reads `.steward.json` in the target repository. See [the tool reference](../docs/tools.md) for the command and supported glob syntax, and [the example configuration](../examples/steward.json) for its exact shape

Use it for narrowly forbidden legacy import strings, endpoints, or API spellings where matching comments and strings is acceptable. It is not an import resolver, parser, secret detector, or architectural verifier

Rules are chosen for the actual repo. There is no default ban on timers, effects, comments, type casts, or retries. Adding a rule is an authorized repository edit, not part of a read-only review

The tool exits with an error when a rule selects no files or matching files cannot be inspected. A broken scan must not look like successful enforcement. Review configured paths and limitations before adopting it in CI
