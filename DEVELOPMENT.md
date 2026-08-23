# Development

This guide gets a new clone registered, connected to a local remote through a Cloudflare Quick Tunnel, and installed in Jira.

## Prerequisites

Install the Node.js version in `.nvmrc` and npm `11.17.0` or compatible. The development workflow also requires these native command-line tools:

- `cloudflared`
- `forge`
- `secretspec`
- `yq`

After cloning the repository, install Node dependencies and verify the native tools:

```bash
npm install
npm run tools:check
```

## First-time setup

This repository is a clonable sample, not a shared Forge app identity. Each developer must run the interactive [`forge register`](https://developer.atlassian.com/platform/forge/cli-reference/register/) command once for their own clone. Forge registers the app to the Atlassian account running the command and replaces `apps/forge/manifest.yml` with a new app ID; `scripts/register.sh` also stores that UUID as the required `FORGE_APP_ID` configuration value.

Do **not** rerun registration in the same clone unless you deliberately need a new app identity. Re-registering replaces the manifest app ID and disconnects the previous identity from its environments, stored variables, provider secrets, and storage.

1. Store the Jira development site used for installation:

   ```bash
   ./scripts/env-var-set.sh FORGE_SITE your-site.atlassian.net
   ```

2. Register the Forge app directly. This command is intentionally not an npm script:

   ```bash
   ./scripts/register.sh
   ```

   The script updates `apps/forge/manifest.yml` with the new Forge app ARI and stores its UUID as `FORGE_APP_ID` through SecretSpec. It uses `https://unconfigured.invalid` only as a non-routable bootstrap value for `REMOTE_BASE_URL`.

## Run the local integration

Use three terminals after registration.

### Terminal 1: start the remote

```bash
npm run remote:start
```

This starts the remote A2A 1.0 service on `localhost:3000` with the SecretSpec-managed `FORGE_APP_ID`. The remote uses `@a2a-js/sdk` for A2A task and JSON-RPC handling, and `@forge-ahead/remote` for Forge Invocation Token authentication and tenant context.

### Terminal 2: create the tunnel and deploy Forge

```bash
npm run forge:deploy:tunnel
```

This command starts a Cloudflare Quick Tunnel, stores its generated `https://*.trycloudflare.com` URL as `REMOTE_BASE_URL`, deploys the Forge app, and remains attached to keep the tunnel alive. Leave this terminal running while testing.

If Forge asks for `SYSTEM_USER_CHANGE_RULE` approval, review the effect: the app system user will no longer be @-mentionable. Only after deciding to accept that change, use the explicit approval workflow instead:

```bash
npm run forge:deploy:tunnel:approve-system-user-change
```

The approval is intentionally not part of the default deployment command. Future Forge approvals must remain explicit.

### Terminal 3: install in Jira

```bash
npm run forge:install
```

Open Jira on the configured site and invoke **Agent Simulator** through the Rovo experience. A successful smoke test returns the completed response `Agent Simulator is working.`

Quick Tunnel URLs change when the tunnel stops. Restart Terminal 2 and rerun `npm run forge:deploy:tunnel` whenever that occurs.

## Configuration

SecretSpec is the only configuration boundary. Do not source `.env` manually. When the configured provider is `dotenv`, SecretSpec may manage a local `.env` file, but scripts receive values only through `scripts/env-var.sh` or `scripts/env-var-set.sh`.

| Value | Purpose | Set by |
| --- | --- | --- |
| `FORGE_SITE` | Jira development-site hostname for install/uninstall. | `./scripts/env-var-set.sh` during first-time setup. |
| `FORGE_PRODUCT` | Forge product; defaults to `jira`. | SecretSpec default. |
| `FORGE_ENVIRONMENT` | Forge environment; defaults to `development`. | SecretSpec default. |
| `FORGE_APP_ID` | UUID used by the remote to validate Forge Invocation Tokens. | `./scripts/register.sh`. |
| `REMOTE_BASE_URL` | Public base URL rendered into the Forge manifest. | `scripts/tunnel.sh` via `npm run forge:deploy:tunnel`. |

`REMOTE_BASE_URL` defaults to `https://unconfigured.invalid` only so Forge can validate and register the manifest before a real tunnel exists. Never deploy with that placeholder.

## `scripts/` reference

| Script | Purpose | Invocation |
| --- | --- | --- |
| `env-var.sh` | Runs one trusted command with SecretSpec-injected configuration. | `bash scripts/env-var.sh '<command>'` |
| `env-var-set.sh` | Writes one named configuration value through SecretSpec. | `./scripts/env-var-set.sh <name> <value>` |
| `register.sh` | Interactively registers a Forge app, extracts its app ID, and stores it. | `./scripts/register.sh` |
| `tunnel.sh` | Starts a Quick Tunnel for `http://localhost:3000` and writes `REMOTE_BASE_URL`. | `./scripts/tunnel.sh` |
| `deploy-tunnel.sh` | Coordinates a Quick Tunnel before Forge deployment and keeps it alive. | `npm run forge:deploy:tunnel` or the named approval command below. |
| `tools-check.sh` | Checks the four required native tools. | `npm run tools:check` |

## Package scripts

| Command | Purpose |
| --- | --- |
| `npm run check` | Runs workspace checks through npm workspaces. |
| `npm run format` | Formats workspace sources through npm workspaces. |
| `npm run format:scripts` | Formats shell scripts and shell-test scaffolding with `shfmt`. |
| `npm run lint` | Lints workspace sources through npm workspaces. |
| `npm run lint:scripts` | Lints shell scripts and shell-test scaffolding with ShellCheck. |
| `npm run test` | Runs workspace tests through npm workspaces. |
| `npm run test:scripts` | Runs disposable shell-script contract tests. |
| `npm run tools:check` | Verifies `cloudflared`, `forge`, `secretspec`, and `yq` are available. |
| `npm run remote:start` | Starts the local A2A remote with SecretSpec-injected configuration. |
| `npm run forge:deploy` | Deploys the Forge workspace without approving behavior changes. |
| `npm run forge:deploy:approve-system-user-change` | Deploys after explicitly accepting `SYSTEM_USER_CHANGE_RULE`. |
| `npm run forge:deploy:tunnel` | Starts a tunnel, persists its URL, deploys Forge, and keeps the tunnel alive. |
| `npm run forge:deploy:tunnel:approve-system-user-change` | Does the same with the explicit system-user approval. |
| `npm run forge:install` | Installs the Forge app on `FORGE_SITE`. |
| `npm run forge:uninstall` | Uninstalls the Forge app from `FORGE_SITE`. |

There is intentionally no `npm run forge:register`: Forge registration is interactive and must run as `./scripts/register.sh`.

## Repository layout

- `apps/forge/` — Forge manifest and workspace scripts.
- `apps/remote/` — independently hosted Node.js A2A remote and its tests.
- `scripts/` — configuration, registration, tunnel, deployment, and prerequisite boundaries.
- `test/` — disposable shell-script contract tests.
- `secretspec.toml` — configuration contract used by the shell boundaries.
- `.scratch/specs/` — the implementation specification.
