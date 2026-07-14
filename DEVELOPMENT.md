# Development

Use this guide after the root README quickstart when you are changing code,
checking a contribution, or need the repository map.

For collaboration rules and CLA details, see [CONTRIBUTING.md](CONTRIBUTING.md).

## Prerequisites

- Node.js and npm matching [`.nvmrc`](.nvmrc), currently Node 24.
- Dependencies installed from the repository root with `npm install`.
- Forge CLI authentication for the Atlassian account you use to deploy and
  install the sample.
- A Jira Cloud development site where you can install Forge apps.
- A zrok account enabled on this machine if you use the sample tunnel scripts.
- Local environment files copied from `apps/remote/.env.example` and
  `apps/forge/.env.example`.

## First-Time Forge Registration

When you clone or inherit this repo, the Forge app ID in
`apps/forge/manifest.yml` may belong to someone else's developer space.
If `forge deploy` cannot find or access that app, register your local clone
once:

```bash
npm run forge:register
```

That command creates a Forge app in your own developer space and writes the new
app ID back to `apps/forge/manifest.yml`. This is expected for cloned Forge
apps. Do not run it repeatedly unless you intentionally want a new Forge app
registration, because each run disconnects the local manifest from the previous
app's environments, variables, storage, and installs.

Treat the resulting manifest change as local developer setup. Do not include a
personal app ID change in an unrelated pull request unless maintainers ask for
it.

## Inner Development Loop

The usual local loop uses three terminals:

1. Start the remote backend from the repository root:

   ```bash
   npm run dev:remote
   ```

2. Start the public tunnel from `apps/remote`:

   ```bash
   npm run dev:tunnel
   ```

3. Deploy or reinstall the Forge app from the repository root:

   ```bash
   npm run forge:deploy
   npm run forge:install
   ```

Keep the backend and tunnel running while installing. The install lifecycle
event is routed to `/atlassian/installed`, where the backend stores the Jira
site installation record used by later remote-agent requests.

If you delete local backend state, change the public tunnel URL, or need to
replay the install lifecycle event for this sample, run:

```bash
npm run forge:uninstall
npm run forge:install
```

## Repository Layout

```text
├── apps/
│   ├── forge/          # Forge app for the Jira agent connector
│   └── remote/         # Express backend for install and JSON-RPC requests
├── packages/
│   └── forge-ahead/    # Shared Forge, FIT, manifest, and agent helpers
├── docs/
│   ├── tutorials/      # learning-oriented lessons
│   ├── how-to-guides/  # goal-oriented troubleshooting and tasks
│   ├── reference/      # wire contracts and other lookup facts
│   ├── explanation/    # design reasoning
│   └── adr/            # individual architecture decision records
└── specs/              # provider-neutral feature specs
```

## Key Files

- `apps/forge/manifest.yml` - Forge modules, remotes, scopes, and triggers.
- `apps/remote/src/server.ts` - remote installation and task endpoints.
- `apps/remote/src/auth.ts` - FIT validation middleware for Forge remotes.
- `apps/remote/scenarios/` - editable Simulation Scenario YAML files.
- `packages/forge-ahead/src/` - reusable helpers and types used by the sample.

See [`apps/forge/README.md`](apps/forge/README.md#source-files) and
[`apps/remote/README.md`](apps/remote/README.md) for the current, more detailed
file breakdown for each workspace.

## Common Commands

Run these from the repository root unless noted otherwise.

| Command | Purpose |
| --- | --- |
| `npm run build` | Build all packages and apps. |
| `npm run test` | Run tests across workspaces. |
| `npm run lint` | Lint workspaces. |
| `npm run typecheck` | Run TypeScript checks across workspaces. |
| `npm run format:check` | Check formatting across workspaces. |
| `npm run dev:remote` | Start the remote backend development flow. |
| `npm run forge:register` | Register a cloned Forge app into your developer space. |
| `npm run forge:deploy` | Deploy the Forge app workspace. |
| `npm run forge:install` | Install the Forge app workspace and send the installed lifecycle event to the backend. |
| `npm run forge:uninstall` | Uninstall the Forge app workspace so a later install can recreate backend install state. |

See the root and workspace `package.json` files for the full script list.

## Validation

Before opening a pull request, run the narrowest checks that cover your change.
For broad changes, use the root checks:

```bash
npm run build
npm run test
npm run lint
npm run typecheck
npm run format:check
```

For focused changes, run the relevant workspace script directly. For example,
remote backend changes can usually start with:

```bash
cd apps/remote
npm run test
npm run typecheck
```

After manifest changes, run the Forge workspace lint because it includes
`forge lint`.

## Simulation Scenarios

The remote backend's streamed behavior is driven by editable YAML Simulation
Scenarios under `apps/remote/scenarios/`. Edit those files to change streamed
demo behavior without changing TypeScript.

Useful starting points:

- [`apps/remote/scenarios/README.md`](apps/remote/scenarios/README.md)
- [Tutorial: Edit a Simulation Scenario](docs/tutorials/edit-a-simulation-scenario.md)
- `apps/remote/tests/a2a-json-rpc.test.ts`

## Contribution Checklist

- Keep unrelated changes in separate pull requests.
- Add or update tests for behavior changes.
- Run the relevant checks before asking for review.
- Do not commit `.env` files, local logs, local database state, or personal
  Forge app registration changes unless the PR is specifically about them.
- Follow [CONTRIBUTING.md](CONTRIBUTING.md) for issue discussion and CLA
  requirements.
