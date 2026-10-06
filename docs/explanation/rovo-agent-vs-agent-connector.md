# Rovo Agents vs Remote Agent Connectors

Forge offers two different ways to put an agent in front of Jira users.
The `rovo:agent` module defines an agent that **Rovo runs**:
you supply a prompt and a set of `action` modules,
and Rovo's model decides when to call them.
The `rovo:agentConnector` module registers an agent that **you run**:
Jira delegates a task to your remote service over A2A,
and your service reports on that task until it finishes.

Both appear to users as "an agent",
and both can reach a backend through Forge Remote.
That surface similarity is why teams new to Forge
often start with the first module when they need the second.
The difference is not about where the code is hosted.
It is about who owns the reasoning loop
and how long a single unit of work is allowed to live.

## Who owns the reasoning loop

With `rovo:agent`,
the agent's intelligence belongs to Rovo.
The manifest's `prompt` shapes its role and behavior,
and each `action` is a tool that the model may invoke mid-conversation.
An action is described by a verb, a description, and typed inputs
so that the model can decide when to call it and with what.
Your code never sees the conversation as a whole;
it sees individual tool calls
and returns data for the model to interpret.

With `rovo:agentConnector`,
the agent's intelligence belongs to you.
Jira does not run a prompt on your behalf.
It sends your remote a message describing the work
and the Jira context it came from,
and your service decides what to do:
plan, call other systems, run a model of your choice,
ask the user for input,
or produce reviewable artifacts.
Jira's role is to host the experience around that work,
not to decide what the work is.

This is the most useful lens for choosing between them.
If the value is in a prompt plus a few well-defined operations
on Atlassian or external data,
Rovo already provides the loop and `rovo:agent` is the lighter option.
If you already have an agent,
or the value lives in a runtime, model, or toolchain you control,
wrapping it as an action turns your agent
into a tool for someone else's agent.

## Synchronous tool calls vs a task lifecycle

An action is a request and a response.
When the model calls an action,
the conversation turn waits for the result
so the model can use it in its reply.
Whether the action is implemented with a Forge `function`
or with an `endpoint` that forwards to Forge Remote,
the shape is the same:
one invocation, bounded by Forge's
[invocation limits][forge-invocation-limits],
and a result that must arrive before the turn can continue.

That shape is ideal for lookups and short mutations:
fetch a record, create a work item, summarize a payload.
It is a poor fit for work that takes minutes,
such as running a test suite,
generating and validating a change,
or waiting on another system.
Moving the handler from a Forge function to Forge Remote
relocates the compute
but does not change the contract:
the platform still expects an answer
within a single bounded invocation.

The usual workarounds make this visible.
An action can start a background job and return immediately,
then a second action can report the job's status.
But now the user, or the model, must remember to ask again;
progress is only visible when someone asks;
cancellation and clarification have no natural place;
and the final result is paraphrased by the model
rather than presented as the agent produced it.
In effect, the app has to rebuild a task lifecycle
out of parts that were not designed for one.

An agent connector starts from that lifecycle.
Each JSON-RPC request from Jira is still bounded,
but the unit of work is a **task**, not a request.
Your remote answers `SendMessage` promptly with a task in a working state,
keeps doing the work on its own infrastructure,
and reports progress whenever Jira asks with `GetTask`
or, if the connector declares streaming,
as events on an SSE response.
A task can pause for `input-required` or `auth-required`,
be canceled by the user,
and finish with artifacts that Jira renders for review.
The time the work takes is decoupled
from the time any single request takes.

See [Polling vs Streaming](polling-vs-streaming.md)
for how those two delivery models differ.

## Where users meet each agent

The two modules also surface in different places,
which reflects the different kinds of work they assume.

A `rovo:agent` lives where people talk to Rovo:
the Rovo Chat panel in Jira and Confluence,
the `/ai` command in the editors,
and Automation rules that invoke the agent with an extra prompt.
It is conversational first,
and its answers flow back into chat or into later automation steps.

