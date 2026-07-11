# Simulation Scenarios

This directory holds the A2A Simulator's Simulation Scenarios: human-readable,
editable YAML files that drive the streamed behavior of a simulated task. You
can add, edit, or remove scenarios here to create new demonstrations or test
cases without changing any TypeScript control flow — the simulator (see
`../src/scenarios.ts` for loading/matching, `../src/scenarioStepMapper.ts` for
step-to-event mapping, and `../src/scenarioSession.ts` for playback policy)
only interprets the scenario data, it never branches on a scenario's identity.

Restart the remote service (`npm run dev:remote`) after editing a `.yaml` file
here; scenarios are loaded once at startup.

Try it hands-on: [Tutorial: Edit a Simulation Scenario](../../../docs/tutorials/edit-a-simulation-scenario.md)
walks through editing a step here and watching an automated check react to it.

Related background:

- Vocabulary: [`CONTEXT.md`](../../../CONTEXT.md) — see *A2A Simulator*,
  *Simulation Scenario*, *Simulation Scenario Session*, *Scenario Matching*,
  *Default Scenario*, and *Compliance Warning*
- Spec: [`specs/streaming-agent-states.md`](../../../specs/streaming-agent-states.md)
- Design decisions: [`docs/adr/0033`](../../../docs/adr/0033-simulated-agent-uses-editable-scenarios.md),
  [`docs/adr/0037`](../../../docs/adr/0037-scenario-validation-is-structural-not-semantic.md),
  [`docs/adr/0038`](../../../docs/adr/0038-compliance-warnings-use-problem-details.md),
  [`docs/adr/0039`](../../../docs/adr/0039-simulation-scenario-sessions-use-sans-io-core.md)

## How a scenario is chosen

When a streaming `message/send` request starts a task, the simulator joins
the starting message's text parts and checks each scenario's `match.contains`
phrases against that text, case-insensitively, **in the order the scenario
files are loaded** (files are loaded alphabetically by filename). The first
scenario with a matching phrase wins — so if two scenarios could both match
the same task text, whichever file sorts first takes precedence.

If no scenario's rules match, the simulator falls back to the **Default
Scenario**: the one scenario file with `default: true`. Exactly one file
should set `default: true`; if none does, matching throws rather than
silently rejecting the task.

## Scenario file shape

```yaml
id: my-new-scenario          # required, unique, used for logs and resumption lookups
default: false                # optional; true marks this the Default Scenario
match:
  contains:                   # optional; omit entirely on the Default Scenario
    - "some phrase to match"
    - "another phrase"
steps:                        # required, non-empty, played back in order
  - event: status-update
    state: working
    message: "Starting work on this task."
  - event: status-update
    message: "Looking into the details..."
    delayMs: 20
  - event: status-update
    state: completed
    message: "Finished the task."
    final: true
    delayMs: 20
```

### Step fields

Each entry in `steps` is played back in order, after waiting `delayMs`
milliseconds (default `0`). A step is one of two `event` kinds:

| Field | Applies to | Meaning |
| --- | --- | --- |
| `event` | all steps | `status-update` or `artifact-update` |
| `state` | `status-update` | An A2A task state (see below). Omit it for a step that only carries content, with no lifecycle change. |
| `message` | `status-update` | The text streamed to the user for this step. |
| `final` | `status-update` | `true` marks this step as the terminal event; the stream ends here. |
| `waitForUserInput` | `status-update` | `true` pauses the stream after this step. Playback only continues when the same task receives a follow-up `message/send` (see *Same-task resumption* in the spec) — any follow-up input is treated as approval/clarification in this first pass. |
| `artifact` | `artifact-update` | The artifact payload: `artifactId`, `name`, `description`, `metadata.kind`, and `parts`. |
| `append` | `artifact-update` | `true` appends this chunk's parts to a previously streamed chunk with the same `artifactId`, instead of replacing it. |
| `lastChunk` | `artifact-update` | `true` marks this chunk as the final one for a chunked artifact. |
| `delayMs` | all steps | Delay, in milliseconds, before this step is emitted. |

