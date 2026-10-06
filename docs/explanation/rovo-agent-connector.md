# How a Jira Remote Agent Connector Works

`rovo:agentConnector` is the Forge extension point that makes an agent running
on external infrastructure available to Jira. It is not a Forge UI module that
renders a panel or screen. Instead, it registers a remote agent with Jira and
connects Jira's agent experiences to a remote A2A service.

## The user experience it enables

A registered remote agent can participate in Jira work in the places where
users naturally delegate or discuss work: a work item assignment, an
`@mention` in a comment, or the Rovo Chat panel. Jira sends the resulting task
to the remote service and renders the task's progress updates and reviewable
artifacts as the remote agent works.

This lets Jira remain the place where people assign, review, clarify, and
follow work while the agent runs elsewhere. The remote agent does not need to
imitate Jira's interface or poll Jira for work.

## The boundary between Jira, Forge, and the remote service

The connector has three responsibilities that belong in different places:

- **Jira** owns the user-facing assignment, comment, chat, and task-rendering
  experiences.
- **The Forge app** registers the agent, declares where requests go, and
  establishes the trust boundary for the remote service.
- **The remote service** implements the A2A protocol and performs the agent's
  work. It returns task state, status updates, and artifacts rather than a
  Forge UI.

In this repository, `apps/forge/manifest.yml` declares a Jira-only connector
with the `agent2Agent` protocol at version `1.0`. Its JSON-RPC transport names
the Forge endpoint `a2a-json-rpc`; that endpoint forwards `/a2a/json-rpc` to
the `minimal-agent-remote` remote. `apps/remote/src/server.ts` validates the
Forge Invocation Token before dispatching the request to its A2A handler.

## The key concepts

**Agent identity** is the manifest entry's key, name, and description. Jira
uses this registration to identify the remote agent; the remote service then
handles work on that agent's behalf.

**A2A protocol version** is an interoperability contract. With `version:
"1.0"`, the remote must handle A2A 1.0 JSON-RPC method names and payload
shapes. The transport endpoint is the stable handoff from Forge to the remote
service.

**Task lifecycle** is how an agent communicates progress. A remote service
creates or updates tasks with states such as `working`, `input-required`,
`auth-required`, `completed`, and `failed`. Status updates let Jira show
ongoing work; artifacts carry reviewable results such as patches or summaries.

**Invocation trust** is distinct from access back into Jira. Forge Invocation
Tokens authenticate Jira-to-remote requests. If the remote must call Jira APIs,
the manifest can separately request Forge app-system or app-user access tokens.
User tokens are normally safer for work performed on a user's behalf because
they retain that user's Jira permissions. This reference implementation
validates FITs but does not request either forwarded Jira access token.

**Tenancy** matters because a remote service may serve multiple Jira sites. A
production remote must associate incoming work with the validated tenant and
must not treat task context from one Jira site as authority for another.

## Why this is an extension point rather than an API call

An API call lets an app fetch or change Jira data. An agent connector gives
Jira a long-lived capability: it knows which remote agent can receive work,
where to send it, and how to present the task's response. That makes
assignment, clarification, progress, and review part of a Jira-native workflow
rather than a collection of disconnected API calls.

The module and protocol evolve independently of this reference implementation.
Use the Forge documentation as the authority for supported manifest properties,
protocol requirements, and deployment behavior.

## Related material

- [Rovo Agents vs Remote Agent Connectors](rovo-agent-vs-agent-connector.md) —
  when to use `rovo:agent` with actions instead of a connector, and why
  long-running work favors a connector
- [`apps/forge/manifest.yml`](../../apps/forge/manifest.yml) — the connector,
  endpoint, remote, and scope declarations in this sample
- [`apps/remote/src/server.ts`](../../apps/remote/src/server.ts) — FIT
  validation and A2A dispatch
- [Integrate remote agents with Jira][forge-remote-agents] — current Forge
  integration guide

[forge-remote-agents]: https://developer.atlassian.com/platform/forge/remote-agents-in-jira/
