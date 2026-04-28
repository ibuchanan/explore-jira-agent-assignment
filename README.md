# Forge Remote Agents in Jira

This repository illustrates how to integrate an **AI agent running on external infrastructure** with **Jira Cloud** using Forge as the installable Atlassian-facing middleware.

The pattern is useful when your agent runs outside Atlassian's platform but needs to behave like a Jira participant: users can assign it work items, mention it in comments, and receive task updates in Jira while the agent executes remotely.

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

This is a **sample implementation**, not a production-ready SaaS agent.

## Read the docs in this repo

- **Start here:** this root README explains the end-to-end integration and local setup.
- **Forge app details:** [`apps/forge/README.md`](apps/forge/README.md) explains the manifest, modules, scopes, token forwarding, and deployment scripts.
- **Remote backend details:** [`apps/remote/README.md`](apps/remote/README.md) explains the Express service, JSON-RPC handlers, FIT verification, storage, and demo endpoints.

## Architecture at a glance

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

## Repository structure

```text
├── apps/
│   ├── forge/          # Forge app that registers the Jira remote agent connector
│   └── remote/         # Express backend that handles installation and JSON-RPC requests
├── packages/
│   └── forge-ahead/    # Shared Forge, FIT, manifest, JSON-RPC, and agent helper utilities
└── .agents/            # Local agent skills and repository guidance
```

## Key implementation files

- `apps/forge/manifest.yml` — Forge modules, remotes, token settings, scopes, and trigger wiring
- `apps/forge/src/resolvers/agent.ts` — Forge-side JSON-RPC request forwarding
- `apps/forge/src/resolvers/installation.ts` — Forge installation event handling
- `apps/remote/src/server.ts` — remote Express service implementing installation and task endpoints
- `apps/remote/src/auth.ts` — FIT validation middleware for incoming Forge remote requests
- `apps/remote/src/storage.ts` — simple local persistence for installations, tasks, and contexts
- `packages/forge-ahead/src/` — reusable helpers and types used by the sample

## How the sample maps to the remote agent feature

### 1. Installation and lifecycle

The Forge manifest declares:

- a `rovo:agentConnector` module that makes the remote agent available in Jira
- a Forge remote named `backend-service`
- endpoint routes for:
  - `/a2a/json-rpc`
  - `/atlassian/installed`
  - `/atlassian/config`
- an installation trigger for `avi:forge:installed:app`
- app system and app user token forwarding for the remote service

When the app is installed, Jira sends an installation event through Forge to the remote backend. The backend stores the Jira cloud ID, installation ID, installer account ID, and resolved Jira base URL so later task requests can be associated with the correct Jira site.

### 2. Task handling

Jira communicates with the remote agent over JSON-RPC. This sample implements the three core methods used by Jira task interactions:

| Method | Purpose |
| --- | --- |
| `message/send` | Starts a new task or adds user input to an existing context. |
| `tasks/get` | Lets Jira poll for the current state and latest message for a task. |
| `tasks/cancel` | Lets Jira request cancellation of an active task. |

The backend returns task objects with a `status.state`, a user-facing markdown message, a `taskId`, and a `contextId`. The sample stores these objects locally and includes helper scripts for moving tasks through demo states.

### 3. Contexts and task lifecycle

Jira uses a context to represent a private user-agent interaction. This repo models that by storing contexts separately from tasks.

Important rules illustrated by the sample:

- a new assignment or comment mention starts a new context when Jira sends a message without a `contextId`
- follow-up chat messages include the existing `contextId`
- each context should have only one active task at a time
- completed, canceled, failed, and rejected tasks are terminal and should not be restarted
- retrying work should create a new task rather than reusing a terminal one

The sample task states align with the Jira remote-agent lifecycle: `submitted`, `working`, `input-required`, `auth-required`, `completed`, `canceled`, `failed`, `rejected`, and `unknown`.

### 4. Authentication and Jira API access

Incoming requests from Jira include a Forge Invocation Token in the `Authorization` header. The remote backend verifies this token before handling installation or task requests.

The Forge manifest also enables:

- `x-forge-oauth-system` for calls that should be attributed to the app's system user
- `x-forge-oauth-user` for calls that should be made as the Jira user interacting with the agent

For task-related context fetching, prefer the app user token so Jira permissions are respected. Use the app system token only for app-level operations where acting as the app is appropriate.

### 5. Tenancy and authorization considerations

A production remote agent must preserve Jira's tenancy and permission boundaries. In practice, that means:

- map each Jira installation to the correct tenant in your remote service
- keep agent context and memory scoped to the user and tenant that initiated the work
- only fetch additional Jira data the initiating user is allowed to see
- avoid sharing cached Jira data across users unless your service has performed the same permission checks Jira would enforce
- treat Forge scopes, token handling, and egress as part of the security boundary

This sample keeps persistence intentionally simple so the integration flow is easy to inspect. Replace it with production-grade tenant, user, and authorization models before using this pattern in a real app.

## Prerequisites

Before you start, make sure you have:

