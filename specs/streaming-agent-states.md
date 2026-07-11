# Streaming Agent States and Thinking

## Overview
The reference implementation must stream remote-agent state and content updates, mapping provider-specific Remote Agent Signals to A2A (Agent-to-Agent) task updates in real time.

## Description
The application needs to support streaming of remote-agent execution state and content from the implementing Remote Agent to the UI via A2A events. This allows users to observe safe progress summaries as work unfolds, while allowing implementations to optionally expose raw internal thinking when they explicitly support that capability.

The Reference Implementation should demonstrate this behavior with an A2A Simulator: a deterministic scenario runner that emits A2A-compatible task, status, message, and artifact updates without requiring a real agent backend. A Simulated Coding Remote Agent should be one scenario set for the simulator, not the simulator's whole scope.

Simulation behavior should be data-driven by human-readable, editable YAML Simulation Scenarios. Scenario YAML should use explicit A2A-oriented fields such as `event`, `state`, `final`, `message`, and `artifact`, with small conveniences such as `delayMs` and `waitForUserInput`. `waitForUserInput` is not restricted to happy-path-valid states because unusual combinations can be useful client test cases. Scenario Matching should choose a scenario deterministically from the starting task text or context using ordered, case-insensitive `contains` phrase rules, so implementers can create their own demonstration and test flows without changing TypeScript control flow.

Scenario validation should catch malformed YAML, missing required structural fields, and obvious typos, but it should not block scenarios solely for A2A or Jira semantic non-compliance. Use `400` Problem Details for malformed scenario structure that prevents execution. Log non-blocking `422` Compliance Warnings when a structurally valid scenario appears semantically non-compliant with A2A or Jira remote-agent expectations. Compliance Warnings use the project's Problem Details fields (`type`, `title`, `status`, `detail`, `timestamp`, and optional `instance`) but are logs, not response errors or simulated A2A stream events. The `type` field should point to a real public specification URL where possible, such as the A2A specification or Atlassian's Jira remote-agent guide. Use coarse-grained URLs for broad warnings and specific anchors for fine-grained warnings. Scenario authors may intentionally model unusual or invalid A2A streams to test clients.

The A2A Simulator should initially live inside `apps/remote`. Scenario files should live under `apps/remote/scenarios/`. The initial scenario set should contain one happy-path scenario that shows as many useful A2A states and stream event types as possible while still remaining a coherent successful flow. That happy path should include one recoverable `auth-required` pause, such as approval before pushing a branch or opening a pull request. For the first pass, any subsequent user input to the same task should be treated as approval, then the task resumes to `working` and completes. The simulator can be extracted into a shared package after the API is proven and a second consumer exists.

## Key Requirements

### Transport Behavior
Transport behavior defines how Jira and the Reference Implementation exchange A2A payloads. It is separate from how Remote Agent Signals are interpreted.

- **Wire encoding**: Carry non-artifact Content Updates in `TaskStatusUpdateEvent.message`; carry Artifacts in `TaskArtifactUpdateEvent`.
- **Start state by transport**: Streaming `message/send` begins with `working` after the Remote Agent accepts the task, or an immediate interrupted/terminal state if the task cannot start. Polling/non-streaming `message/send` may create `submitted` and then transition to `working`, matching the current Reference Implementation.
- **Stream recovery**: Follow Jira's existing `tasks/resubscribe` behavior without introducing a custom event-store or cursor contract.
- **Reference visibility**: The Reference Implementation shows and logs all streamed content it supports, including Internal Thinking. Additional logs are ordinary diagnostics for request handling, runtime behavior, and A2A mapping decisions, not a second event stream or a normative logging recommendation for all Remote Agents.
- **Cancellation ordering**: Do not emit terminal `canceled` until the Remote Agent runtime has acknowledged stop or the integration has force-stopped or abandoned the task. While cancellation is in progress, keep the prior state where possible and use status/message content such as "Canceling..." if useful.
- **Resumption event ordering**: After `input-required` or `auth-required`, emit a `working` Task State Update before additional Content Updates or Artifact updates.