A `status-update` step with no `state` becomes a Content Update (safe
progress text, Internal Thinking, or Tool Activity — label it in `message`
text, e.g. `Internal thinking:` or `Tool:`, by convention only). A
`status-update` step with a `state` becomes a Task State Update.

### A2A task states

Use one of: `submitted`, `working`, `input-required`, `auth-required`,
`completed`, `rejected`, `canceled`, `failed`, `unknown`. `working` should
normally be the first state a streaming scenario reaches (or an immediate
interrupted/terminal state, such as `rejected`, if the task cannot start).
`completed`, `failed`, `rejected`, and `canceled` are terminal — always pair
them with `final: true`.

## Validation vs Compliance Warnings

Scenario loading is **structurally** validated: malformed YAML, a missing or
empty `id`, or a missing/empty `steps` array all fail to load with a `400`
Problem Details error, and the service refuses to start.

Loading does **not** reject a structurally valid scenario for using an
unrecognized `state` or `event` value. Instead it logs a non-blocking `422`
Compliance Warning (`checkComplianceWarnings` in `../src/scenarios.ts`) so you
can see likely A2A non-compliance without being blocked from intentionally
authoring an unusual or invalid stream to test a client's handling of it.

## Adding a new scenario

1. Create a new `.yaml` file in this directory (filename only affects match
   order relative to other scenarios — it is not otherwise significant).
2. Give it a unique `id` and a `match.contains` list of phrases you expect to
   appear in a task's starting text (e.g. in a Jira work item summary).
3. Write your `steps`, referencing the field table above. Copy an existing
   scenario as a starting point — `coding-agent-happy-path.yaml` shows
   Thinking Process, Internal Thinking, Tool Activity, and chunked/complete
   Artifacts together; `auth-required-approval-resumption.yaml` and
   `input-required-clarification-resumption.yaml` show a pause and
   resumption.
4. Restart the remote service and send a message whose text contains one of
   your `match.contains` phrases (see the repository-root README for how to
   run the service, or drive it through the automated tests below).

No TypeScript changes are required for any of this.

## Exercising scenarios

There's no manual demo script for this anymore — the fastest way to see a
scenario stream is to read or extend the automated tests, which drive the
real `/a2a/json-rpc` streaming endpoint end-to-end:

```bash
npm test
```

See `../tests/a2a-json-rpc.test.ts` for streaming request/response examples
against every scenario in this directory, `../tests/scenarios.test.ts` for
loading/matching/Compliance Warning behavior, `../tests/scenarioStepMapper.test.ts`
for step-to-event mapping, and `../tests/scenarioSession.test.ts` for playback
and resumption policy.

## Current scenarios

| File | Demonstrates |
| --- | --- |
| `default-happy-path.yaml` | The Default Scenario: a small generic happy path used when nothing else matches. |
| `coding-agent-happy-path.yaml` | A full Simulated Coding Remote Agent run: Thinking Process, Internal Thinking, Tool Activity, a chunked patch Artifact, and a completed implementation-summary Artifact. |
| `auth-required-approval-resumption.yaml` | A Tool Approval pause (`auth-required`) mid-task, then resumption to `working` and completion. |
| `input-required-clarification-resumption.yaml` | An Input Need pause (`input-required`) mid-task, then resumption to `working` and completion. |
| `cancellation-during-work.yaml` | A task with a streamed Artifact that is canceled mid-work; the A2A Simulator's `tasks/cancel` handling ends the stream with `canceled` rather than this scenario's own `completed` step. |
| `repository-access-revoked-failure.yaml` | An unrecoverable failure after acceptance (`failed`), with a diagnostic unpushed-patch Artifact preserved for manual follow-up. |
| `repository-access-unavailable-rejection.yaml` | A pre-execution refusal (`rejected`) because no recoverable access path exists. |
| `immediate-rejection.yaml` | The minimal shape of a scenario that never reaches `working` at all. |
