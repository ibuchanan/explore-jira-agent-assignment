# Why This Sample Has Three Separate Layers

This repository is organized as three layers
that each know as little as possible about the other two: 
the Forge app, 
the remote backend,
and, inside the remote backend, the A2A Simulator.

## The Forge app is Jira's trust boundary and installable surface

If this is your first Forge app, 
it's worth saying plainly what it *is* here before getting into what it isn't.
The Forge app is the thing Jira actually installs, 
trusts, 
and knows how to reach.
It declares the [`rovo:agentConnector`](https://developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-agent-connector/) module 
so Jira knows the agent exists 
and which endpoint handles its task traffic.
Because it runs on [Forge](https://developer.atlassian.com/platform/forge/) itself, 
Atlassian's own platform, 
rather than on infrastructure you manage,
it can obtain and attach [Forge Invocation Tokens](https://developer.atlassian.com/platform/forge/remote/essentials/#the-forge-invocation-token--fit-) 
to every request it forwards, 
so the remote backend can trust that a request really came from Jira,
and it can forward [app system and app user OAuth tokens](https://developer.atlassian.com/platform/forge/remote/calling-product-apis/) 
so that backend can call Jira APIs with the right identity.
None of that requires running the agent's own logic.
It only requires being a trustworthy, Atlassian-hosted go-between,
and that's exactly what the Forge app is for.

That job stays narrow on purpose, 
and the reason is structural rather than a preference this sample happened to land on.

The most basic constraint is transport.
Streaming a task update to Jira over [SSE](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events) means 
holding an HTTP connection open for anywhere from seconds to minutes.
Forge functions are billed and sandboxed as short-lived invocations; 
they are not designed to hold a connection open for the lifetime of an agent run.
So the compute, 
the part that actually decides what the agent does, 
has to live somewhere Atlassian doesn't manage, 
which is what "remote agent" means in the first place.

This is a real fork in the road, 
not a minor implementation detail.
If you wanted the agent's logic to execute inside Forge's own runtime, 
you'd be building a different kind of app,
one that qualifies for ["Runs on Atlassian"](https://developer.atlassian.com/platform/forge/runs-on-atlassian-apps/),
and this sample's architecture would not apply.

So the Forge app stays deliberately thin.
Everything it does is either trust-establishment or routing,
and everything the agent actually does happens one layer down.

## The remote backend owns compute, state, and the messy parts

Once compute has to live outside Forge, 
someone has to own 
task state,
context, 
retries, 
and the eventual call into a real agent runtime. 
That's the remote backend's job in this sample.

A real agent runtime doesn't speak A2A; 
it speaks whatever provider-specific event vocabulary its own SDK or model API happens to emit:
tool calls, 
model request lifecycle events, 
approval prompts, 
its own idea of "done."
Translating that vocabulary into A2A
Task State Updates, 
Content Updates, 
and Artifacts, 
without leaking provider-specific names into Jira's view of the task, 
is a mapping problem the remote backend owns, 
not a detail transport happens to carry along for free 
(see [ADR 0022](../adr/0022-separate-transport-from-state-mapping.md)).
`forge-ahead` ships a reference version of that mapper: 
[`mapRemoteAgentSignal`](../../packages/forge-ahead/src/rovo/signalMapper.ts) 
turns a provider-neutral `RemoteAgentSignal` category into an A2A-shaped event.
But this sample's own remote backend never calls it.
Its only remote agent is the A2A Simulator, 
and [Simulation Scenarios](../../apps/remote/scenarios/README.md) 
are authored directly in A2A vocabulary: 
`event`, 
`state`, 
`message`, 
and `artifact`.
A production remote backend, 
wired to an actual agent runtime, 
is where this mapping work has to actually happen.

It is also the layer with the most caveats in this repository:
file-backed persistence, 
synchronous sample task transitions, 
no durable tenant mapping.
It is standing in for infrastructure a real deployment would build properly. 
Separating it from the Forge app means 
those caveats are contained to one place, 
and a team adopting this pattern for real can replace this layer's internals 
without touching the Forge app's [manifest](https://developer.atlassian.com/platform/forge/manifest-reference/) or trust model at all.

## The A2A Simulator is a demonstration layer

Unlike real implementations that map [A2A](https://a2a-protocol.org/latest/topics/what-is-a2a/) into an internal domain event model,
this sample provides a general-purpose A2A simulator
so that implementers can quickly explore how Jira reacts
without having to code it all up first.

The A2A Simulator is a scenario runner 
that only knows how to turn a YAML file's `steps` into A2A-shaped events, 
and never branches on which scenario it happens to be playing.
The scenarios themselves are just data.
Anyone editing a `.yaml` file under `apps/remote/scenarios/` 
is authoring a demonstration without touching the code that interprets it
Someone auditing the simulator's code doesn't need 
to reason about every scenario
that currently exists to trust 
that a new one will behave correctly.

That reusability is also why the simulator's scope stays intentionally narrow: 
it emits generic A2A 
task, 
status, 
and artifact events.
The "coding agent" flavor of those events lives entirely in scenario data, 
not in the simulator's logic.
A different kind of remote agent,
maybe one that files expense reports instead of writing code,
could reuse the same simulator with an entirely different scenario set.

## How you can use the layers

Because the three layers are separated this way,
each one can be studied on its own terms.
The Forge app's tests check manifest wiring and
[JSON-RPC](https://en.wikipedia.org/wiki/JSON-RPC) forwarding without needing a live backend.
The remote backend's tests exercise the full streaming contract, 
including every scenario,
without needing a real Jira site, 
a real Forge deployment, 
or a real coding agent.
Neither test suite needs the others to pass first.
That independence is the practical payoff of a structural decision that,
otherwise, might look like unnecessary indirection for a sample this size.

None of this is presented as the only correct way to structure a remote agent integration:
this project's own reference-implementation stance (see `docs/adr/0007`)
is explicit that its choices prioritize visibility for implementers, 
not that they're a normative production baseline. 
A production integration might extract the simulator sooner, 
replace the file-backed storage layer entirely, 
or draw the line between "backend" and "agent runtime" differently. 
The three-layer split is what made sense for a repository 
whose primary job is to be read, run, and understood.

## Related docs

- [`apps/forge/README.md`](../../apps/forge/README.md#why-forge-remote-is-required-not-optional) —
  the manifest-level detail behind the transport constraint described above
- [`docs/adr/0032`](../adr/0032-replace-knock-knock-with-simulated-coding-agent.md),
  [`0033`](../adr/0033-simulated-agent-uses-editable-scenarios.md),
  [`0034`](../adr/0034-build-a-general-a2a-simulator.md), and
  [`0035`](../adr/0035-keep-a2a-simulator-inside-remote-app-first.md) —
  the individual decisions this explanation synthesizes
- [`docs/adr/0007`](../adr/0007-reference-implementation-prioritizes-visible-logging.md) —
  the reference-implementation stance referenced above
- [Tutorial: Edit a Simulation Scenario](../tutorials/edit-a-simulation-scenario.md) —
  see the scenario-as-data idea in practice
