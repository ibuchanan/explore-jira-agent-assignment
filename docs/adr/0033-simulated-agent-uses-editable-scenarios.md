# A2A Simulator Uses Editable YAML Scenarios

The A2A Simulator should be driven by human-readable, editable YAML Simulation Scenarios rather than hardcoded branches. Scenario YAML should use explicit A2A-oriented fields such as `event`, `state`, `final`, `message`, and `artifact`, with small conveniences such as `delayMs` and `waitForUserInput`. `waitForUserInput` is not restricted to happy-path-valid states because unusual combinations can be useful client test cases. Scenario Matching selects a scenario deterministically from the starting task text or context using ordered, case-insensitive `contains` phrase rules, allowing implementers to create their own demonstration and test flows without changing TypeScript control flow.

Post-hoc implementation note: the shipped `matchScenario` currently matches only the joined text parts from the starting message. Structured context is extracted for task and context metadata, but it is not considered by scenario selection yet; keep context-based matching documented as target behavior or an implementation gap until the matcher accepts structured context input.

When no scenario matches, the Reference Implementation runs a Default Scenario instead of rejecting the task. The fallback should be a generic happy path and should be visible in logs or status text.

Scenario validation catches malformed YAML, missing required structural fields, and obvious typos, but does not block scenarios solely for A2A or Jira semantic non-compliance. Instead, the simulator logs non-blocking Compliance Warnings in the project's Problem Details format when a scenario appears non-compliant with A2A or Jira remote-agent expectations. Scenario authors may intentionally model unusual or invalid A2A streams to test clients.
