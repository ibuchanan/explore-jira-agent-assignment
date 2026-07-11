# Remote Agent Backend Service

This workspace contains the externally hosted backend used by the sample Forge app. It receives Jira remote-agent requests through Forge remote endpoints, verifies Forge Invocation Tokens (FITs), stores sample installation and task state, and returns Agent2Agent-inspired JSON-RPC task responses to Jira.

Use this README when you are working on the remote service itself.

Related docs:

- End-to-end overview and setup: root [`README.md`](../../README.md)
- Forge app manifest, scopes, and deployment: [`apps/forge/README.md`](../forge/README.md)
- Authoring or editing Simulation Scenarios: [`scenarios/README.md`](scenarios/README.md)

## Responsibilities

The backend service demonstrates how a remote agent integration can:

- receive Forge installation lifecycle webhooks
- store Jira installation metadata for later task handling
- verify incoming Forge remote requests with FIT validation
- implement the JSON-RPC task methods Jira calls for remote agents, including streaming and `tasks/resubscribe`
- run a general-purpose A2A Simulator driven by editable YAML Simulation Scenarios (see [`scenarios/README.md`](scenarios/README.md)), including a Simulated Coding Remote Agent scenario set
- create and track private user-agent contexts
- create, fetch, cancel, and manually advance sample tasks
- receive app system and app user OAuth tokens forwarded by Forge
- expose local debug-style endpoints for demos and development

This service is intentionally simple. It is a development sample, not a production agent runtime.

## Runtime architecture

```text
Forge remote endpoint
  │
  │ HTTPS request with FIT and optional OAuth token headers
  ▼
Express service
  │
  ├─ auth middleware verifies the Forge Invocation Token
  ├─ installation handler records Jira site installation data
  ├─ JSON-RPC dispatcher routes Jira task methods
  ├─ A2A Simulator matches and plays back a Simulation Scenario for streaming requests
  ├─ task/context storage persists demo state locally
  └─ demo advance endpoint simulates agent progress
```

In a production integration, this service is where you would call your actual agent runtime, enqueue long-running work, persist state in a real database, and enforce tenant and user authorization rules.

## Prerequisites

- Node.js and npm compatible with the repository root configuration
- dependencies installed from the repository root with `npm install`
- a public HTTPS URL or tunnel that Forge can reach
- a deployed Forge app whose `REMOTE_SERVICE_URL` points at this service

## Environment variables

Copy the example file and fill in values:

```bash
cp apps/remote/.env.example apps/remote/.env
```

The sample expects:

```bash
export PORT=3000
export HOSTNAME=
```

| Variable | Purpose |
| --- | --- |
| `PORT` | Local Express server port. Defaults to `3000` if unset. |
| `HOSTNAME` | Reserved `zrok` hostname used by the sample tunnel script. |

If you are not using `zrok`, you can still run the server directly and expose it with another HTTPS tunnel or deployment platform. Make sure the Forge app's `REMOTE_SERVICE_URL` matches the public base URL for this service.

## Development

From the repository root, start only the backend watch process:

```bash
npm run dev:remote
```

From this workspace, start the configured tunnel and backend flow:

```bash
npm run dev
```

The workspace script currently runs:

- `npm run dev:tunnel` — starts the `zrok` reserved share from `.env`
- `npm run dev:remote` — starts `tsx watch src/server.ts`

If you use a different tunnel, start it separately and use `npm run dev:remote` for the service process.

## Build and run

```bash
npm run build
npm start
```

Useful checks from this workspace:

```bash
npm run lint
npm run format:check
npm run typecheck
```

## Main endpoints

### `POST /atlassian/installed`

Receives Forge installation events for the Jira site where the app was installed.

Expected security and request context:

- `Authorization: Bearer <FIT>` header
- FIT is verified by `authMiddleware`
- request body includes the Forge lifecycle payload

The handler extracts the Jira `cloudId` from the installation context ARI, fetches Jira server information through Atlassian's API gateway, and stores a local installation record containing:

- `cloudId`
- `installationId`
- `installerAccountId`
- `baseUrl`
- `installedAt`

### `POST /a2a/json-rpc`

Handles task interactions from Jira. Requests must be JSON-RPC 2.0 and are authenticated with a FIT.

Relevant headers:

- `Authorization: Bearer <FIT>` — required for Forge remote request verification
- `x-forge-oauth-system: <token>` — available when the Forge manifest enables app system tokens
- `x-forge-oauth-user: <token>` — available when the Forge manifest enables app user tokens

Implemented methods:

| Method | Behavior |
| --- | --- |
| `message/send` (polling) | Creates or updates a context, creates a new task, records the user message, and immediately transitions the sample task to `working`. |
| `message/send` (streaming, `Accept: text/event-stream`) | Matches a Simulation Scenario from the starting task text and streams it as SSE task, status, and artifact updates. A follow-up `message/send` carrying the same `taskId` resumes a task paused at `auth-required` or `input-required`. |
| `tasks/get` | Returns the stored task's current state and user-facing status message. |
| `tasks/cancel` | Stops an actively streaming scenario (or schedules a delayed transition for a polled task), then reports terminal `canceled`. |
| `tasks/resubscribe` | Streams the task's current snapshot, then — if the task is still active — continues the matched scenario from the next step that hasn't been streamed yet, rather than replaying it from the start. |

The sample accepts either `id` or `taskId` in `tasks/get` and `tasks/cancel` params to accommodate current Jira behavior and the documented schema.

See [`scenarios/README.md`](scenarios/README.md) for how Simulation Scenarios are matched, validated, and authored.

### `POST /atlassian/config`

Placeholder endpoint for future configuration flows, such as tenant mapping or account mapping. It is authenticated with FIT validation and currently returns `{ "success": true }`.

### `POST /tasks/:taskId/advance`

Development-only endpoint for manually progressing a sample task outside of any Simulation Scenario — useful for ad hoc state changes while poking at the sample with `curl`.

This endpoint is not part of the Jira remote-agent contract, and it is unrelated to the A2A Simulator: it sets task state directly rather than playing back a scenario.

Example body:

```json
{
  "state": "completed",
  "message": "Finished the sample task."
}
```

The endpoint validates the requested transition using the shared task transition rules from `forge-ahead`.

## JSON-RPC behavior

The JSON-RPC route returns standard JSON-RPC response envelopes:

```json
{
  "jsonrpc": "2.0",
  "id": "request-id",
  "result": {
    "kind": "task"
  }
}
```

Errors are returned as JSON-RPC errors. The sample maps common task errors to A2A-style codes:

| Error | Code |
| --- | --- |
| Task not found | `-32001` |
| Task cannot be canceled from current state | `-32002` |
| Context not found | `-32003` |
| Method not found | `-32601` |
| Invalid JSON-RPC request | `-32600` |
| Unhandled server error | `-32603` |

## Task and context model

The sample stores:

- installations by Jira cloud ID
- tasks by task ID
- contexts by context ID

A context represents a private user-agent interaction. A task represents one unit of work in that context.

On `message/send`, the backend:

1. uses the supplied `contextId` or creates a new one
2. extracts user and work item details from message data parts when present
3. records the user message in the context
4. creates a new task in `submitted`
5. immediately transitions that task to `working`
6. returns the formatted task to Jira

The implementation is designed for readability and demo behavior. A real agent should coordinate task state with durable work execution rather than synchronous sample transitions.

## Storage

`src/storage.ts` keeps in-memory maps and mirrors them to a local JSON file under `database/data.json`.

This file-backed persistence exists only to make the local development loop easier. It avoids losing installation and task state every time the development server restarts.

For production, replace it with durable storage such as PostgreSQL, DynamoDB, MongoDB, Redis, or another datastore appropriate for your agent's task model.

## Authentication and authorization notes

All Forge-originated endpoints should verify FITs. This sample does that through `src/auth.ts` and utilities from `forge-ahead`.

When the Forge manifest enables OAuth token forwarding, Jira task requests can include:

- an app system token for app-attributed calls
- an app user token for user-attributed calls

For fetching Jira context to process a user's task, prefer the app user token so Jira permissions are respected. Avoid using app system tokens for user-context data unless your service performs equivalent authorization checks.

Production implementations must also enforce tenant mapping, account mapping if needed, and isolation of memory or cached Jira data by tenant and user.

## Exploring the simulated streaming behavior

There are no manual demo scripts for the streaming flow: the A2A Simulator's
`/a2a/json-rpc` route requires a real Forge Invocation Token, so a bare
`curl` from outside a Forge-mediated request cannot reach it. Instead:

- add or edit files in [`scenarios/`](scenarios/README.md) to see the
  simulator play back different streamed behavior — no TypeScript changes
  required
- run `npm test` to exercise every scenario end-to-end over the real
  `/a2a/json-rpc` streaming route (see `tests/a2a-json-rpc.test.ts`)
- to see it through a real Jira interaction, deploy and install the Forge
  app pointed at this service (see the repository-root README) and assign a
  work item to the agent

## Production gaps

Before using this service as the basis for a real remote agent, plan to add or replace:

- durable tenant-aware database storage
- real tenant mapping and account mapping flows
- actual agent runtime or job queue integration
- idempotent handling for retries and duplicate events
- robust cancellation semantics for in-flight work
- structured logging, metrics, tracing, and audit records
- rate limiting and request validation
- customer-safe error handling
- authorization checks for all Jira data fetched by the agent
- secure handling of forwarded OAuth tokens
- deployment behind a stable HTTPS endpoint

## License

Apache-2.0
