# Tutorial: Run the Sample End-to-End

In this tutorial, you will connect the local A2A Simulator directly to Jira:

1. register this clone as a Forge app;
2. start the remote backend on your machine;
3. expose it with a Cloudflare Quick Tunnel; and
4. deploy and install the Forge app on a Jira Cloud site.

By the end, you will invoke **Agent Simulator** from Jira and watch it run a
scenario. You will not edit application code.

## Prerequisites

Before starting, install and configure:

- the Node.js version in [`.nvmrc`](../../.nvmrc) and npm 11.17.0 or compatible;
- the Forge CLI and a completed `forge login`; see
  [Get started with Forge](https://developer.atlassian.com/platform/forge/getting-started/);
- `cloudflared`, [SecretSpec](https://github.com/ibuchanan/secretspec), and `yq`;
- a Jira Cloud site on which you can install Forge apps.

## 1. Install dependencies

From the repository root, run:

```bash
npm install
npm run tools:check
```

The second command confirms that the native tools used by the development loop
are available.

## 2. Verify the sample

```bash
npm run build
npm test
```

These commands establish a known-good local baseline before you configure a
Forge app or Jira site.

## 3. Configure your Jira site

Store the hostname of the Jira site where you will install the app:

```bash
./scripts/env-var-set.sh FORGE_SITE your-site.atlassian.net
```

Replace `your-site.atlassian.net` with your Jira Cloud hostname.

## 4. Register this clone

Each clone needs its own Forge app identity. Run the interactive registration
script once:

```bash
./scripts/register.sh
```

The script registers the app to your Forge account, updates
`apps/forge/manifest.yml` with the new app ID, and stores the corresponding
`FORGE_APP_ID` configuration value. Do not run it again unless you deliberately
want a different app identity.

## 5. Start the remote backend

Open a terminal at the repository root and run:

```bash
npm run remote:start
```

The remote listens on `localhost:3000` and validates Forge Invocation Tokens
before serving A2A requests. Leave this terminal running.

## 6. Create a tunnel and deploy Forge

Open a second terminal at the repository root and run:

```bash
npm run forge:deploy:tunnel:approve-system-user-change
```

This command starts a Cloudflare Quick Tunnel to the local remote, saves its
public URL as `REMOTE_BASE_URL`, and deploys the Forge app. Keep it running:
Quick Tunnel URLs expire when the tunnel stops.

The first deployment may require the explicit
`SYSTEM_USER_CHANGE_RULE` approval included in this command.

## 7. Install the app

Open a third terminal at the repository root and run:

```bash
npm run forge:install
```

This installs the deployed development app on the configured Jira site.

## 8. Invoke Agent Simulator from Jira

Open your configured Jira site and invoke **Agent Simulator** through the Rovo
experience. To run the simulated coding flow, use a task containing:

```text
Investigate the login fix in the session refresh flow
```

The simulator selects `coding-agent-happy-path`. Jira shows the task progress,
pauses for the scenario's approval prompts, and then displays the simulated
patch, verification report, and review handoff before completion.

## What you built

You now have three active pieces working together:

- Jira and the installed Forge app;
- a Cloudflare Quick Tunnel forwarding the Forge remote endpoint; and
- the local A2A Simulator remote backend.

The Forge app points directly to the tunnel URL in this development path.

## Next

- [Tutorial: Observe Interactive Markdown in Jira](observe-interactive-markdown.md)
  — invoke the interactive Markdown showcase.
- [Tutorial: Edit a Simulation Scenario](edit-a-simulation-scenario.md) — change
  what the simulator emits by editing YAML instead of TypeScript.
- [How-to: Diagnose FIT auth failures][fit-auth-failures] — diagnose an
  authenticated remote request that does not reach the simulator.

[fit-auth-failures]: ../how-to-guides/diagnose-fit-auth-failures.md
