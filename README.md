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

If you are new to Forge and deciding between
a Rovo agent with actions (`rovo:agent`)
and a remote agent (`rovo:agentConnector`),
read [Rovo Agents vs Remote Agent Connectors][agent-vs-connector] first.
In short,
choose this connector when your agent runs on your own infrastructure
and its work can outlast a single Forge invocation.

[agent-vs-connector]: docs/explanation/rovo-agent-vs-agent-connector.md

[![Watch the video](https://cdn.loom.com/os/loom-media-content/loom/a436116f-02ce-4520-8fbb-7301462a1674/1621dc1f-3702-4525-84ba-fad829566798/sessions-thumbnails-857e42d8bb0149adbecde2555f308d86-bd2b2135a6783a7c-full-play.gif/binary?authToken=eyJraWQiOiJtaWNyb3MtZ3JvdXAvdGRwLW9zLWFyY2hldHlwZS9hMTFwa2hjMDEyYmJkNWFtIiwiYWxnIjoiUlMyNTYifQ.eyJicyI6Imxvb20tbWVkaWEtY29udGVudCIsImF1ZCI6InRkcC1vcy1hcmNoZXR5cGUiLCJuYmYiOjE3ODc2MTkwMzQsInRpIjoiNDE0Yzc3ZTgtYzYzYS00ZTdhLThmYmQtYjE1ZjQ5OWY0NDMwIiwiYWRpIjoibG9vbS9sb29tIiwiaXNzIjoibWljcm9zLWdyb3VwL3RkcC1vcy1hcmNoZXR5cGUiLCJwaWQiOiI0YzdiOGJjOC0zNGJmLTRiM2ItODEyMy0wN2NlNzIwM2Y5ZTQiLCJ3YSI6ImZhbHNlIiwib2lkIjoic2Vzc2lvbnMtdGh1bWJuYWlscy04NTdlNDJkOGJiMDE0OWFkYmVjZGUyNTU1ZjMwOGQ4Ni1iZDJiMjEzNWE2NzgzYTdjLWZ1bGwtcGxheS5naWYiLCJleHAiOjE3ODc2MTkzMzQsImlhdCI6MTc4NzYxOTAzNCwianRpIjoiNTEyYTY0ZTItZDlmNi00N2E1LWIzNmQtZmZiNWVhYjI5YWY1In0.EhpvvSmECnOwFar--JItjaabkrjQeoc-Iy20SR5JJGHoEA60YFQ00YhgVX8Judfr9ZoWkZz9W1Hwo79yGOgrMk5HZ6Tj2RT0apLzuzG_5yfSUFkRgOyIuJdWYZpDRjWY5ke9Hpb4zMFCjKH37E-r7t6Jfn8h9nrqOqxy1OKjZnC-3V-zPJA-z_mTioU00IUcT2lypkXxkYSny-jLYrDnAGphRN_yWe0yPFfongqeLC-Yqpe3zHijzE7-6L4xC9o1MdlehBCUSWC9FwEkrXzYGOo491tj-3-Q976lZNocguzzUVs0n2vYHdrmApJLGfyrvGhohYkhRjBSe4v5HUW9Qw&Expires=1787705435&Signature=Air%7EoQ07U91RiOgx6DVwDFteTqe-1WwmAcBVhYx5ZcmQObP9p-16H4vi7XMECYUj-P9Dmj%7ELAF5cNNUTRC9SRmb6Ay7qaJHlhljZOdkxi6Qe0h2Ut5h6Tv5jbr3r3tNSpsmJHpWoy8fcuercbugZgpTHuzHzef9I1Ggj3O22H%7EsehnSbcbdO4DSBG-5-P2BZTgNntNGLT4sy76fCl1tA6cj-zUhOUeOa7NS7XmkSEgNg9HlflvUYvSIbDtMXfzO%7ECHFQMrjHPAQCfJlt9Ar7%7EXQvMo5Sz3b7rKl%7EXJVK0yidUoqVyBFr%7EpcjswcQkqnKqaPupkmFlpdPR9KNiNBXKQ__&Key-Pair-Id=KQOSYIR44AIC0#t=0.1)](https://www.loom.com/share/857e42d8bb0149adbecde2555f308d86)

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
- **Choose a module:** [Rovo Agents vs Remote Agent Connectors](docs/explanation/rovo-agent-vs-agent-connector.md)
- **Understand the architecture:** [How a Jira Remote Agent Connector Works](docs/explanation/rovo-agent-connector.md)
- **Choose task delivery:** [Polling vs Streaming](docs/explanation/polling-vs-streaming.md)
- **Troubleshoot FIT validation:** [Diagnose a FIT Auth Failure](docs/how-to-guides/diagnose-fit-auth-failures.md)
- **Run live streaming checks:** [Jira streaming lifecycle smoke suite](docs/how-to-guides/run-jira-streaming-lifecycle-smoke-suite.md)
- **Look up behavior:** [A2A compatibility](docs/reference/jira-remote-agent-a2a-compatibility.md)
  and [Markdown in agent messages](docs/reference/markdown-in-agent-messages.md)

## Contributing and license

See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.
This project is licensed under the [Apache License 2.0](LICENSE).
