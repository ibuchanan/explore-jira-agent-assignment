# Forge Remote Agents in Jira

This repository shows
how to integrate an **AI agent running on external infrastructure**
with **Jira Cloud**
by using Forge as the installable Atlassian-facing middleware.

Use this sample
when your agent runs outside Atlassian's platform
but needs to behave like a Jira participant:
users can assign it work items,
mention it in comments,
and receive task updates in Jira while the agent executes remotely.

> This is a sample implementation for learning and exploration.
> It is not a production-ready SaaS agent.

## Official docs and EAP status

Remote agents in Jira are available
through Atlassian's Forge Early Access Program (EAP).
Start with the official docs,
then use this repo as a runnable companion sample:

- [Changelog: Agent2Agent support in Jira][changelog-eap]
- [Guide: Integrate remote agents with Jira][remote-agents-guide]
- [Reference: `rovo:agentConnector` manifest module][agent-connector-ref]
- [Forge remotes][forge-remotes]

Because this feature is in EAP,
expect eligibility requirements
and platform limitations to change.
Treat the Atlassian developer docs as the source of truth for
current availability,
manifest fields,
supported transports,
and production/Marketplace restrictions.

## What this repo demonstrates

After setup, this sample shows how to:

- register a remote agent in Jira with a Forge `rovo:agentConnector` module
- expose Forge remote endpoints
  that Jira can call for agent installation and task handling
- receive Forge installation lifecycle events and persist installation metadata
- handle Agent2Agent-inspired JSON-RPC methods for Jira task interactions:
  - `message/send` (polling and streaming)
  - `tasks/get`
  - `tasks/cancel`
  - `tasks/resubscribe`
- track agent contexts, tasks, task states,
  and status messages in a remote backend
- authenticate incoming Jira-to-remote requests
  with Forge Invocation Tokens (FITs)
- receive Forge app system and app user tokens
  for calling Jira REST APIs from the remote service
- run a general-purpose A2A Simulator, driven by editable YAML
  Simulation Scenarios, so streamed Remote Agent behavior can be
  demonstrated and tested without a real agent backend — including a
  Simulated Coding Remote Agent scenario set

## Architecture

```text
Jira Cloud
  │
  │ installs app, invokes agent, polls task status
  ▼
Forge app
  │
  │ declares the connector, endpoints, scopes, and lifecycle trigger
  ▼
Remote backend service
  │
  │ verifies FITs, stores installations, and manages task state
  ▼
Your externally hosted AI agent
```

The Forge app is deployed to Atlassian's platform
and acts as the installable integration surface.
The remote backend is hosted by you
and is responsible for
agent execution,
persistence,
tenant mapping,
authorization,
and operational behavior.

See [Explanation: Why this sample has three separate layers](docs/explanation/why-three-layers.md)
for the reasoning behind this split, including why compute can't live in the
Forge app itself.

## Quickstart

1. Install dependencies from the repository root: `npm install`
2. Copy `apps/remote/.env.example` to `apps/remote/.env`, then fill in
   `PORT` and `HOSTNAME`.
3. From `apps/remote`, run `npm run dev:tunnel:create` once to create the
   public zrok tunnel name.
4. Copy `apps/forge/.env.example` to `apps/forge/.env`, then fill in
   `HOSTNAME`, `SITENAME`, and `REMOTE_SERVICE_URL`. Use the same `HOSTNAME`
   value from `apps/remote/.env`.
5. If this clone has not been registered with your Forge account, run
   `npm run forge:register` once from the repository root. This creates a
   Forge app in your own developer space and updates `apps/forge/manifest.yml`
   with that app ID. That is expected for cloned Forge apps.
6. Start the remote backend (`npm run dev:remote`) and, in a second
   terminal, the tunnel (`npm run dev:tunnel` from `apps/remote`).
7. Deploy and install the Forge app while the backend and tunnel are running:
   `npm run forge:deploy && npm run forge:install`. The install step sends
   the lifecycle event that lets the backend store its per-install state.

Forge commands require valid local environment files, Forge authentication,
and a Forge app ID registered for the account running the command.
Do not rerun `npm run forge:register` unless you intentionally want a fresh
Forge app registration.

For the complete, verified walkthrough, including expected output at each
stage and a first real Jira task, see
[Tutorial: Run the Sample End-to-End](docs/tutorials/run-the-sample-end-to-end.md).

## Explore simulation scenarios