### State And Content Mapping
State and content mapping defines how Remote Agent Signals become A2A task states, messages, and artifacts.

- **Task State Updates**: Emit lifecycle updates when the task enters or remains in an A2A task state such as `working`, `completed`, `failed`, `rejected`, `input-required`, or `auth-required`.
- **Content Updates**: Stream safe Thinking Process summaries, optional Internal Thinking, Tool Activity, Approval Requests, and other incremental content without implying a task lifecycle transition.
- **Internal Thinking format**: In the Reference Implementation, Internal Thinking can be streamed as plain text in `TaskStatusUpdateEvent.message`; no extra message-part schema is required by this sample.
- **Internal Thinking label**: Label Internal Thinking visibly in message text. Example labels such as `Internal thinking:` are illustrative, not required protocol strings.
- **Thinking Process display**: Leave Thinking Process summaries as ordinary progress messages without a required label.
- **Thinking separation**: Stream Thinking Process summaries and Internal Thinking as separate status messages when both are available.
- **Tool Activity**: Map tool invocations and tool results as status/message content unless the result is intended as a Jira/user-reviewable task output.
- **Tool Activity label**: Label Tool Activity messages lightly in text. Example labels such as `Tool:` and `Tool result:` are illustrative, not required protocol strings.
- **Artifact updates**: Stream anything intended as a Jira/user-reviewable task output as an A2A Artifact via `TaskArtifactUpdateEvent`.
- **Chunked artifacts**: Support A2A incremental artifact updates using `append` and `lastChunk` when useful; the Reference Implementation may emit complete artifacts for simpler outputs.
- **Artifact kind metadata**: When useful, include a conventional Artifact Kind value in artifact metadata; use artifact `name` and `description` for display text. The Reference Implementation does not define a required metadata key schema.
- **Artifact examples, not schemas**: Patch, pull request, test report, and implementation summary examples are illustrative. The Reference Implementation does not define a full artifact schema standard.
- **Completion summary**: Send a brief final `completed` status message for lifecycle closure and an Artifact for the reviewable implementation summary.
- **Failure details**: Send a `failed` status message for lifecycle failure and emit an Artifact only when there is reviewable diagnostic output worth preserving.
- **Terminal states**: Properly identify and emit final A2A states (`completed`, `failed`, `canceled`, or `rejected`) when task execution is finished.
- **Failure vs rejection**: Use `rejected` for tasks the Remote Agent refuses or cannot accept before execution; use `failed` for unrecoverable problems after execution begins.
- **Cancellation**: Use `canceled` when Jira or the user requests cancellation and the task stops because of that request, even if the Remote Agent runtime reports an internal termination.
- **Unknown state**: Treat `unknown` as an exceptional fallback for externally observed, missing, or invalid state. Do not intentionally emit `unknown` during normal execution.
- **Interrupted states**: Use formal A2A states such as `input-required` and `auth-required` for tasks that require user input or authorization before continuing.
- **Input vs authorization**: Use `input-required` for user decisions or clarifications about the work; use `auth-required` for permission grants or privileged capability approvals.
- **Approval Request label**: Label Approval Request messages clearly in text. Example labels such as `Approval required:` are illustrative, not required protocol strings.
- **Input Need label**: Label Input Need messages clearly in text. Example labels such as `Input required:` are illustrative, not required protocol strings.
- **Same-task resumption**: When the user supplies missing input or authorization, resume the same task by returning to `working`.
- **Artifact continuity**: Artifacts emitted before an interruption or cancellation remain attached to the same task.