A remote agent registered with `rovo:agentConnector`
lives where people delegate work in Jira:
it can be assigned a work item,
`@mentioned` in a comment,
or chatted with in Rovo Chat.
It behaves more like a teammate that has been handed a job
than an assistant answering a question.
Today the connector targets Jira through its `productContexts`.

## What you take on with each module

The convenience of `rovo:agent` is that Rovo carries most of the weight.
There is no model to host, no conversation state to store,
and no protocol to implement beyond the action handlers.
The trade-off is control:
the model, the loop, and the presentation of results belong to Rovo,
and each action must fit the invocation model described above.

An agent connector moves that weight to you.
The remote service must implement A2A 1.0 JSON-RPC,
validate the Forge Invocation Token on every request,
keep an authoritative task record
that survives restarts and resubscription,
and associate each task with the Jira site it came from.
If it needs to read or change Jira data,
it must request forwarded app-user or app-system tokens
and use them deliberately.
This repository exists to make that list concrete:
the Forge app is thin middleware,
and the remote is where the responsibilities live.
[How a Jira Remote Agent Connector Works](rovo-agent-connector.md)
describes those boundaries in more detail.

## Comparing the two at a glance

| Concern                 | `rovo:agent` with `action`                                       | `rovo:agentConnector`                                                  |
| ----------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Who runs the agent      | Rovo, using your prompt                                          | Your remote service                                                    |
| What your code receives | Individual tool calls with typed inputs                          | A2A messages describing delegated work                                 |
| Unit of work            | One action invocation                                            | A task that spans many requests                                        |
| Long-running work       | Must fit one bounded invocation, or be rebuilt by hand           | Native: return a task, then report progress via polling or streaming   |
| Pausing for the user    | Through the conversation, at the model's discretion              | First-class `input-required` and `auth-required` states                |
| Cancellation            | No dedicated mechanism                                           | `CancelTask` from Jira's agent panel                                   |
| Results                 | Interpreted and phrased by the model                             | Status messages and artifacts rendered as the agent produced them      |
| Where users find it     | Rovo Chat, editor `/ai`, Automation, in Jira and Confluence      | Work item assignment, `@mentions`, and Rovo Chat in Jira               |
| What you host           | Action handlers only                                             | The A2A service, task store, and agent runtime                         |

## Choosing deliberately

Neither module is a more advanced version of the other.
They answer different questions.
`rovo:agent` answers
"how can Rovo do something useful with my data or API?"
`rovo:agentConnector` answers
"how can my agent take on work inside Jira?"

A helpful test is to describe one interaction out loud.
If it sounds like
"the user asks, the agent looks something up or makes a change,
and replies in the same breath",
a Rovo agent with actions is the natural fit.
If it sounds like
"the user hands off a job,
the agent goes away to work on it,
checks back when it needs something,
and returns with a result to review",
that is a task,
and an agent connector is built for it.

When a team finds itself fighting invocation timeouts,
inventing status-check actions,
or asking the model to remember a job ID between turns,
that friction is usually the signal
that the work wants a task lifecycle rather than a tool call.

## Further reading

- [How a Jira Remote Agent Connector Works](rovo-agent-connector.md)
- [Polling vs Streaming for Jira Remote Agents](polling-vs-streaming.md)
- [Rovo modules overview][forge-rovo-modules]
- [`rovo:agent` module reference][forge-rovo-agent]
- [`action` module reference][forge-rovo-action]
- [`rovo:agentConnector` module reference][forge-agent-connector]
- [Integrate remote agents with Jira][forge-remote-agents]
- [Forge invocation limits][forge-invocation-limits]

[forge-rovo-modules]: https://developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-index/
[forge-rovo-agent]: https://developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-agent/
[forge-rovo-action]: https://developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-action/
[forge-agent-connector]: https://developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-agent-connector/
[forge-remote-agents]: https://developer.atlassian.com/platform/forge/remote-agents-in-jira/
[forge-invocation-limits]: https://developer.atlassian.com/platform/forge/limits-invocation/
