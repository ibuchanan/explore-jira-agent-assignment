# Reference: A2A JSON-RPC Endpoint

Technical description of the remote backend's Agent2Agent-inspired
JSON-RPC endpoint: request shape, supported methods, task states,
streamed event kinds, and error codes. Implemented in
[`apps/remote/src/server.ts`](../../apps/remote/src/server.ts).

## Endpoint

| Property | Value |
| --- | --- |
| Path | `/a2a/json-rpc` |
| HTTP method | `POST` |
| Request body | JSON-RPC 2.0 envelope |
| Response (default) | single JSON-RPC 2.0 response |
| Response (`Accept: text/event-stream`) | Server-Sent Events, one `data:` line per streamed event |

## Request headers

| Header | Required | Purpose |
| --- | --- | --- |
| `Authorization` | Yes | `Bearer <FIT>`. Verified by `authMiddleware`. |
| `Content-Type` | Yes | `application/json` |
| `Accept` | No | `text/event-stream` selects streaming behavior for `message/send`. |
| `x-forge-oauth-system` | No | Present when the Forge manifest enables app system token forwarding. |
| `x-forge-oauth-user` | No | Present when the Forge manifest enables app user token forwarding. |

## Methods

| Method | Transport | Params | Returns |
| --- | --- | --- | --- |
| `message/send` | Polling (default `Accept`) | Message payload, optional `contextId`, optional `taskId` for resumption | A `Task` object |
| `message/send` | Streaming (`Accept: text/event-stream`) | Same as above | Stream of `task-state-update`, `content-update`, and `artifact-update` events |
| `tasks/get` | Polling | `id`, optional `historyLength` | A `Task` object |
| `tasks/cancel` | Polling | `id` | A `Task` object in a terminal state |
| `tasks/resubscribe` | Streaming | `id` | Current task snapshot, then remaining events for an active task |

`tasks/get`, `tasks/cancel`, and `tasks/resubscribe` use the standard A2A `id`
param (Jira's actual wire shape), not `taskId`. The handlers also accept a
`taskId` param for backward compatibility.

## Task object

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | Task identifier. |
| `contextId` | string | Identifier for the private user-agent context the task belongs to. |
| `state` | enum | One of the A2A task states below. |
| `status.message` | string | Current user-facing status text. |
| `artifacts` | array | Artifacts emitted for this task, if any. |

## A2A task states

| State | Terminal | Meaning |
| --- | --- | --- |
| `submitted` | No | Task created; not yet accepted into execution. |
| `working` | No | Task is actively executing. |
| `input-required` | No | Execution paused; a user decision or clarification about the work is needed. |
| `auth-required` | No | Execution paused; a user authorization or permission grant is needed. |
| `completed` | Yes | Task finished successfully. |
| `failed` | Yes | Task was accepted but could not complete. |
| `rejected` | Yes | Task was refused or could not be accepted before execution began. |
| `canceled` | Yes | Task stopped because Jira or the user requested cancellation. |
| `unknown` | Yes | Exceptional fallback for missing or invalid observed state; not intentionally emitted during normal execution. |

## Streamed event kinds

Applies to streaming `message/send` and `tasks/resubscribe`.

| `kind` | Wire event | Carries |
| --- | --- | --- |
| `task-state-update` | `TaskStatusUpdateEvent` | A task state from the table above, with an associated status message. |
| `content-update` | `TaskStatusUpdateEvent.message` | Incremental content with no lifecycle change: Thinking Process, Internal Thinking, or Tool Activity text. |
| `artifact-update` | `TaskArtifactUpdateEvent` | An artifact, optionally chunked via `append` and `lastChunk`. |

## JSON-RPC error codes

| Error | Code |
| --- | --- |
| Task not found | `-32001` |
| Task cannot be canceled from current state | `-32002` |
| Context not found | `-32003` |
| Method not found | `-32601` |
| Invalid JSON-RPC request | `-32600` |
| Unhandled server error | `-32603` |

## Response envelope

```json
{
  "jsonrpc": "2.0",
  "id": "request-id",
  "result": {
    "kind": "task"
  }
}
```

Errors are returned as JSON-RPC error objects using the codes above rather
than as `result` values.

## Related docs

- [`apps/remote/README.md`](../../apps/remote/README.md#main-endpoints) —
  narrative description of these endpoints alongside installation and
  debug-only routes
- [`CONTEXT.md`](../../CONTEXT.md) — definitions for the vocabulary used in
  this reference (Task State Update, Content Update, Artifact, and related
  terms)
- [`specs/streaming-agent-states.md`](../../specs/streaming-agent-states.md) —
  the provider-neutral mapping this contract implements
- [How to diagnose FIT auth failures](../how-to-guides/diagnose-fit-auth-failures.md) —
  troubleshooting requests that fail before reaching these methods
