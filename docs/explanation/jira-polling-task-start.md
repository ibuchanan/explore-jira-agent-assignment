# Why Jira polling tasks need an initial task event

Jira remote agents can make a polling response easier to read by combining a
brief progress message with the next user prompt. That presentation choice has
a lifecycle constraint: a normal polling message send must still establish the
task before it reports a pause.

This repository originally tried to convert an initial pair such as:

```text
working("Progress")
input-required("Continue")
```

into one visible event:

```text
input-required("Progress\n\nContinue")
```

The result looked reasonable as a state transition, but it removed the initial
task event. In the Jira polling flow exercised by this connector, the A2A SDK
then did not complete the `SendMessage` HTTP request. Jira eventually reported
the remote request as a technical error.

The compatible presentation keeps the initial task event and combines the text
in the following pause update:

```text
working("Progress")
input-required("Progress\n\nContinue")
```

This makes the task lifecycle visible to the transport while keeping the
user-facing prompt concise.

## A state machine is necessary but insufficient

The `working → input-required` transition is valid. The defect was not an
invalid task state; it was a request/response interaction caused by removing
the event that established the task for a normal polling send.

An initial `input-required` task is not categorically invalid. This simulator
supports an explicit immediate-return scenario for that case. It should be
treated as a different interaction from an active task whose first progress
event was compacted away.

The practical rule is therefore narrower than “always start with working”:

> When a normal Jira polling task has active work followed by a pause, do not
> project away its initial task/progress event.

## Transport changes presentation, not lifecycle ownership

Streaming preserves every event because Jira receives updates over the
connection it opened. Polling reports the latest meaningful task state when
Jira asks for it, so compaction can be useful. Neither transport removes the
need for an authoritative task lifecycle.

In particular, presentation code should not be allowed to turn an active task
sequence into a sequence that the request handler cannot complete. That makes
transport-aware projection a compatibility policy, not merely a text-formatting
optimization.

## Where the policy belongs

The scenario simulator applies the rule in its local presentation layer. A
reusable Forge Remote helper can encode the same Jira/Rovo policy as a pure
transformation or validator, while leaving task storage, A2A SDK orchestration,
and HTTP/SSE delivery to the consuming service.

See [Jira remote-agent A2A compatibility](../reference/jira-remote-agent-a2a-compatibility.md)
for the supported interaction matrix and [Polling vs Streaming](polling-vs-streaming.md)
for the broader delivery-model discussion.
