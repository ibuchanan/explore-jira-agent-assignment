# Tutorial: Edit a Simulation Scenario

In this tutorial, you will change the Markdown showcase scenario and use the
remote test suite to observe that the stream contract changed. The simulator
runs entirely locally; a Jira site and Forge deployment are not required.

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

The suite includes a streaming test for the Markdown showcase. It passes when
the scenario produces its expected updates in order.

## 3. Open the showcase scenario

Open [`apps/scenarios/markdown-happy-path.yaml`](../../apps/scenarios/markdown-happy-path.yaml).

Find this update:

```yaml
- event: status-update
  message: "**Bold text** and *italic text* appear in this update."
  delayMs: 5000
```

## 4. Change the demonstrated text

Replace `Bold text` with `Strong text`, then save the file:

```yaml
- event: status-update
  message: "**Strong text** and *italic text* appear in this update."
  delayMs: 5000
```

## 5. Run the tests again

```bash
npm run --workspace=rovo-agent-connector-remote-backend test
```

The Markdown showcase test now fails because it expects the original `Bold
text` update. The test proves the scenario is loaded and its event sequence is
observable through the A2A endpoint.

## 6. Restore the scenario

Restore the original phrase, or discard the experiment:

```bash
git checkout -- apps/scenarios/markdown-happy-path.yaml
```

Run the remote tests once more. They pass after the expected event text is
restored.

## Next

- [`apps/scenarios/README.md`](../../apps/scenarios/README.md) describes the scenario fields.
- [How to diagnose FIT auth failures](../how-to-guides/diagnose-fit-auth-failures.md) addresses authenticated remote requests.
- [How a Jira remote agent connector works](../explanation/rovo-agent-connector.md) explains the Forge extension point behind the simulator.
