# Forge Remote Agents in Jira

This repository shows how to integrate an **AI agent running on external infrastructure** with **Jira Cloud** by using Forge as the installable Atlassian-facing middleware.

Use this sample when your agent runs outside Atlassian's platform but needs to behave like a Jira participant: users can assign it work items, mention it in comments, and receive task updates in Jira while the agent executes remotely.

> This is a sample implementation for learning and exploration. It is not a production-ready SaaS agent.

## What this repo demonstrates

After setup, this sample shows how to:

- register a remote agent in Jira with a Forge `rovo:agentConnector` module
- expose Forge remote endpoints that Jira can call for agent installation and task handling
- receive Forge installation lifecycle events and persist installation metadata
- handle Agent2Agent-inspired JSON-RPC methods for Jira task interactions:
  - `message/send`
  - `tasks/get`
  - `tasks/cancel`
- track agent contexts, tasks, task states, and status messages in a remote backend
- authenticate incoming Jira-to-remote requests with Forge Invocation Tokens (FITs)
- receive Forge app system and app user tokens for calling Jira REST APIs from the remote service
- simulate task progress locally while developing the integration

## Architecture

```text
Jira Cloud
  │
  │ installs app, invokes agent, polls task status
  ▼
Forge app
  │
  │ declares the agent connector, remote endpoints, scopes, and lifecycle trigger
  ▼
Remote backend service
  │
  │ verifies FITs, stores installations, manages contexts/tasks, calls your agent runtime
  ▼
Your externally hosted AI agent
```

The Forge app is deployed to Atlassian's platform and acts as the installable integration surface. The remote backend is hosted by you and is responsible for agent execution, persistence, tenant mapping, authorization, and operational behavior.

## Quickstart

### 1. Install dependencies

From the repository root:

```bash
npm install
```

### 2. Configure the remote backend

Copy the remote environment file:

```bash
cp apps/remote/.env.example apps/remote/.env
```

Set the values in `apps/remote/.env`:

```bash
export PORT=3000
export HOSTNAME=
```

`PORT` is the local Express server port. `HOSTNAME` is used by the `zrok` reserved-share script in `apps/remote/package.json`.

### 3. Configure the Forge app

Copy the Forge environment file:

```bash
cp apps/forge/.env.example apps/forge/.env
```

Set the values in `apps/forge/.env`:

```bash
export SITENAME=
export REMOTE_SERVICE_URL=https://$HOSTNAME.share.zrok.io/
```

`SITENAME` should be your Jira site name without `.atlassian.net`. `REMOTE_SERVICE_URL` must point to the public HTTPS URL for your remote backend.

### 4. Start the remote backend

From the repository root, start the backend server:

```bash
npm run dev:remote
```

If you also need the `zrok` tunnel from the remote workspace, run it separately from `apps/remote`:

```bash
npm run dev:tunnel
```

The `apps/remote` `dev` script is defined as `npm run dev:tunnel && npm run dev:remote`; because the tunnel process is long-running, use separate terminals when you need both the tunnel and backend server.

### 5. Deploy and install the Forge app

From the repository root:

```bash
npm run forge:deploy
npm run forge:install
```

Or run the Forge workspace scripts directly from `apps/forge`:

```bash
npm run forge:deploy
npm run forge:install
```

Forge commands require valid local environment files and Forge authentication.

## Validate the repo

Useful commands from the repository root:

```bash
npm run build
npm run test
npm run lint
npm run typecheck
```

If you are only checking the remote backend or shared package, run the relevant workspace script directly.

## Simulate the sample flow

The remote backend includes helper scripts in `apps/remote/scripts/` to simulate task progression:

- `1-knock-knock.sh`
- `2-otto.sh`
- `3-punchline.sh`
- `advance-task-completed.sh`
- `advance-task-failed.sh`

These are useful when demonstrating the app or testing the sample's task state behavior.

## Repository layout

```text
├── apps/
│   ├── forge/          # Forge app that registers the Jira remote agent connector
│   └── remote/         # Express backend that handles installation and JSON-RPC requests
├── packages/
│   └── forge-ahead/    # Shared Forge, FIT, manifest, JSON-RPC, and agent helper utilities
└── .atlassian/         # Repository ownership metadata
```

## Key files

- `apps/forge/manifest.yml` — Forge modules, remotes, token settings, scopes, and trigger wiring
- `apps/forge/src/resolvers/agent.ts` — Forge-side JSON-RPC request forwarding
- `apps/forge/src/resolvers/installation.ts` — Forge installation event handling
- `apps/remote/src/server.ts` — remote Express service implementing installation and task endpoints
- `apps/remote/src/auth.ts` — FIT validation middleware for incoming Forge remote requests
- `apps/remote/src/storage.ts` — simple local persistence for installations, tasks, and contexts
- `packages/forge-ahead/src/` — reusable helpers and types used by the sample

## Common commands

| Command | Purpose |
| --- | --- |
| `npm run build` | Build all packages and apps. |
| `npm run dev:remote` | Start the remote backend development flow. |
| `npm run test` | Run tests across workspaces. |
| `npm run lint` | Lint workspaces. |
| `npm run typecheck` | Run TypeScript checks across workspaces. |
| `npm run forge:deploy` | Deploy the Forge app workspace. |
| `npm run forge:install` | Install the Forge app workspace. |
| `npm run forge:uninstall` | Uninstall the Forge app workspace. |

See `package.json` files for the full script list.

## Deeper documentation

- [`apps/forge/README.md`](apps/forge/README.md) explains the Forge manifest, modules, scopes, token forwarding, and deployment scripts.
- [`apps/remote/README.md`](apps/remote/README.md) explains the Express service, JSON-RPC handlers, FIT verification, storage, and demo endpoints.
- [Forge documentation](https://developer.atlassian.com/platform/forge/)
- [Set up Forge](https://developer.atlassian.com/platform/forge/set-up-forge/)

## Production considerations

Before adapting this sample for production, plan to add or replace:

- durable database-backed storage for installations, tenants, users, contexts, and tasks
- tenant mapping and optional account mapping flows
- production-grade authentication, authorization, audit logging, and observability
- robust task execution and cancellation behavior in your actual agent runtime
- idempotency for lifecycle events and JSON-RPC retries
- rate limiting, input validation, and operational safeguards
- Marketplace-ready installation, upgrade, configuration, and support flows if distributing publicly

A production remote agent must preserve Jira's tenancy and permission boundaries. Keep agent context and memory scoped to the user and tenant that initiated the work, and only fetch Jira data the initiating user is allowed to see.

## Limitations

This repository is best understood as a learning and exploration sample. Current limitations include:

- simple file-based persistence in the remote backend
- sample-oriented task progression behavior
- simplified operational setup for local development
- no complete tenant or account mapping user interface
- no production agent runtime implementation

## Contributing

Contributions are welcome. Please see [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## License

Copyright (c) 2026 Atlassian US., Inc.
Apache 2.0 licensed, see [LICENSE](LICENSE) file.

[![With ❤️ from Atlassian](https://raw.githubusercontent.com/atlassian-internal/oss-assets/master/banner-with-thanks-light.png)](https://www.atlassian.com)