- Node.js and npm versions compatible with this repo's `.nvmrc` and `package.json`
- [Forge CLI](https://developer.atlassian.com/platform/forge/set-up-forge/) with its prerequisites
- access to an Atlassian cloud development site with Jira
- a public HTTPS URL or tunnel for the remote backend

This example was developed with `zrok`, but any equivalent tunneling or hosting setup can work as long as Forge can reach the remote backend URL.

## Install dependencies

From the repository root:

```bash
npm install
```

## Configure the remote backend

Copy the remote environment file and set your values:

```bash
cp apps/remote/.env.example apps/remote/.env
```

The remote backend expects:

```bash
export PORT=3000
export HOSTNAME=
```

Notes:

- `PORT` is the local port for the Express server.
- `HOSTNAME` is used by the `zrok`-based dev tunnel script in `apps/remote/package.json`.
- The backend `dev` script starts both the local server and a tunnel.

## Configure the Forge app

Copy the Forge environment file and set your values:

```bash
cp apps/forge/.env.example apps/forge/.env
```

The Forge app expects:

```bash
export SITENAME=
export REMOTE_SERVICE_URL=https://$HOSTNAME.share.zrok.io/
```

Notes:

- `SITENAME` should be your Jira site name without `.atlassian.net`.
- `REMOTE_SERVICE_URL` must point to the public URL for your remote backend.
- The Forge manifest uses `REMOTE_SERVICE_URL` as the remote base URL.

## Start the remote backend

From the repository root, the quickest way to start just the backend server is:

```bash
npm run dev:remote
```

If you want to run the remote workspace's full development flow, including the tunnel script, use:

```bash
cd apps/remote
npm run dev
```

The remote backend service:

- verifies Forge Invocation Tokens
- handles `/atlassian/installed`
- handles `/a2a/json-rpc`
- exposes debug endpoints for local inspection

## Deploy and install the Forge app

From the repository root, you can use the workspace scripts:

```bash
npm run forge:deploy
npm run forge:install
```

Or run the Forge app scripts directly:

```bash
cd apps/forge
npm run forge:deploy
npm run forge:install
```

This sample's Forge manifest defines:

- a remote endpoint for JSON-RPC task requests
- a remote endpoint for installation events
- a `rovo:agentConnector` module named **Jira Agent Assignment**
- an installation trigger for `avi:forge:installed:app`
- scopes for app system token, app user token, and Jira work reads

## Verify the setup

Useful commands from the repo root:

```bash
npm run build
npm run test
npm run lint
npm run typecheck
```

Some Forge commands require valid local environment files and Forge authentication. If you are only checking the remote backend or shared package, run the relevant workspace script directly.

## Simulate the sample flow

This sample includes helper scripts in `apps/remote/scripts/` to simulate advancing task state:

- `1-knock-knock.sh`
- `2-otto.sh`
- `3-punchline.sh`
- `advance-task-completed.sh`
- `advance-task-failed.sh`

These are useful when demonstrating the app or testing the sample's task progression behavior.

## Production considerations

Before adapting this sample for production, plan to add or replace:

- durable database-backed storage for installations, tenants, users, contexts, and tasks
- tenant mapping and optional account mapping flows
- production-grade authentication, authorization, audit logging, and observability
- robust task execution and cancellation behavior in your actual agent runtime
- idempotency for lifecycle events and JSON-RPC retries
- rate limiting, input validation, and operational safeguards
- Marketplace-ready installation, upgrade, configuration, and support flows if distributing publicly

## Root scripts

Available scripts from the repository root:

- `npm run build` — build all packages and apps
- `npm run dev` — run development tasks across the monorepo
- `npm run dev:remote` — start the remote backend development flow
- `npm run test` — run all tests
- `npm run lint` — lint all workspaces
- `npm run format` — format all workspaces
- `npm run check` — run repo-wide checks
- `npm run typecheck` — run type checks across workspaces
- `npm run clean` — clean build outputs
- `npm run forge:deploy` — deploy the Forge app workspace
- `npm run forge:install` — install the Forge app workspace
- `npm run forge:uninstall` — uninstall the Forge app workspace

## Further reading

- [Forge documentation](https://developer.atlassian.com/platform/forge/)
- [Set up Forge](https://developer.atlassian.com/platform/forge/set-up-forge/)
- [`apps/remote/README.md`](apps/remote/README.md)

## Limitations

This repository is best understood as a learning and exploration sample.

Examples of current limitations include:

- simple file-based persistence in the remote backend
- sample-oriented task progression behavior
- simplified operational setup for local development
- no complete tenant or account mapping user interface
- no production agent runtime implementation
- gaps between sample behavior and what a production SaaS integration would require

## Contributions

Contributions to this repository are welcome.
Please see [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## License

Copyright (c) 2026 Atlassian US., Inc.
Apache 2.0 licensed, see [LICENSE](LICENSE) file.

[![With ❤️ from Atlassian](https://raw.githubusercontent.com/atlassian-internal/oss-assets/master/banner-with-thanks-light.png)](https://www.atlassian.com)