### Supported Remote Agent Signals
- Runtime started/running signal -> Task State Update with `working`
- Thinking Process signal -> `TaskStatusUpdateEvent.message` with safe progress summary
- Internal Thinking signal -> plain text in `TaskStatusUpdateEvent.message` when the Remote Agent supports raw internal thinking
- Model request start/end signal -> `TaskStatusUpdateEvent.message` describing execution progress
- Tool use/result signal -> Tool Activity in `TaskStatusUpdateEvent.message`, with `TaskArtifactUpdateEvent` when the result is intended as a task output
- Runtime idle/completion signal -> Executor evaluates the whole task outcome before emitting a final or interrupted A2A state
- Runtime error signal -> Error handling with conditional finality based on whether the task can continue
- Runtime terminated signal -> Task State Update with `failed` when execution cannot continue

### Provider-Neutral Mapping Table
Use this table as an implementation guide. Each Remote Agent maps its provider-specific runtime events into these categories before emitting A2A events.

| Remote Agent Signal category | Example scenario | A2A wire event | State/content behavior | Final |
| --- | --- | --- | --- | --- |
| Runtime started/running | A Jira user assigns a work item to a Coding Remote Agent to update a repository. The runtime accepts the task. | `TaskStatusUpdateEvent` | Report `working` and include a short start message if useful. | `false` |
| Thinking Process emitted | The agent reports "Inspecting the repository and locating the code paths related to the work item." | `TaskStatusUpdateEvent.message` | Stream a safe user-visible progress summary. | `false` |
| Internal Thinking emitted | The runtime exposes raw reasoning while choosing an implementation approach for the code change. | `TaskStatusUpdateEvent.message` | Stream raw internal thinking in the Reference Implementation when the Remote Agent supports it. | `false` |
| Model request started/ended | The agent starts or finishes a model call to plan the edit or explain a failing test. | `TaskStatusUpdateEvent.message` | Stream execution progress, latency, or phase information when useful. | `false` |
| Tool use emitted | The agent reads files, searches the repository, applies a patch, or runs tests. | `TaskStatusUpdateEvent.message` | Stream Tool Activity describing the invocation. | `false` |
| Tool result emitted | The repository search finds the relevant module, the patch applies, or the test command returns failures. | `TaskStatusUpdateEvent.message` | Stream Tool Activity describing the result unless the result is intended as a Jira/user-reviewable task output. | `false` |
| Artifact produced | The agent produces a patch, branch link, pull request link, test report, or implementation summary that Jira can render or reference later. | `TaskArtifactUpdateEvent` | Stream the Artifact with enough metadata for rendering, persistence, or later reference. | `false` unless it is also the terminal update |
| Tool Approval needed | The agent needs permission before pushing a branch, opening a pull request, or calling a write-capable external tool. | `TaskStatusUpdateEvent` plus `message` | Set/report `auth-required` and include an Approval Request. | `false` |
| Recoverable repository authorization needed | The agent lacks repository access, but user authorization can grant access and allow the task to continue. | `TaskStatusUpdateEvent` plus `message` | Set/report `auth-required` and include an Approval Request. | `false` |
| User input needed | The agent cannot continue until the user clarifies the target repository, branch, acceptance criteria, or ambiguous work item requirement. | `TaskStatusUpdateEvent` plus `message` | Set/report `input-required` and include the prompt or requested fields. | `false` |
| Resumed after user response | The user grants repository access or clarifies the target branch, and the Coding Remote Agent continues work. | `TaskStatusUpdateEvent` | Set/report `working` before additional Content Updates or Artifact updates. | `false` |
| Runtime completed | The agent has made the code change, run the relevant checks, and emitted any final patch, PR, test report, or summary artifacts. | `TaskStatusUpdateEvent` | Set/report `completed` with a brief lifecycle summary. Reviewable implementation details belong in an Artifact. | `true` |
| Task canceled | The user or Jira cancels the task while the Coding Remote Agent is working. | `TaskStatusUpdateEvent` | Set/report `canceled` when the task stops because of the cancellation request. Artifacts already emitted remain attached to the task. | `true` |
| Task rejected | The Remote Agent refuses the task because it is unsupported, invalid, or cannot be accepted and no recoverable authorization path exists. | `TaskStatusUpdateEvent` | Set/report `rejected` before execution begins. | `true` |
| Runtime failed | The runtime loses required repository access after accepting the task and cannot recover through authorization, cannot apply the patch, or hits another unrecoverable execution error. | `TaskStatusUpdateEvent` | Set/report `failed`. Emit an Artifact only for reviewable diagnostic output such as a test report, unapplied patch, or structured failure analysis. | `true` |

