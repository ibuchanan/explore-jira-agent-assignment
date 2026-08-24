# Simulation scenarios

This directory contains YAML scenarios for the A2A Simulator. `npm run
remote:start` loads match conditions at startup and reloads the selected
scenario's steps when it creates a new task, so you can edit a scenario
without restarting the local remote. Existing tasks retain the steps selected
at creation; scenario identities and match conditions remain fixed until the
remote restarts.

The remote build copies this directory to `apps/remote/dist/scenarios`. Direct
or deployed runs use that bundled directory unless `SCENARIO_DIRECTORY` selects
another directory.

```bash
npm run remote:start
```

Run the automated remote tests with:

```bash
npm run --workspace=rovo-agent-connector-remote-backend test
```

## Scenario selection

The loader reads files alphabetically and requires exactly one scenario with
`default: true`. For a new task, it selects the first scenario with a matching
rule. Within each scenario, matching checks text, work item, comment, entry
surface, tenant, then invoker identity; any matching rule selects that
scenario. If nothing matches, it uses the default scenario.

Text phrases use case-insensitive substring matching and are intentionally short
(two or three words), so they can be embedded in natural Jira summaries. If
multiple scenarios match, alphabetical filename order determines the winner;
keep trigger phrases distinct.

A resumed task keeps the scenario and steps selected for its original task ID.

## Transport presentation

Scenarios describe canonical A2A states. For a `working` step immediately
followed by a pausing `input-required` step, the simulator preserves both
ordered updates for `SendStreamingMessage`. For `SendMessage`, it combines
both messages into the `input-required` task snapshot so Jira polling can
retrieve the Markdown before the task pauses.

## Scenario shape

```yaml
id: my-scenario
match:
  contains:
    - "phrase in the request"
steps:
  - event: status-update
    state: working
    message: "Starting work."
  - event: status-update
    state: completed
    message: "Finished work."
```

`id` and a non-empty `steps` array are required. `default: true` marks the
fallback scenario. The loader rejects malformed YAML, missing IDs, empty steps,
duplicate IDs, and collections without exactly one default scenario.

## Step fields

| Field | Applies to | Meaning |
| --- | --- | --- |
| `event` | all steps | `status-update`, `artifact-update`, or `jira-callback` |
| `state` | `status-update` | `working`, `completed`, `rejected`, `failed`, `canceled`, `input-required`, `auth-required`, or `unknown` |
| `message` | status and callback steps | Text sent in the agent message |
| `waitForUserInput` | `status-update` | Pauses the task until the same task receives another message |
| `delayMs` | all steps | Delay before the step is played |
| `artifact` | `artifact-update` | Artifact ID, optional metadata, and text parts |
| `append` / `lastChunk` | `artifact-update` | Controls streamed artifact chunks |
| `action` | `jira-callback` | `read`, `comment`, `mention`, or `transition` |
| `result` | `jira-callback` | Simulated outcome: `simulated`, `auth-required`, `rejected`, or `failed` |
| `real` | `jira-callback` | Enables the actual Jira callback only when server-side smoke callbacks are enabled |
| `transitionId` | `jira-callback` | Jira transition ID for a real transition callback |

Unknown events or states are reported as diagnostic compliance warnings during
playback. The bundled scenarios demonstrate normal completion, resumption,
cancellation, failures, Markdown, artifacts, and simulated Jira callbacks.

## Real Jira callbacks

By default, every Jira callback is simulated and does not mutate Jira. A step
can make a real callback only when both `real: true` and the remote's
`ENABLE_REAL_JIRA_CALLBACK_SMOKE_TESTS=true` setting are present. Real callbacks
use the validated Forge Invocation Token context and user token, not identity
values supplied in the scenario request.
