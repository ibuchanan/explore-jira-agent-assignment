# Simulation Scenario Sessions Use a Sans-IO Core

A Simulation Scenario Session is one task's execution of one matched Simulation Scenario. Session policy lives in a pure core that returns value effects for applying scenario steps, scheduling later steps, closing streams, and coordinating cancellation. The core owns playback cursor policy, first-step folding, pause/final stopping, resubscribe continuation, cancellation sequencing, and delay scheduling as values. It does not know about Express, SSE, JSON-RPC, storage, logging, real timers, headers, or `setTimeout`.

The remote app keeps those side effects in an adapter/runtime shell. The runtime mutates stored tasks through the adapter, writes context history, manages active streams, starts and clears timers, and emits SSE payloads through server-owned formatting. Persisted session state remains intentionally small: the matched `scenarioId` and the task-local `nextStepIndex`. We are deferring a separate Scenario Catalog until a second consumer or stronger discovery needs prove that the concept belongs outside `apps/remote`.

This keeps scenario behavior directly testable without mocks while preserving the existing A2A JSON-RPC and SSE behavior at the boundary.
