# Task Outputs Use A2A Artifacts

Anything intended as a Jira/user-reviewable task output is emitted as an A2A Artifact through `TaskArtifactUpdateEvent`. Tool Activity remains status/message content unless the agent intentionally produces a task output. This aligns the reference implementation with A2A's distinction between communication in messages and results in artifacts, and with Jira's streaming contract.
