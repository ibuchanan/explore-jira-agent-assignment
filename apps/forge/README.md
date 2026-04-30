# Forge Remote Agent App

This workspace contains 
the Forge app used by the sample remote-agent integration. 
The app is the Atlassian-facing installable component: 
it declares the Jira remote agent connector, 
wires Jira task traffic to a remote backend,
and configures the scopes and remote permissions needed by the integration.

Use this README when you are working on the Forge app itself.

Related docs:

- End-to-end overview and setup: root [`README.md`](../../README.md)
- Remote backend endpoints, storage, and demo flow:
  [`apps/remote/README.md`](../remote/README.md)
- Official guide: [Integrate remote agents with Jira][remote-agents-guide]
- Official reference: [`rovo:agentConnector` module][agent-connector-ref]

## Responsibilities

The Forge app demonstrates how to:

- register a Jira remote agent through a `rovo:agentConnector` module
- declare Forge remote endpoints for 
  task handling, installation, and configuration
- route Agent2Agent-inspired JSON-RPC traffic to the remote backend
- receive Forge installation lifecycle events
- request app system and app user token forwarding for the remote service
- declare the Jira scopes required by the sample
- validate Forge manifest and architecture assumptions with tests

This app is middleware. 
It does not run the actual external AI agent; 
that belongs in the remote backend or an agent runtime called by the backend.

## Architecture role

```text
Jira Cloud
  │
  │ invokes the installed remote agent connector
  ▼
Forge app
  │
  ├─ manifest declares agent connector, endpoints, remote, scopes, and tokens
  ├─ JSON-RPC resolver forwards task traffic to the backend remote
  └─ installation handler processes app install lifecycle events
  ▼
Remote backend service
```

The main source of truth for Forge wiring is [`manifest.yml`](manifest.yml).

## Manifest wiring

The manifest currently declares the following modules and remote configuration.
For the complete public schema,
see the [`rovo:agentConnector` manifest reference][agent-connector-ref].

### Agent connector

```yaml
modules:
  rovo:agentConnector:
    - key: jira-agent-connector
      name: Jira Agent Assignment
      description: Assigns tasks to AI agents in Jira
      protocols:
        agent2Agent:
          jsonRpcTransport:
            endpoint: a2a-json-rpc-endpoint
```

This makes the sample agent available in Jira 
and tells Jira which Forge endpoint to use for JSON-RPC task traffic. 
The official guide explains the Jira user flow and the Agent2Agent transport contract: 
[Integrate remote agents with Jira][remote-agents-guide].

### Endpoints

```yaml
modules:
  endpoint:
    - key: a2a-json-rpc-endpoint
      remote: backend-service
      route:
        path: /a2a/json-rpc
    - key: atlassian-installed-endpoint
      remote: backend-service
      route:
        path: /atlassian/installed
    - key: atlassian-config-endpoint
      remote: backend-service
      route:
        path: /atlassian/config
```

These endpoint definitions connect Forge's product-facing entry points 
to routes on the configured remote backend.

| Endpoint key | Remote path | Purpose |
| --- | --- | --- |
| `a2a-json-rpc-endpoint` | `/a2a/json-rpc` | Handles task traffic. |
| `atlassian-installed-endpoint` | `/atlassian/installed` | Handles installs. |
| `atlassian-config-endpoint` | `/atlassian/config` | Future config flow. |

### Installation trigger

```yaml
modules:
  trigger:
    - key: installation-trigger
      endpoint: atlassian-installed-endpoint
      events:
        - avi:forge:installed:app
```

The installation trigger is used 
so the integration can learn when a Jira site installs the app 
and record installation metadata in the remote service.

### Remote backend

```yaml
remotes:
  - key: backend-service
    baseUrl: ${REMOTE_SERVICE_URL}
    operations:
      - compute
      - storage
    storage:
      inScopeEUD: true
    auth:
      appSystemToken:
        enabled: true
      appUserToken:
        enabled: true
```

`REMOTE_SERVICE_URL` must point at the public HTTPS base URL for
`apps/remote` or another compatible remote backend. 
The remote must be configured as a Forge remote 
so Jira-to-remote requests include Forge Invocation Tokens 
and, when enabled, forwarded OAuth tokens.

Token forwarding is enabled so the backend can receive:

