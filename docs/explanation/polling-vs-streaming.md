# Polling vs Streaming for Jira Remote Agents

A Jira remote agent can report work in two different ways.
With **polling**,
Jira periodically asks the agent
for the current state of an active task.
With **streaming**,
Jira opens a Server-Sent Events (SSE) connection
and the agent emits progress as it occurs.
Both approaches describe the same task lifecycle;
they differ in how Jira learns about changes.

The distinction is about delivery, not capability.
A task can be created,
progress through working or waiting states,
and reach a terminal result with either model.
The question is whether the user benefits f
rom seeing changes at the cadence of Jira's checks
or as individual changes are produced.

## Polling is the default task model

Polling makes Jira the party
that decides when to request an update.
After a user delegates work,
the remote service returns a task
and stores enough state to answer later requests about it.
While the task remains active,
Jira calls `GetTask`;
the service responds with its current task state
and any meaningful status message.

This model suits work
whose meaningful progress is naturally coarse grained:
waiting for a job,
checking an external system,
executing a deployment,
or performing work
that only has a few useful milestones.
It also gives the remote service simple connection semantics:
each request is independent,
and a lost request
does not imply a long-lived client connection needs to be restored.

Polling does not mean an agent is silent.
A later task response can report
that work has moved from submitted to working,
ask for input,
request authentication,
or report completion.
It means that intermediate updates become visible
when Jira next asks for the task
rather than at the precise instant the agent creates them.

## Streaming changes the delivery relationship

Streaming is an optional Forge connector capability.
When it is declared,
Jira sends `SendStreamingMessage`
rather than `SendMessage`
and expects an SSE response.
The remote service keeps
that response open
and sends JSON-RPC result objects as events occur.

The stream begins with either a task or a direct message.
For a task,
later events can carry status updates
or incremental artifact updates,
then the connection closes
once the task reaches a terminal state.
This gives an agent a way
to expose output with much finer granularity:
for example,
an evolving analysis,
generated text,
or pieces of a review artifact.

Although an agent produces the events,
streaming is not an unrestricted agent-to-Jira push channel.
Jira initiates the request
and owns the connection used to receive the response.
If that connection drops before the task is terminal,
Jira may use `SubscribeToTask` to establish a new stream.
The agent therefore still needs durable task state:
a new subscriber must be able to begin with the current task state
and continue with subsequent updates.

## The trade-off is between freshness and operational simplicity

| Concern                       | Polling                                                   | Streaming                                                                                                              |
| ----------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| How updates arrive            | Jira periodically requests the latest task state.         | Jira receives events on an SSE response it opened.                                                                     |
| User-visible freshness        | Bounded by Jira's polling cadence.                        | Usually reflects updates as they are emitted.                                                                          |
| Best fit                      | A small number of meaningful milestones.                  | Incremental text, artifacts, or frequent useful progress.                                                              |
| Connection lifecycle          | Short, independent request-response exchanges.            | An open connection must be maintained and recovered after interruption.                                                |
| State needed after disruption | The current task must remain available for the next poll. | The current task must remain available for resubscription; the agent must also handle the continuity of future events. |
| Implementation surface        | Task creation and current-state retrieval.                | Polling responsibilities plus SSE event production and resubscription behavior.                                        |

Streaming can make an agent feel more responsive,
but it cannot make an inherently slow operation complete sooner.
For work that produces no useful intermediate result,
frequent events may add visual noise
and operational complexity
without improving the user's understanding.
Conversely,
polling can make a conversational or generative agent appear stalled
even when it is producing valuable incremental output between checks.

## A task state is more important than a transport

The transport should not be the system of record for work.
In both models,
the agent needs an authoritative task record
that captures its identifier,
current state,
context,
latest meaningful status,
and final artifacts.
Treating an SSE connection as the task itself is fragile:
connections are transient,
whereas a task may need to survive
restarts,
cancellation,
user clarification,
and a later request from Jira.

This separation also clarifies terminal states.
Once a task is completed, failed, canceled, or rejected,
it is finished regardless of whether Jira learned
that through a poll or the final stream event.
A new request in that context
needs a new task rather than reopening the old one.
Streaming affects the experience of observing work,
not the lifecycle rules that govern it.

## Choosing the model is a product decision

Polling is a sound default
when task updates are facts rather than a live narrative.
It favors predictable infrastructure
and avoids keeping a connection open
merely to say that nothing has changed.
Streaming becomes valuable
when each incremental update can
help the user understand, guide, or review work in progress.

That choice can vary by agent,
but should be stable for a connector:
Forge uses the manifest's streaming declaration
to select the request mode.
A connector should therefore advertise streaming
only when its remote service can reliably produce
the required SSE responses
and resubscribe to in-progress tasks.
If it cannot,
polling remains a fully supported model
rather than a degraded fallback.

## Further reading

- [Why Jira polling tasks need an initial task event](jira-polling-task-start.md)
- [Jira remote-agent A2A compatibility](../reference/jira-remote-agent-a2a-compatibility.md)
- [Integrate remote agents with Jira — Streaming (optional)](https://developer.atlassian.com/platform/forge/remote-agents-in-jira/#streaming-optional)
- [Integrate remote agents with Jira — `GetTask`](https://developer.atlassian.com/platform/forge/remote-agents-in-jira/#gettask)
- [How a Jira Remote Agent Connector Works](rovo-agent-connector.md)
