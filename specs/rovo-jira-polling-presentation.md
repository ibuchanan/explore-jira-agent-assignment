# Specification: Jira polling presentation policy

<!-- cspell:ignore a2aproject -->

## Goal

Add a small, framework-neutral Jira/Rovo policy to `@forge-ahead/remote`.
It must preserve the initial task event of a normal Jira polling A2A request
while allowing later transient progress to be compacted for presentation.

The library must remain sans-I/O. It must not own an A2A server, HTTP or SSE
responses, task storage, executors, or application logging.

## Evidence from the consumer

This specification was extracted from `explore-rovo-agent-connector` on
2026-08-24. It contains the observed evidence required to work in the library
repository without access to the consumer repository or its runtime logs.

### Failure signature

Jira issued a normal A2A JSON-RPC `SendMessage` through Forge Remote and showed
its generic technical-error message. Jira backend logs contained an
`A2AClientHTTPError: Request failed with HTTP 500` originating at
`org.a2aproject.sdk.client.transport.jsonrpc.JSONRPCTransport`.

The remote service used `@a2a-js/sdk` `^1.0` for JSON-RPC task delivery and
`@forge-ahead/remote` for Forge Invocation Token authentication and context.

A transport-aware polling projection changed this active sequence:

```text
working("Progress")
input-required("Continue")
```

into this sequence:

```text
input-required("Progress\n\nContinue")
```

The transformation removed the first published task event. In the normal Jira
polling flow, the A2A SDK did not complete the HTTP response. Jira ultimately
reported the request as a 500.

The consumer's complete remote suite hung at the polling Markdown checkpoint.
The actual SDK server had dispatched the request but did not log request
completion. Restoring the initial event made the request finish with HTTP 200;
the compiled remote suite then passed: **38 tests, 0 failures**.

The compatible projection is:

```text
working("Progress")
input-required("Progress\n\nContinue")
```

It retains the compacted prompt while preserving the initial task event.

### Scope

This does not claim that A2A universally forbids initial `input-required`.
The consumer's explicit immediate-return initial-input scenario passes. The
failure is specific to normal Jira polling when projection removes the first
progress/task event from an otherwise active task flow. Streaming was not
affected because it preserves the source sequence.

## Proposed API

Add a pure helper under the existing `@forge-ahead/remote/rovo` boundary. Use
existing exported task-event or signal types if available; the generic below
only shows the required sequence transformation.

```ts
export type RovoTaskPresentationTransport = "polling" | "streaming";

export type RovoPollingPresentationOptions = {
  /** True for an intentionally immediate paused response. */
  returnImmediately?: boolean;
};

export function projectRovoTaskEvents<Event>(
  events: readonly Event[],
  transport: RovoTaskPresentationTransport,
  options?: RovoPollingPresentationOptions,
): Event[];
```

A complementary future API may validate a caller-owned plan:

```ts
export function validateRovoPollingTaskPlan(
  events: readonly RemoteAgentSignal[],
  options?: RovoPollingPresentationOptions,
): Result<void, ProblemDetails>;
```

Prefer the projector initially: it gives consumers a safe default. A validator
can follow when clients implement their own presentation code.

## Required behavior

### Streaming

Return the source event sequence unchanged. Do not alter streaming timing or
meaningful event order.

### Normal polling

The projector may compact adjacent transient `working → input-required` and
`working → auth-required` pairs when both messages are safely mergeable.

For each compacted pair:

- retain the pause/authentication event's state and fields;
- combine text in source order with a blank line;
- retain `working` when it is the first source event; and
- omit a later transient `working` only after the task is established.

```text
source:
  working("Progress")
  input-required("Continue")
  completed("Done")

polling presentation:
  working("Progress")
  input-required("Progress\n\nContinue")
  completed("Done")
```

### Immediate return

Do not invent `working` when a caller explicitly requests an immediate paused
response. That interaction has separate request semantics and needs separate
compatibility coverage.

### Safety

- Never mutate source events or nested message values.
- Do not compact absent or non-mergeable messages.
- Preserve task IDs, context IDs, artifacts, terminal states, and ordering.
- Do not use presentation to make an invalid lifecycle appear valid. Existing
  state-transition validation remains authoritative.

## Non-goals

Do not wrap `@a2a-js/sdk` handlers; own Express, JSON-RPC, HTTP, or SSE;
persist tasks; choose transport from a Forge manifest; or define universal A2A
semantics. Those responsibilities belong to the consumer service, SDK, or
product integration.

## Implementation plan

1. Inspect current `@forge-ahead/remote/a2a` exports and reuse task-event and
   transition types.
2. Add the pure projector in the `rovo` module near Jira/Rovo validation and
   response formatting.
3. Make transport explicit; do not infer it from global state, HTTP, or SDK
   internals.
4. Model the first-event rule in this shared helper instead of duplicating it
   in clients.
5. Document that this is Jira/Rovo polling compatibility, not a universal A2A
   constraint.

## Acceptance criteria

### Unit tests

- Streaming returns an equivalent sequence.
- Initial `working → input-required` retains the initial working event and
  merges its text into the input-required event.
- A later `working → input-required` pair may be compacted.
- `working → auth-required` uses the same safeguard if it shares this policy.
- Non-adjacent, non-working, missing-message, artifact-bearing, and terminal
  transitions are not compacted.
- Source objects are unchanged.
- Explicit immediate-return initial pauses are preserved without added working.

### SDK compatibility test

Outside the pure library, issue a real `@a2a-js/sdk` JSON-RPC `SendMessage`
with normal Jira-compatible polling settings. Assert that the request resolves
within a bounded timeout, returns HTTP 200, reports the paused state, and
contains the merged progress text. This protects the boundary where the defect
occurred.

## Rollout

Release the helper as additive API. Migrate consumer-local polling compaction
to it, while retaining the consumer black-box SDK test. If Jira or the A2A SDK
behavior changes, revise the compatibility test and policy only from new
observed evidence.