### State Mapping
- `submitted` - Task has been created but not yet accepted for active execution; used for creation/polling flows rather than the normal first streaming state
- `working` - Remote Agent is actively processing
- `completed` - Remote Agent finished successfully
- `failed` - Remote Agent encountered a fatal error
- `rejected` - Remote Agent rejected the task
- `input-required` - Remote Agent needs user input before continuing
- `auth-required` - Remote Agent needs user authorization before continuing, including Tool Approval
- `unknown` - Exceptional fallback for externally observed, missing, or invalid state; not intentionally emitted during normal execution

## Success Criteria

### Transport Criteria
- [x] Non-artifact Content Updates use `TaskStatusUpdateEvent.message`
- [x] Anything intended as a Jira/user-reviewable task output uses `TaskArtifactUpdateEvent`
- [x] Artifact updates support complete artifacts and can support incremental chunks with `append` and `lastChunk`
- [x] Artifacts can include conventional kind metadata such as `patch`, `pull-request`, `test-report`, or `implementation-summary` when useful
- [x] Artifact examples remain illustrative and do not define required schemas
- [x] Streaming `message/send` starts with `working` after task acceptance, not `submitted`
- [x] Polling/non-streaming `message/send` may create `submitted` then transition to `working`
- [x] `tasks/resubscribe` follows Jira's existing behavior and does not require a custom event store or replay cursor
- [x] No events are lost or duplicated within a live stream or Jira-supported resubscribe flow
- [x] Reference Implementation logs make streamed behavior visible to implementers
- [x] Resumption emits a `working` Task State Update before additional content or artifacts
- [x] Terminal `canceled` is emitted only after the runtime stops or the integration force-stops/abandons the task
- [x] "Canceling..." is message content and does not imply a transition to `working` or a custom canceling state

### Simulation Criteria
- [x] A2A Simulator behavior is driven by human-readable, editable YAML Simulation Scenarios
- [x] A2A Simulator initially lives inside `apps/remote`
- [x] Scenario YAML files live under `apps/remote/scenarios/`
- [x] Initial scenario set contains one happy-path scenario
- [x] Initial happy-path scenario includes one recoverable `auth-required` pause and resumes to `working`
- [x] First-pass auth-required resumption treats any subsequent user input to the same task as approval
- [x] Scenario YAML uses explicit A2A-oriented fields rather than a separate simulation DSL
- [x] Scenario YAML supports `waitForUserInput` on explicit A2A steps without restricting it to happy-path-valid states
- [x] Scenario validation catches malformed files and missing required structure without forbidding semantically unusual A2A streams
- [x] Simulator logs non-blocking Compliance Warnings in the project's Problem Details format for likely A2A or Jira remote-agent non-compliance
- [x] Malformed scenario structure uses `400`; semantic non-compliance warnings use `422`
- [x] Compliance Warning `type` values point to public specification URLs where possible (currently only A2A specification URLs are used — see gaps below)
- [x] Compliance Warnings are logged only and are not injected into the simulated A2A stream
- [x] Simulated Coding Remote Agent is implemented as one scenario set for the general A2A Simulator
- [x] Scenario Matching chooses a scenario deterministically with ordered, case-insensitive `contains` phrase rules
- [x] A Default Scenario runs when no scenario matches the starting task text or context
- [x] Implementers can add or edit scenarios for demonstrations and tests without changing TypeScript control flow

