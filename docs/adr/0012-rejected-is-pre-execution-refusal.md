# Rejected Is Pre-Execution Refusal

The Reference Implementation uses `rejected` when the Remote Agent refuses or cannot accept a task before execution begins, and `failed` when an accepted task encounters an unrecoverable execution problem. This keeps terminal states meaningful: rejection is acceptance semantics, while failure is execution semantics.
