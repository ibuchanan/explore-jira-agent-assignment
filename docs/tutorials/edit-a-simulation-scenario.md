# Tutorial: Edit a Simulation Scenario

In this tutorial, you will change the Markdown showcase scenario and use the
remote test suite to observe that its first interactive update changed. The
simulator runs entirely locally; a Jira site and Forge deployment are not
required.

## 1. Install dependencies

From the repository root, install the workspace dependencies:

```bash
npm install
```

## 2. Run the remote tests

Run the remote backend test suite:

```bash
npm run --workspace=rovo-agent-connector-remote-backend test
```

The suite includes a polling test for the Markdown showcase. It passes when
the simulator combines the source heading with the input prompt in the task
snapshot Jira retrieves.

## 3. Open the showcase scenario

Open [`apps/scenarios/demo-markdown.yaml`](../../apps/scenarios/demo-markdown.yaml).

Find this update:

```yaml
- event: status-update
  state: working
  message: "# Markdown showcase"
```

## 4. Change the demonstrated heading

Replace `Markdown showcase` with `Markdown tour`, then save the file:

```yaml
- event: status-update
  state: working
  message: "# Markdown tour"
```

## 5. Run the tests again

```bash
npm run --workspace=rovo-agent-connector-remote-backend test
```

The Markdown showcase test now fails because it expects the original
`Markdown showcase` heading. The test proves the scenario is loaded and its
first interactive event is observable through the A2A endpoint.

## 6. Restore the scenario

Restore the original phrase, or discard the experiment:

```bash
git checkout -- apps/scenarios/demo-markdown.yaml
```

Run the remote tests once more. They pass after the expected event text is
restored.

## Next

- [`apps/scenarios/README.md`](../../apps/scenarios/README.md) describes the
  scenario fields.
- [How to diagnose FIT auth failures](../how-to-guides/diagnose-fit-auth-failures.md)
  addresses authenticated remote requests.
- [How a Jira remote agent connector works](../explanation/rovo-agent-connector.md)
  explains the Forge extension point behind the simulator.
