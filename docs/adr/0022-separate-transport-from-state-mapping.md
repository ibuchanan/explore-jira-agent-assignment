# Separate Transport From State Mapping

The streaming spec separates transport behavior from state and content mapping, including the success criteria. Transport behavior covers streaming versus polling, SSE payload encoding, `tasks/resubscribe`, cancellation ordering, and resumption ordering. State and content mapping covers how Remote Agent Signals become A2A task states, messages, and artifacts. This keeps implementation and testing concerns distinct.
