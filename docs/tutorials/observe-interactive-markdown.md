# Tutorial: Observe Interactive Markdown in Jira

In this tutorial, you will invoke the Markdown showcase scenario in Jira and
reply to each prompt as the same task remains in `input-required` until it
completes. By the end, you will have observed headings, emphasis,
lists, a blockquote, inline code, a code block, and a link in the agent panel.

Before starting, complete [Tutorial: Run the Sample End-to-End](run-the-sample-end-to-end.md).
Leave the remote service and the tunnel/deployment process running.

## 1. Open the agent

Open Jira on the site where you installed **Agent Simulator**. Open the Rovo
experience that lets you send the agent a message.

## 2. Start the Markdown showcase

Send this message:

```text
Please show markdown
```

The agent displays the **Markdown showcase** heading in an **Input required**
prompt.

## 3. Continue through the examples

At each **Input required** prompt, reply with:

```text
Continue
```

After each reply, inspect the next rendered update before replying again. You
will see these examples in order:

1. Bold and italic text.
2. An unordered list.
3. An ordered list.
4. A blockquote.
5. Inline code.
6. A TypeScript code block.
7. A link to the A2A protocol.

Each example is part of the next `input-required` prompt, where it remains
visible until you send the next reply.

## 4. Observe completion

Reply **Continue** after the prompt following the code block. The agent shows
the link example and completes the task with this checklist:

```markdown
- [x] Markdown updates sent
- [x] Showcase complete
```

## What you accomplished

You used one task across multiple user replies. Each `input-required` prompt
contained one Markdown construct, and the task finished in `completed` with a
Markdown result.

## Next

- [Tutorial: Edit a Simulation Scenario](edit-a-simulation-scenario.md) shows how to change a scenario locally.
- [Simulation scenarios](../../apps/scenarios/README.md) lists the available scenario fields.
- [How a Jira remote agent connector works](../explanation/rovo-agent-connector.md) explains the connector architecture.
