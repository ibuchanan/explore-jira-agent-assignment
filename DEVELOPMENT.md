# Development

Use this guide to run the reference implementation against a Jira Cloud site.
The shortest successful path is:
register this clone as a Forge app,
start the local A2A remote,
expose it through a Cloudflare Quick Tunnel,
deploy the Forge app,
and install it in Jira.

For a lesson-style walkthrough,
use [Run the Sample End-to-End](docs/tutorials/run-the-sample-end-to-end.md).

## Prerequisites

Install Node.js 24 (the version in [`.nvmrc`](.nvmrc))
and npm 11.17.0 or a compatible version.
You also need these commands on `PATH`:

- [`forge`](https://go.atlassian.com/forge) — authenticate first with `forge login`
- [`cloudflared`](https://try.cloudflare.com/)
- [`secretspec`](https://secretspec.dev/)
- [`yq`](https://mikefarah.gitbook.io/yq)

You need a Jira Cloud site where you can install Forge apps.

From a new clone,
install dependencies and verify the native tools:

```bash
npm install
npm run tools:check
npm run build
npm test
```

`npm run build` and `npm test` establish a local baseline
without Jira or a Forge deployment.

## Run the reference implementation

### 1. Configure the Jira site and register this clone

Each clone needs its own Forge app identity.
Store the target Jira hostname,
then register the app interactively:

```bash
./scripts/env-var-set.sh FORGE_SITE your-site.atlassian.net
./scripts/register.sh
```

Replace `your-site.atlassian.net` with the hostname of your Jira Cloud site.
Registration updates `apps/forge/manifest.yml` with a Forge app ARI
and stores its UUID as `FORGE_APP_ID`.
Run it once per clone;
rerunning it deliberately creates a different app identity.

`REMOTE_BASE_URL` begins as the non-routable bootstrap value
`https://unconfigured.invalid`.
The tunnel command replaces it before deployment.
Do not deploy the placeholder value.

### 2. Start the remote

In the first terminal at the repository root:

```bash
npm run remote:start
```

The A2A 1.0 remote listens on `localhost:3000`,
loads the simulator scenarios,
and validates Forge Invocation Tokens using `FORGE_APP_ID`.

### 3. Start a tunnel and deploy Forge

In a second terminal:

```bash
npm run forge:deploy:tunnel:approve-system-user-change
```

This command opens a Cloudflare Quick Tunnel to the local remote,
stores its public URL as `REMOTE_BASE_URL`,
deploys the Forge app,
and stays attached to keep the tunnel alive.
The explicit approval covers the first deployment
when Forge requires `SYSTEM_USER_CHANGE_RULE` approval.

Quick Tunnel URLs change when the tunnel stops.
Restart this command before using Jira again after a tunnel interruption.

### 4. Install the app

In a third terminal:

```bash
npm run forge:install
```

Open Jira on the configured site,
create a workitem with a subject:

```text
Investigate the login fix in the session refresh flow
```

Assign **Agent Simulator** to the workitem.
The `demo-coding` scenario reports progress,
asks for approval,
and completes with simulated artifacts.

## Daily development loop

- Change a YAML file under `apps/scenarios/` to change simulator behavior.
  Read [the scenario reference](apps/scenarios/README.md)
  for its schema and matching rules.
- Change the remote under `apps/remote/`,
  then restart `npm run remote:start`.
- Run the remote test suite with:

  ```bash
  npm run --workspace=rovo-agent-connector-remote-backend test
  ```

- Check all workspaces with `npm run check`;
  run shell contract tests with
  `npm run test:scripts`
  when changing `scripts/` or `test/`.
- If you change `apps/forge/manifest.yml`,
  redeploy and upgrade the installed
  app if its permissions changed:

  ```bash
  npm run forge:deploy
  npm run forge:upgrade
  ```

## Configuration

[SecretSpec configuration](secretspec.toml) is the canonical reference for the
required values, defaults, and descriptions. Do not source `.env` manually;
scripts obtain values through `scripts/env-var.sh` and set values through
`scripts/env-var-set.sh`.

## Troubleshooting

- **No request reaches the remote:**
  confirm that the tunnel process is still running
  and redeploy after a Quick Tunnel URL changes.
- **FIT validation fails:**
  confirm that this clone's current `FORGE_APP_ID` was used to start the remote.
  Follow [Diagnose a FIT Auth Failure](docs/how-to-guides/diagnose-fit-auth-failures.md).
- **A manifest or scope change is not visible:**
  redeploy,
  then run `npm run forge:upgrade`
  to update the installed app.
- **You need a live streaming check:**
  use the [Jira streaming lifecycle smoke suite](docs/how-to-guides/run-jira-streaming-lifecycle-smoke-suite.md).

## Repository layout

- `apps/forge/` — Forge manifest for the installable connector
- `apps/remote/` — A2A service, FIT authentication, scenario runner, and tests
- `apps/scenarios/` — scenario data loaded by the remote
- `scripts/` — native-tool, configuration, registration, tunnel, and
  deployment wrappers
- `test/` — shell contract tests
- `docs/` — documentation set
