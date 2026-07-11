# Why This Sample Has Three Separate Layers

This repository is organized as three layers that each know as little as
possible about the other two: the Forge app, the remote backend, and,
inside the remote backend, the A2A Simulator. It's worth asking why the
sample bothers with this separation instead of putting everything in one
place, because the answer explains a lot of the repository's structure
and its testing strategy.

## The Forge app can't be where the agent's compute lives

The most basic constraint is transport, not taste. Streaming a task
update to Jira over SSE means holding an HTTP connection open for
anywhere from seconds to minutes. Forge functions are billed and
sandboxed as short-lived invocations; they are not designed to hold a
connection open for the lifetime of an agent run. So the compute — the
part that actually decides what the agent does — structurally cannot live
inside the Forge app for this integration pattern. It has to live
somewhere Atlassian doesn't manage, which is what "remote agent" means in
the first place.

This is a real fork in the road, not a minor implementation detail. If
you wanted the agent's logic to execute inside Forge's own runtime, you'd
be building a different kind of app — one that qualifies for "Runs on
Atlassian" — and this sample's architecture would not apply.

Given that constraint, the Forge app's job narrows to what only Forge can
do: declaring the `rovo:agentConnector` module so Jira knows the agent
exists, obtaining and attaching Forge Invocation Tokens so the remote
backend can trust that a request really came from Jira, and forwarding
OAuth tokens so the backend can call Jira APIs with the right identity.
It is deliberately thin. Everything it does is either trust-establishment
or routing.

## The remote backend owns compute, state, and the messy parts

Once compute has to live outside Forge, someone has to own task state,
context, retries, and the eventual call into a real agent runtime. That's
the remote backend's job in this sample. It is also, not coincidentally,
the layer with the most caveats in this repository — file-backed
persistence, synchronous sample task transitions, no durable tenant
mapping — because it is standing in for infrastructure a real deployment
would build properly. Separating it from the Forge app means those
caveats are contained to one place, and a team adopting this pattern for
real can replace this layer's internals without touching the Forge app's
manifest or trust model at all.

## The A2A Simulator is a demonstration layer, not the product

The third layer is easy to miss the point of if you assume it's a
convenience script. It's more deliberate than that. Early versions of
this kind of sample tend to hardcode a scripted demo flow directly into
the backend's request handling — the kind of thing this project's own
history refers to as a "knock-knock demo." That approach works for one
demonstration and then fights you the moment you want a second one,
because the demo's control flow and the backend's request handling are
tangled together.

This sample instead built a general-purpose A2A Simulator: a scenario
runner that only knows how to turn a YAML file's `steps` into A2A-shaped
events, and never branches on which scenario it happens to be playing.
The scenarios themselves — a coding-agent happy path, an auth pause and
resumption, a mid-work cancellation, and so on — are just data.
Anyone editing a `.yaml` file under `apps/remote/scenarios/` is authoring
a demonstration without touching the code that interprets it, and someone
auditing the simulator's code doesn't need to reason about every scenario
that currently exists to trust that a new one will behave correctly.

That reusability is also why the simulator's scope stays intentionally
narrow: it emits generic A2A task, status, and artifact events, and the
"coding agent" flavor of those events lives entirely in scenario data, not
in the simulator's logic. A different kind of remote agent — one that
files expense reports instead of writing code — could reuse the same
simulator with an entirely different scenario set.

## Why the simulator still lives inside `apps/remote`

Given that the simulator is general-purpose, you might expect it to be a
standalone package already, alongside `packages/forge-ahead`. It isn't,
and that's a judgment call worth defending rather than a gap. Extracting
a shared package before a second consumer exists tends to guess at an API
shape instead of discovering one — you end up designing boundaries around
imagined future callers rather than a real one. Keeping the simulator
inside `apps/remote` for now means its interfaces can still change freely
as this sample's own needs clarify them, and extraction becomes an
easy, low-risk move once a second consumer actually shows up to prove the
API is right.

## What this buys you, concretely

Because the three layers are separated this way, each one can be verified
on its own terms. The Forge app's tests check manifest wiring and
JSON-RPC forwarding without needing a live backend. The remote backend's
tests exercise the full streaming contract, including every scenario,
without needing a real Jira site, a real Forge deployment, or a real
coding agent. Neither test suite needs the others to pass first. That
independence is the practical payoff of a structural decision that,
otherwise, might look like unnecessary indirection for a sample this
size.

None of this is presented as the only correct way to structure a remote
agent integration — this project's own reference-implementation stance
(see `docs/adr/0007`) is explicit that its choices prioritize visibility
for implementers, not that they're a normative production baseline. A
production integration might extract the simulator sooner, replace the
file-backed storage layer entirely, or draw the line between "backend"
and "agent runtime" differently. The three-layer split is what made sense
for a repository whose primary job is to be read, run, and understood.

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
