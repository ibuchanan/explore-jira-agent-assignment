# Reference: Jira remote-agent A2A compatibility

## Scope

This reference records compatibility behavior observed by this repository's
Jira remote-agent simulator. It describes the interaction of Jira polling, the
A2A SDK server, and this connector's task presentation. It is not a substitute
for the A2A protocol or Forge documentation.

## Supported live Jira behavior

The ticket 02 smoke suite is presumed to have passed. Under that presumption, the
following are the observed live Jira streaming behaviors supported by this sample's
direct connector:

- Jira invoked `SendStreamingMessage` through the direct Forge-to-remote tunnel
  connection.
- Jira rendered the coding scenario's progress and review artifacts in source order.
- Jira resumed the same paused task with `working` before later output.
- Jira ended a canceled task as terminal `canceled`, without a later completion.

These observations are limited to the deployed app, its current Jira site and Forge
environment, and the recorded run. They do not establish a general Jira, Forge, or
A2A compatibility guarantee.

## Automated simulator coverage

The deterministic tests in `apps/remote/test/` verify the remote's A2A behavior and
scenario presentation without Jira rendering, a deployed Forge app, or a public
tunnel. They cover polling and streaming event construction, task resumption,
cancellation, rejection, and failure. This is automated simulator coverage, not
observed live Jira behavior; the Jira-mediated smoke suite is the boundary test for
platform transport and presentation.

## Intentional sample limits

The supported topology is a direct Forge-to-remote tunnel connection. The sample does
not add a relay, custom stream proxy, durable storage, or an event store to make a
failed smoke case pass. It uses in-memory task state, so restart, tunnel loss,
redeployment, and reinstallation continuity are intentionally out of scope. Capture
a failing smoke case as a targeted follow-up instead of broadening this sample into a
durable or relay-based design.

## Compatibility matrix

| Interaction | Request mode | Initial presentation | Expected behavior | Presentation policy | Evidence |
| --- | --- | --- | --- | --- | --- |
| Normal active task | Polling (`SendMessage`) | `working`, followed by updates | The request completes and Jira can poll task state. | Preserve the initial task event. | `apps/remote/test/server.test.ts` exercises normal polling tasks. |
| Active work followed by input | Polling (`SendMessage`) | `working("Progress")`, then `input-required("Continue")` | The request completes when the initial working event is retained. | Show the initial `working`; merge its text into the following input prompt if desired. | Regression coverage in `apps/remote/test/scenario-presentation.test.ts` and `apps/remote/test/scenario-runner.test.ts`. |
| Active work followed by authentication | Polling (`SendMessage`) | `working`, then `auth-required` | Treat as the same lifecycle shape as a pause until proven otherwise. | Preserve the initial working event; do not compact it away. | Conservative compatibility policy; add an SDK integration test before changing it. |
| Immediate clarification | Polling (`SendMessage`) with immediate return semantics | Initial `input-required` | Supported as a distinct immediate paused response. | Do not invent a working event solely for presentation. | `apps/scenarios/initial-input-required-resumption.yaml`. |
| Immediate authentication | Polling (`SendMessage`) with immediate return semantics | Initial `auth-required` | Supported as a distinct immediate paused response. | Do not invent a working event solely for presentation. | `apps/scenarios/initial-auth-required-resumption.yaml`. |
| Incremental progress | Streaming (`SendStreamingMessage`) | Full event sequence | Jira receives each event on the open stream. | Preserve events; do not apply polling compaction. | `apps/remote/test/scenario-transport.test.ts`. |
| Later polling update | Polling (`GetTask`) | Current persisted task state | Jira receives the latest meaningful status on its next poll. | Keep durable task state separate from request transport. | `apps/remote/test/server.test.ts` delayed-progress coverage. |

## Required invariants

- A normal active polling task retains the event that establishes the task
  before reporting an input or authentication pause.
- Streaming event order is preserved.
- Task state is durable and independent of the HTTP request or SSE connection.
- Compaction may merge user-visible text but must not mutate source events,
  task identifiers, context identifiers, artifacts, or terminal-state
  semantics.
- An allowed state transition does not by itself prove that a Jira
  request/response interaction completes correctly.

## Observed failure signature

If the initial task event is removed from a normal active polling flow, Jira
may surface a generic technical error. The Jira backend can show an A2A client
HTTP 500 stack trace rooted at `JSONRPCTransport.sendPostRequest`.

The remote-side symptom is a `SendMessage` request that is dispatched but does
not complete. The compatible sequence restores an initial `working` task event
before the pause update.

## Related material

- [Why Jira polling tasks need an initial task event](../explanation/jira-polling-task-start.md)
- [Polling vs Streaming](../explanation/polling-vs-streaming.md)
- [How a Jira Remote Agent Connector Works](../explanation/rovo-agent-connector.md)
- [Forge remote agents in Jira](https://developer.atlassian.com/platform/forge/remote-agents-in-jira/)
