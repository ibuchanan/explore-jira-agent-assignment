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

### 2. Start a session

At the repository root:

```bash
npm run session:start:approve-system-user-change
```

The explicit approval covers the first deployment
when Forge requires `SYSTEM_USER_CHANGE_RULE` approval;
later sessions can use `npm run session:start`.

The session owns the whole stack, in order:

1. starts the A2A 1.0 remote on `localhost:3000` in watch mode
   (it validates Forge Invocation Tokens using `FORGE_APP_ID`);
2. opens a Cloudflare Quick Tunnel and stores its URL as `REMOTE_BASE_URL`;
3. waits until the remote answers `GET /healthz` through the tunnel;
4. deploys the Forge app;
5. upgrades the existing installation, or installs if there is none;
6. holds until you press Ctrl+C, or until the remote or tunnel exits.

On exit it uninstalls the app,
stops the tunnel and remote,
and resets `REMOTE_BASE_URL` to the placeholder,
so Jira never keeps an installation whose backend has gone away.
Remote and tunnel logs are written to `.session/remote.log`
and `.session/tunnel.log`; follow them with `tail -f` in other terminals.

The individual steps remain available as
`npm run remote:start`, `npm run tunnel:start`,
`npm run forge:deploy`, `npm run forge:install`,
`npm run forge:upgrade`, and `npm run forge:uninstall`.
If you run them by hand, uninstall before stopping the tunnel.

### 3. Try it in Jira

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
- Change the remote under `apps/remote/`;
  during a session it rebuilds and restarts automatically
  without changing the tunnel URL or the installation.
- Run the remote test suite with:

  ```bash
  npm run --workspace=rovo-agent-connector-remote-backend test
  ```

- Check all workspaces with `npm run check`;
  run shell contract tests with
  `npm run test:scripts`
  when changing `scripts/` or `test/`.
- If you change `apps/forge/manifest.yml`,
  redeploy and upgrade the installed app
  from another terminal while the session runs:

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
  confirm that the session is still running;
  restart it after a tunnel interruption,
  because Quick Tunnel URLs change.
- **The app is still installed after a session ended:**
  the session was killed before teardown finished
  (for example, a closed terminal tab).
  The next session repairs it by upgrading,
  or run `npm run forge:uninstall`.
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
  session wrappers
- `test/` — shell contract tests
- `docs/` — documentation set
