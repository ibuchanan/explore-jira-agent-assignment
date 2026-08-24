# Tutorial: Run the Sample End-to-End

In this tutorial
you will bring up every piece of this sample in order:

1. the Public Relay (a Cloudflare Worker),
2. the remote backend on your machine,
3. a Cloudflare Tunnel exposing it,
4. and the Forge app that connects it to a real Jira Cloud site.

By the end, you will have assigned a Jira work item
to the sample agent and watched it run.

You will not edit any code in this tutorial.
The point is to get a known-good baseline running first,
so that you know every piece works
and you'll notice immediately if something you touched breaks it.

## Prerequisites

Get these four things ready before you start.
None of them are taught here.
Each one is a standard piece of setup for its own tool,
and the linked guide is the right place to learn it:

- **Node.js and npm**
  matching the version in this repository's `.nvmrc`
  (currently Node 24).
- **A Forge CLI login.**
  Install the Forge CLI and run `forge login`
  if you haven't already,
  see [Get started with Forge](https://developer.atlassian.com/platform/forge/getting-started/).
  You'll also need a Jira Cloud site you're allowed to install apps on;
  a free developer site from that same guide works.
- **A Cloudflare account.**
  The Public Relay is a Cloudflare Worker (`apps/relay`)
  and the local development tunnel is a Cloudflare Tunnel.
  A free Cloudflare account is enough.
  See [Cloudflare Workers](https://developers.cloudflare.com/workers/)
  and [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/).
- **The `cloudflared` CLI on this machine.**
  The sample uses `cloudflared tunnel --url http://localhost:3000`
  for the quick tunnel in the local development loop.
  See [Download `cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/).

## 1. Install dependencies

From the repository root, run:

```bash
npm install
```

This installs dependencies for every workspace at once.

## 2. Confirm everything builds

```bash
npm run build
```

You'll see each workspace build in turn, ending with something like:

```text
 Tasks:    3 successful, 3 total
```

## 3. Confirm every test passes

```bash
npm test
```

Every workspace runs its own test suite.
This step matters more than it might look like:
it means the whole sample checks out on your machine
before you've configured a single account.

## 4. Deploy the Public Relay

From the repository root:

```bash
npm run dev:relay:deploy
```

This deploys the Cloudflare Worker in `apps/relay`.
Note the deployed URL (for example, `https://my-relay.example.workers.dev/`);
you will use it in the next step.

The Public Relay is the always-on tier Jira reaches.
It serves the A2A Agent Card and proxies incoming requests
through a Cloudflare Tunnel to your local backend.

## 5. Configure the Forge app

Copy the environment file:

```bash
cp apps/forge/.env.example apps/forge/.env
```

Open `apps/forge/.env` and set:

```bash
export SITENAME=your-site-name
export REMOTE_SERVICE_URL=https://my-relay.example.workers.dev/
```

`SITENAME` is your Jira site name without `.atlassian.net`.
`REMOTE_SERVICE_URL` is the Public Relay URL from step 4.

## 6. Configure the remote backend

Copy the environment file:

```bash
cp apps/remote/.env.example apps/remote/.env
```

Open `apps/remote/.env` and set:

```bash
export PORT=3000
```

## 7. Register the cloned Forge app

If this is the first time this clone is using your Forge account,
register it once from the repository root:

```bash
npm run forge:register
```

This creates a Forge app in your own developer space
and writes that new app ID to `apps/forge/manifest.yml`.
That is expected for a cloned or inherited Forge app.
If you have already registered this clone, skip this step;
running it again creates another app registration.

Keep the resulting manifest change out of unrelated pull requests
unless maintainers ask for a registration change.

## 8. Start the remote backend

From the repository root:

```bash
npm run dev:remote
```

You'll see:

```text
No data file found, starting fresh
Remote agent backend service running on port 3000
Endpoints:
  - GET  /health/live
  - GET  /.well-known/agent-card.json
  - POST /a2a
  - POST /atlassian/installed
  - POST /atlassian/config
```

Leave this running.
Open a new terminal for the next step.

## 9. Start the Cloudflare Tunnel

From `apps/remote`, in your new terminal:

```bash
npm run dev:tunnel:cloudflare
```

Leave this running too.
The output will show a public tunnel URL such as
`https://random-subdomain.trycloudflare.com/`.

Set the Public Relay's backend URL to this tunnel URL.
If you used a quick tunnel, you can do this in the Cloudflare Workers dashboard
under the `relay` Worker's environment variables:

```text
BACKEND_URL=https://random-subdomain.trycloudflare.com/
```

For a more durable setup, create a named Cloudflare Tunnel
and set `BACKEND_URL` to that tunnel's public hostname.

Open a third terminal for the rest of this tutorial.

## 10. Deploy and install the Forge app

From the repository root:

```bash
npm run forge:deploy
npm run forge:install
```

The first command uploads the app to Forge's development environment.
The second installs it on the Jira site you set in `SITENAME`.
Keep the remote backend, tunnel, and relay running while you install.
If deploy fails because the Forge app cannot be found or accessed,
go back to step 7 and register this clone with your Forge account.
`forge install` sends the Forge installed lifecycle event
to `/atlassian/installed`,
and the backend stores the Jira site installation record it needs
for later agent requests.

If you deleted the local `database/` directory,
changed the tunnel URL,
or need a fresh install lifecycle event for this sample,
uninstall and install again:

```bash
npm run forge:uninstall
npm run forge:install
```

The uninstall command removes the current Jira app installation.
The next install sends the lifecycle event again
so the backend can recreate its per-install state.

## 11. Assign a work item to the agent

In your Jira site,
create an issue with the summary **"Fix the login bug"**
and assign it to the sample agent
(named **Jira Agent Assignment** in this sample's manifest).
Exactly how you invoke a remote agent from the Jira UI is covered by
[Integrate remote agents with Jira](https://developer.atlassian.com/platform/forge/remote-agents-in-jira/);
follow that guide for the current EAP interaction pattern.

Once the agent picks up the task,
watch its status change in Jira.
Because the summary contains "fix the login bug,"
the sample's A2A Simulator matches the `coding-agent-happy-path` scenario,
and you should see the task move through `working`,
stream a few progress messages,
produce an artifact,
and finish `completed`.

## What you just built

You now have four long-running pieces working together:
a remote backend your machine is running,
a Cloudflare Tunnel exposing it,
a Public Relay keeping the A2A surface always available,
and a Forge app bridging that relay to a real Jira site.
And you've watched a task flow through all of them, end to end,
without changing a line of code.
That's the baseline every later code change in this repository builds on:
if something breaks after an edit,
you now know what "not broken" looked like.

## Next

- [Tutorial: Observe Interactive Markdown in Jira](observe-interactive-markdown.md) — invoke the interactive Markdown showcase.
- [Tutorial: Edit a Simulation Scenario](edit-a-simulation-scenario.md) —
  now that the sample is running, change what it streams by editing a YAML
  file instead of code.
- [How-to: Diagnose FIT auth failures][fit-auth-failures] —
  for when step 10 or step 11 doesn't behave as expected.

[fit-auth-failures]: ../how-to-guides/diagnose-fit-auth-failures.md
