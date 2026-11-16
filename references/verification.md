# Evidence that matches the claim

Choose the cheapest check that directly tests the changed behavior. More checks are not automatically better evidence

## Match the surface

- **Pure logic:** inputs, expected outputs, boundary cases, and error cases through the public function
- **Bug fix:** the original reproduction fails before the change and passes after it
- **UI:** perform the real action, observe the resulting state, and inspect relevant console/network errors. Capture a screenshot or recording when it proves something material
- **Service:** call the real handler or endpoint in a safe environment and verify status, body, and actual downstream side effects separately
- **Persistence:** read back the stored state; a success toast or generated identifier is not proof of a write
- **Concurrency:** test relevant event orders, duplicate events, retries, and cancellation. Consider property-based testing or model checking only when the invariant and risk justify the effort
- **Refactor:** compare behavior before and after, including failure paths. Formatting and type checks alone do not pin behavior

Use isolated local or test data. Never send real messages, charge money, delete production data, or deploy to obtain evidence without authorization

## Test quality

Ask two questions about each new test:

1. Would it fail if the observed behavior broke?
2. Would it still pass if the internals changed without changing that behavior?

Derive expected values from the contract, not by calling the same implementation twice. Mock external boundaries only where necessary. Prefer a small real reproduction over a large test that mainly verifies its own mocks

## If the repo is difficult to drive

Recommend one repeatable launch-and-check command, not a new testing platform by default. It should start an isolated instance, wait for readiness, exercise a real user path, preserve evidence, and stop only what it started

Use existing test runners and browser harnesses where possible. Document missing credentials or environment prerequisites. Never replace an unavailable integration test with a mocked success and call it verified

## Report honestly

For each material claim, give the check, observed result, and limitation

- **Verified:** directly observed the claimed behavior
- **Partially verified:** observed a narrower property; name what remains
- **Blocked:** the intended check could not run; state the missing prerequisite
- **Failed:** the check observed a defect; do not downgrade it to a warning to finish

Keep command output or artifact paths when useful. Report performance numbers only with repeated measurements, variability, and the suspected limiting resource. A model-checker pass applies to its explicit model and bounds, not automatically to the whole application
