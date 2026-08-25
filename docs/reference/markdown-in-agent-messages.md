# Reference: Markdown in Agent Messages

## Scope

The remote sends agent status-message and artifact text parts with the media type
`text/markdown`. Jira owns Markdown rendering; this repository does not define
a supported Markdown subset, rendering result, sanitization policy, or fallback
behavior.

## Message parts

| Outbound content | A2A construction | Media type |
| --- | --- | --- |
| Status update message | `agentMessage()` in `apps/remote/src/server.ts` | `text/markdown` |
| Artifact text part | `artifact()` in `apps/remote/src/server.ts` | `text/markdown` |

Scenario `message` and `artifact.parts[].text` values are forwarded as text.
The scenario format does not parse, validate, or transform Markdown.

## Markdown happy-path scenario

`apps/scenarios/demo-markdown.yaml` is a renderer-observation scenario.
It is selected when the starting message contains `show markdown`. Its updates
exercise these ordinary Markdown constructs:

| Status update | Construct |
| --- | --- |
| Start | Heading |
| Emphasis | Bold and italic text |
| List | Unordered list |
| Plan | Ordered list |
| Quote | Blockquote |
| Inline code | Inline code span |
| Code sample | Fenced code block |
| Link | Markdown link |
| Completion | Task list |

Each update is a `status-update`; the scenario emits no artifacts, callbacks,
or error cases. It is intended to observe the presentation produced by the
Jira client, not to assert that Jira supports every construct.

## Related implementation

- [`apps/scenarios/README.md`](../../apps/scenarios/README.md) — scenario
  fields and playback behavior
- [`apps/scenarios/demo-markdown.yaml`](../../apps/scenarios/demo-markdown.yaml)
  — demonstration data
- [`apps/remote/src/server.ts`](../../apps/remote/src/server.ts) — A2A message
  and artifact construction