### Mapping Criteria
- [x] Remote Agent Signals are captured and mapped to A2A events
- [x] State transitions follow the documented event mapping table
- [x] Thinking Process summaries are streamed to users in real time
- [x] Internal Thinking is streamed by the Reference Implementation when supported by the Remote Agent
- [x] Internal Thinking uses plain text status message content; no extra sample-specific schema is required
- [x] Internal Thinking status messages are visibly labeled in text
- [x] Thinking Process summaries and Internal Thinking are not coalesced into the same status message when both are available
- [x] Thinking Process summaries are ordinary progress messages and do not require a label
- [x] Tool invocations and results are properly sequenced
- [x] Tool Activity messages are visibly labeled in text
- [x] Final completion sends a brief `completed` status message and a reviewable summary Artifact when summary details are needed
- [x] Failure sends a `failed` status message and only emits diagnostic Artifacts when there is reviewable output to preserve
- [x] Tool Approval is represented with `auth-required` plus an Approval Request Content Update
- [x] Approval Request messages are visibly labeled in text
- [x] User clarifications use `input-required`; permission grants and privileged approvals use `auth-required`
- [x] Input Need messages are visibly labeled in text
- [x] User responses to `input-required` or `auth-required` resume the same task to `working`
- [x] Artifacts emitted before an interruption or cancellation remain attached to the same task
- [x] Terminal states are correctly identified
- [x] `rejected` is reserved for pre-execution refusal and `failed` is used for unrecoverable execution problems
- [x] User/Jira-requested cancellation ends with `canceled`, not `failed`
- [x] `unknown` is not emitted during normal execution
- [x] Missing repository access uses `auth-required` when recoverable, `rejected` before acceptance when not recoverable, and `failed` after acceptance when not recoverable

## Current Implementation Gaps

The remote app now demonstrates the full target streaming behavior described in this spec: Tool Activity, Thinking Process, Internal Thinking, and Approval Requests are modeled as Content Updates; `completed` and `failed` outcomes can carry reviewable Artifacts (chunked patches, an implementation summary, an unpushed-fix diagnostic); `tasks/resubscribe` continues a matched scenario from where it left off instead of replaying it; and cancellation coordinates a simulated runtime stop before terminal `canceled`. All of the above is covered by `apps/remote/tests/`.

The following gaps remain, deliberately out of scope for the current pass:

- **Scenario Matching is starting-task-text only.** The glossary and this spec describe matching "from the starting task text or context," but `matchScenario` only inspects the joined text parts (`apps/remote/src/scenarios.ts`) — it does not consider other context fields such as `workItemId` extracted from the message's data part. Scenarios can only be triggered by phrases appearing in the message text today.
- **No scenario models an interruption at initial acceptance.** Every `auth-required`/`input-required` scenario currently pauses mid-execution, after an initial `working` step. No scenario demonstrates the case where a task needs authorization or clarification as its very first streamed state (an immediate interrupted state is only demonstrated for `rejected`, in `immediate-rejection.yaml`).
- **Compliance Warning `type` URLs only reference the A2A specification.** No current validation path points a Compliance Warning at the Jira remote-agent guide, since the semantic checks implemented so far (`checkComplianceWarnings`) only cover A2A-level concerns (unrecognized task states and event kinds).
- **No manual/local demo path for the streaming route.** `/a2a/json-rpc` requires a real, cryptographically verified Forge Invocation Token (see `apps/remote/src/auth.ts`), so a bare `curl` cannot exercise the streaming Simulator the way the retired demo scripts once did for the unauthenticated `/tasks/:taskId/advance` endpoint. The supported ways to exercise a Simulation Scenario are the automated test suite (`npm test` in `apps/remote`) or a real Jira-mediated request through a deployed, installed Forge app.
- Broader production-readiness gaps (durable storage, tenant mapping, observability, etc.) are tracked in the "Production gaps" and "Production considerations" sections of the READMEs rather than duplicated here, since they apply to the sample generally and are not specific to this streaming spec.

## References
- Event mapping tables in requirements document
- A2A (Agent-to-Agent) protocol documentation: https://a2a-protocol.org/latest/specification/
- Jira remote-agent documentation: https://developer.atlassian.com/platform/forge/remote-agents-in-jira/
