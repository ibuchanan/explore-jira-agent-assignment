# Follow Jira Resubscribe Without a Custom Event Store

The reference implementation follows Jira's existing `tasks/resubscribe` behavior and does not add a custom event-store or replay-cursor contract for streamed A2A-visible events. Runtime logging remains an observability aid, not a durable replay API. This keeps the reference integration aligned with Jira's implemented remote-agent behavior instead of creating storage obligations that Jira does not require.

Post-hoc implementation note: continuing a Simulation Scenario after `tasks/resubscribe` still requires internal task-local progress state. The shipped simulator stores `nextStepIndex` on the task so a new SSE connection can continue without replaying already-applied scenario steps. That cursor is not a Jira-visible replay cursor or durable event-store contract.
