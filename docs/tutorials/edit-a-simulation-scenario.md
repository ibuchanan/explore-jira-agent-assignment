# Tutorial: Edit a Simulation Scenario and Watch a Check Catch a Mistake

In this tutorial 
you will run the sample's automated checks against a Simulation Scenario, 
make a small edit to that scenario's YAML, 
and watch the checks react to your change. 
By the end you will have seen 
how the streamed behavior of the sample's simulated remote agent 
is driven entirely by data files rather than by application code.

You do not need a Jira site, 
a Forge deployment, 
or any account for this tutorial. 
Everything happens on your own machine.

## 1. Install dependencies

From the repository root, run:

```bash
npm install
```

This installs dependencies for every workspace, including `apps/remote`,
which is where you'll be working.

## 2. Run the checks and see them pass

Move into the remote backend workspace:

```bash
cd apps/remote
```

Now run one test file with verbose output:

```bash
npx vitest run tests/coding-agent-happy-path.test.ts --reporter=verbose
```

You'll see a list of passing checks, including:

```text
✓ streams a Thinking Process summary as an ordinary progress message with no special label
✓ streams Internal Thinking as separately labeled plain text, distinct from the Thinking Process message
✓ streams Tool Activity as status content with light labels for invocation and result, in order
```

Each of these checks reads a single Simulation Scenario and inspects the
events it produces. You just confirmed, without reading any application
code, that the scenario behind this test does everything the names
describe.

## 3. Open the scenario the checks are reading

The test file you just ran always loads the same scenario file. Open it:

```bash
apps/remote/scenarios/coding-agent-happy-path.yaml
```

Find the step whose `message` starts with `Internal thinking:`. It looks
like this:

```yaml
- event: status-update
  message: "Internal thinking: considering two possible fixes before picking one."
  delayMs: 20
```

That one line of YAML is the entire reason the second check in step 2
passed.

## 4. Make a small edit

Change the message text, but keep the `Internal thinking:` prefix, for
example:

```yaml
- event: status-update
  message: "Internal thinking: this text now says something different."
  delayMs: 20
```

Save the file.

## 5. Re-run the checks

From `apps/remote`, run the same command again:

```bash
npx vitest run tests/coding-agent-happy-path.test.ts --reporter=verbose
```

Everything still passes. The check only looks for the `Internal thinking:`
prefix and its position relative to the Thinking Process message, not the
exact wording, so your edit was invisible to it.

## 6. Break the convention on purpose

Now remove the prefix entirely, leaving only the sentence:

```yaml
- event: status-update
  message: "This text now says something different."
  delayMs: 20
```

Save the file and run the checks one more time:

```bash
npx vitest run tests/coding-agent-happy-path.test.ts --reporter=verbose
```

This time you'll see a failure:

```text
✗ streams Internal Thinking as separately labeled plain text, distinct from the Thinking Process message
```

You just watched an automated check catch the exact mistake it exists to
catch: a scenario step that stopped labeling its Internal Thinking content.

## 7. Put the file back

Revert your edits so the repository is clean again:

```bash
git checkout -- scenarios/coding-agent-happy-path.yaml
```

## What you just learned

You changed the sample's simulated remote agent behavior twice, and broke
one of its conventions on purpose, without writing or touching any
TypeScript. The `.yaml` files under `apps/remote/scenarios/` are the whole
control surface for what the A2A Simulator streams.

## Next

- [How-to: Diagnose FIT auth failures](../how-to-guides/diagnose-fit-auth-failures.md)
  for a task-focused guide once you're working with a real Forge/Jira
  connection.
- [Reference: A2A JSON-RPC endpoint](../reference/a2a-json-rpc-endpoint.md)
  for the wire contract the events you just saw are eventually mapped onto.
- [Explanation: Why this sample has three separate layers](../explanation/why-three-layers.md)
  for the reasoning behind keeping the simulator data-driven and separate
  from the Forge app and remote backend's other responsibilities.
- [`apps/remote/scenarios/README.md`](../../apps/remote/scenarios/README.md)
  documents every scenario field you saw here, plus how scenarios are
  matched and validated.