- `x-forge-oauth-system` for app-attributed Jira API calls
- `x-forge-oauth-user` for user-attributed Jira API calls

For task-specific Jira context fetching, 
prefer the app user token so Jira permissions are respected.

### Scopes

```yaml
permissions:
  scopes:
    - read:app-system-token
    - read:app-user-token
    - read:jira-work
```

These scopes allow token forwarding 
and read access to Jira work data used by the sample. 
If you add scopes or change egress/remote permissions, 
redeploy the app and upgrade the installation.

## Source files

- `manifest.yml` — Forge modules, remotes, token settings, runtime, and scopes
- `src/index.ts` — exports Forge handlers referenced by the app
- `src/resolvers/agent.ts` — JSON-RPC handler and backend forwarding logic
- `src/resolvers/installation.ts` — installation lifecycle handler
- `tests/forge/` — manifest, module, endpoint, and architecture tests
- `vitest.config.ts` — test configuration for this workspace

## JSON-RPC forwarding

`src/resolvers/agent.ts` handles JSON-RPC requests 
for the methods Jira uses to communicate with the remote agent:

| Method | Forge behavior |
| --- | --- |
| `message/send` | Validates and forwards params to the backend. |
| `tasks/get` | Forwards task lookup requests to the backend. |
| `tasks/cancel` | Forwards task cancellation requests to the backend. |

The resolver uses `invokeRemote("backend-service", ...)` 
to call the remote backend route declared in the manifest. 
It forwards available app system 
and app user tokens as headers 
so the backend can call Jira APIs when appropriate.

HTTP-level and JSON-RPC-level backend errors are converted into structured
JSON-RPC responses for Jira.

## Installation handling

`src/resolvers/installation.ts` handles 
`avi:forge:installed:app` trigger events.
It currently:

1. logs installation metadata
2. extracts the Jira cloud ID from the event context
3. fetches the Jira site base URL with the Jira server info API
4. logs the resolved installation details

The current handler logs installation details 
and resolves the Jira base URL.
In a complete implementation, 
ensure installation metadata is persisted 
by the remote service 
and linked to the correct tenant.

## Environment variables

Copy the example file and fill in values:

```bash
cp apps/forge/.env.example apps/forge/.env
```

Expected values:

```bash
export SITENAME=
export REMOTE_SERVICE_URL=https://$HOSTNAME.share.zrok.io/
```

| Variable | Purpose |
| --- | --- |
| `SITENAME` | Jira site name without `.atlassian.net`. |
| `REMOTE_SERVICE_URL` | Public HTTPS base URL for the remote backend. |

## Common commands

From this workspace:

```bash
npm run build
npm run test
npm run lint
npm run typecheck
```

Forge commands:

```bash
npm run forge:deploy
npm run forge:install
npm run forge:uninstall
```

The scripts load `.env` before running Forge CLI commands.

## Deploy and install flow

1. Start or deploy the remote backend and confirm it is reachable over HTTPS.
2. Set `REMOTE_SERVICE_URL` in `apps/forge/.env` to that backend's base URL.
3. Set `SITENAME` in `apps/forge/.env` to your Jira development site name.
4. Deploy the Forge app:

   ```bash
   npm run forge:deploy
   ```

5. Install the app into Jira:

   ```bash
   npm run forge:install
   ```

If you change scopes, remotes, token settings, 
or other permission-affecting manifest fields, 
redeploy and upgrade the installed app 
so Jira consents to the new version.

## Testing

This workspace uses Vitest and architecture tests 
to keep the Forge app aligned with the manifest and expected remote-agent wiring.

```bash
npm run test
```

Run `npm run lint` after manifest changes 
because it includes both Biome linting and `forge lint`.

## Production considerations

Before adapting this Forge app for production, consider adding:

- a real configuration UI, such as a Jira admin page for tenant mapping
- a personal settings page if users must map individual accounts
- stricter handling of installation, upgrade, 
  and future uninstall lifecycle behavior
- clearer recovery behavior when the remote backend is unavailable
- tighter scope review as you add Jira API usage
- Marketplace-ready app metadata, distribution, and support flows
- tests that cover any new manifest modules, scopes, remotes, or UI surfaces

## License

Apache-2.0

[remote-agents-guide]: https://developer.atlassian.com/platform/forge/remote-agents-in-jira/
[agent-connector-ref]: https://developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-agent-connector/
