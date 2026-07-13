# Tutorial: Run the Sample End-to-End

In this tutorial 
you will bring up every piece of this sample in order: 
the remote backend, 
a public tunnel to it, 
and the Forge app that connects it to a real Jira Cloud site. 
By the end, you will have assigned a Jira work item 
to the sample agent and watched it run.

You will not edit any code in this tutorial. 
The point is to get a known-good baseline running first, 
so that you know every piece works 
and you'll notice immediately if something you touched breaks it.

## Prerequisites

Get these three things ready before you start. 
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
- **A zrok account, enabled on this machine.** 
  This sample tunnels the remote backend to a public HTTPS URL using
  [zrok](https://docs.zrok.io/docs/getting-started/).
  Sign up,
  then run `zrok enable <your-token>` once.
  Strictly speaking,
  `zrok` is not a requirement,
  but tunneling to a local dev environment is.

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

## 4. Configure the remote backend

Copy the environment file:

```bash
cp apps/remote/.env.example apps/remote/.env
```

Open `apps/remote/.env` and set:

```bash
export PORT=3000
export HOSTNAME=your-chosen-name
```

Choose a `HOSTNAME` with lowercase letters, 
numbers,
and hyphens only.

## 5. Create a public tunnel name

The remote backend needs a stable public HTTPS URL 
that Jira's Forge platform can reach.
Create one now from `apps/remote`:

```bash
npm run dev:tunnel:create
```

This command uses the `HOSTNAME` you set in step 4.
The name persists across restarts;
you only do it once.
Your tunnel's public address will be `https://your-chosen-name.share.zrok.io/`.
Keep that address; 
you'll use it in the next step.

## 6. Configure the Forge app

Copy the environment file:

```bash
cp apps/forge/.env.example apps/forge/.env
```

Open `apps/forge/.env` and set:

```bash
export HOSTNAME=your-chosen-name
export SITENAME=your-site-name
export REMOTE_SERVICE_URL=https://$HOSTNAME.share.zrok.io/
```

`HOSTNAME` must match the value in `apps/remote/.env`.
`SITENAME` is your Jira site name without `.atlassian.net`.
`REMOTE_SERVICE_URL` expands to the tunnel address from step 5
when the Forge script loads this file.

## 7. Start the remote backend

From the repository root:

```bash
npm run dev:remote
```

You'll see:

```text
No data file found, starting fresh
Remote agent backend service running on port 3000
Endpoints:
  - POST /atlassian/installed
  - POST /a2a/json-rpc
  - POST /atlassian/config
  - POST /tasks/:taskId/advance
```

Leave this running. 
Open a new terminal for the next step.

## 8. Start the tunnel

From `apps/remote`, in your new terminal:

```bash
npm run dev:tunnel
```

Leave this running too. 
Your local port 3000 is now reachable at
`https://your-chosen-name.share.zrok.io/`. 
Open a third terminal for the rest of this tutorial.

## 9. Deploy and install the Forge app

From the repository root:

```bash
npm run forge:deploy
npm run forge:install
```

The first command uploads the app to Forge's development environment.
The second installs it on the Jira site you set in `SITENAME`.
Keep the remote backend and tunnel running while you install.
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

## 10. Assign a work item to the agent

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

You now have three long-running pieces working together:
a remote backend your machine is running, 
a public tunnel exposing it, 
and a Forge app bridging that tunnel to a real Jira site.
And you've watched a task flow through all three, end to end, 
without changing a line of code.
That's the baseline every later code change in this repository builds on: 
if something breaks after an edit, 
you now know what "not broken" looked like.

## Next

- [Tutorial: Edit a Simulation Scenario](edit-a-simulation-scenario.md) —
  now that the sample is running, change what it streams by editing a YAML
  file instead of code.
- [How-to: Diagnose FIT auth failures](../how-to-guides/diagnose-fit-auth-failures.md) —
  for when step 9 or step 10 doesn't behave as expected.
- [Reference: A2A JSON-RPC endpoint](../reference/a2a-json-rpc-endpoint.md) —
  the wire contract behind what you just watched stream.
- [Explanation: Why this sample has three separate layers](../explanation/why-three-layers.md) —
  the reasoning behind the Forge app / remote backend / A2A Simulator split
  you just stood up.
