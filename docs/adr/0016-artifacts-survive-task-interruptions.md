# Artifacts Survive Task Interruptions and Cancellation

Artifacts emitted before `input-required`, `auth-required`, or `canceled` remain attached to the same task. Artifacts are outputs of the task, not of a single uninterrupted execution segment, so retaining them preserves the review trail across user clarification, authorization pauses, and cancellation.
