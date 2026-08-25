# Rovo Agent Connector reference implementation

A minimal, runnable reference implementation of the Forge
[`rovo:agentConnector`](https://developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-agent-connector/)
module for Jira.
It registers a remote agent,
forwards Jira's A2A 1.0 JSON-RPC requests
to an independently hosted service,
and validates Forge Invocation Tokens (FITs) at that service.

The included **Agent Simulator** is deliberately scenario-driven.
It lets you exercise
task completion,
streaming progress,
input and authentication pauses,
artifacts,
cancellation,
and Markdown without building an AI agent first.

## Is this for you?

Use this repository when you want to:

- try a Jira remote agent connector end to end;
- understand the boundary between Jira, Forge, and an A2A remote; or
- adapt a small, tested starting point for your own remote agent.

It is a reference implementation,
not a production agent platform.
The sample uses a Cloudflare Quick Tunnel for local development
and an in-memory task store,
so task continuity across
a remote restart,
tunnel loss,
redeployment,
or reinstallation is not provided.

## Try it in Jira

You will need:

- Node.js 24 (see [`.nvmrc`](.nvmrc))
- npm 11.17.0 or compatible
- the [Forge CLI](https://go.atlassian.com/) with a completed `forge login`
- [`cloudflared`](https://try.cloudflare.com/)
- [`secretspec`](https://secretspec.dev/)
- [`yq`](https://mikefarah.gitbook.io/yq)
- and a Jira Cloud site on which you can install Forge apps.

```bash
npm install
npm run tools:check
npm run build
npm test
```

Then follow [Run the Sample End-to-End](docs/tutorials/run-the-sample-end-to-end.md).
It registers this clone as a Forge app,
starts the local remote,
opens a Quick Tunnel,
deploys the app,
and installs it in Jira.

For the complete contributor loop,
configuration reference,
and troubleshooting,
see [DEVELOPMENT.md](DEVELOPMENT.md).

## How it works

```text
Jira
  │ A2A 1.0 JSON-RPC
  ▼
Forge app (`rovo:agentConnector`)
  │ Forge remote endpoint + FIT
  ▼
Remote A2A service
  │
  ▼
Scenario runner or your agent runtime
```

The Forge manifest selects Jira and the A2A 1.0 JSON-RPC endpoint.
The remote service validates the FIT
before it dispatches an A2A request.
The bundled simulator then selects a YAML scenario from the incoming task context.

## Documentation

- **Develop the reference implementation:** [DEVELOPMENT.md](DEVELOPMENT.md)
- **Start here:** [Run the Sample End-to-End](docs/tutorials/run-the-sample-end-to-end.md)
- **Use the simulator:** [Edit a Simulation Scenario](docs/tutorials/edit-a-simulation-scenario.md)
  and [scenario format reference](apps/scenarios/README.md)
- **Understand the architecture:** [How a Jira Remote Agent Connector Works](docs/explanation/rovo-agent-connector.md)
- **Choose task delivery:** [Polling vs Streaming](docs/explanation/polling-vs-streaming.md)
- **Troubleshoot FIT validation:** [Diagnose a FIT Auth Failure](docs/how-to-guides/diagnose-fit-auth-failures.md)
- **Run live streaming checks:** [Jira streaming lifecycle smoke suite](docs/how-to-guides/run-jira-streaming-lifecycle-smoke-suite.md)
- **Look up behavior:** [A2A compatibility](docs/reference/jira-remote-agent-a2a-compatibility.md)
  and [Markdown in agent messages](docs/reference/markdown-in-agent-messages.md)

## Contributing and license

See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.
This project is licensed under the [Apache License 2.0](LICENSE).