The remote backend's streamed behavior is driven by editable YAML
Simulation Scenarios under `apps/remote/scenarios/` rather than hardcoded
demo scripts — see [`apps/remote/scenarios/README.md`](apps/remote/scenarios/README.md)
for how to add or edit one, and [`apps/remote/README.md`](apps/remote/README.md#exploring-the-simulated-streaming-behavior)
for how to exercise them (mainly via `npm test`, since `/a2a/json-rpc`
requires a real Forge Invocation Token that a bare `curl` can't supply).
Try it hands-on in
[Tutorial: Edit a Simulation Scenario](docs/tutorials/edit-a-simulation-scenario.md).

## Development

For repository layout, key files, command reference, validation checks,
and contribution workflow details, see [DEVELOPMENT.md](DEVELOPMENT.md).

## Deeper documentation

Workspace READMEs:

- [`apps/forge/README.md`](apps/forge/README.md) explains the sample's
  Forge manifest, modules, scopes, token forwarding, and deployment scripts.
- [`apps/remote/README.md`](apps/remote/README.md) explains the sample's
  Express service, JSON-RPC handlers, FIT verification, storage, and demo
  endpoints.

Repository docs under [`docs/`](docs/), organized by what you're trying to do:

- Learn by doing: [Run the Sample End-to-End](docs/tutorials/run-the-sample-end-to-end.md),
  [Edit a Simulation Scenario](docs/tutorials/edit-a-simulation-scenario.md)
- Get something working: [Diagnose FIT auth failures](docs/how-to-guides/diagnose-fit-auth-failures.md)
- Look something up: [A2A JSON-RPC endpoint](docs/reference/a2a-json-rpc-endpoint.md)
- Understand why: [Why this sample has three separate layers](docs/explanation/why-three-layers.md),
  and the individual decisions in [`docs/adr/`](docs/adr/)

Official Atlassian docs:

- [Integrate remote agents with Jira][remote-agents-guide] is the official
  end-to-end developer guide.
- [`rovo:agentConnector` module reference][agent-connector-ref] documents
  supported manifest fields such as `key`, `name`, `description`, `icon`,
  `conversationStarters`, and `protocols.agent2Agent.jsonRpcTransport`.
- [Forge remotes][forge-remotes] explains remote backends, egress, token
  forwarding, and Forge Invocation Tokens.
- [Set up Forge][set-up-forge] covers Forge CLI setup and authentication.

## Production considerations

Before adapting this sample for production, plan to add or replace:

- durable database-backed storage for
  installations, tenants, users, contexts, and tasks
- tenant mapping and optional account mapping flows
- production-grade authentication, authorization, audit logging,
  and observability
- robust task execution and cancellation behavior in your actual agent runtime
- idempotency for lifecycle events and JSON-RPC retries
- rate limiting, input validation, and operational safeguards
- Marketplace-ready installation, upgrade, configuration,
  and support flows if distributing publicly

A production remote agent must preserve
Jira's tenancy and permission boundaries.
Keep agent context and memory scoped to the user and tenant
that initiated the work,
and only fetch Jira data the initiating user is allowed to see.

## Limitations

This repository is best understood as a learning and exploration sample.
Current limitations include:

- simple file-based persistence in the remote backend
- sample-oriented task progression behavior
- simplified operational setup for local development
- EAP restrictions for `rovo:agentConnector` apps,
  including current limits
  on production/staging deployment and Marketplace distribution
- no complete tenant or account mapping user interface
- no production agent runtime implementation

## Contributing

Contributions are welcome.
Please see [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## License

Copyright (c) 2026 Atlassian US., Inc.
Apache 2.0 licensed, see [LICENSE](LICENSE) file.

[changelog-eap]: https://developer.atlassian.com/changelog/#CHANGE-3128
[remote-agents-guide]: https://developer.atlassian.com/platform/forge/remote-agents-in-jira/
[agent-connector-ref]: https://developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-agent-connector/
[forge-remotes]: https://developer.atlassian.com/platform/forge/remote/
[set-up-forge]: https://developer.atlassian.com/platform/forge/set-up-forge/
[atlassian-thanks-banner]: https://raw.githubusercontent.com/atlassian-internal/oss-assets/master/banner-with-thanks-light.png
[atlassian]: https://www.atlassian.com

[![With ❤️ from Atlassian][atlassian-thanks-banner]][atlassian]
