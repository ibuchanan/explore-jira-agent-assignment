# Build a General A2A Simulator

The scenario runner should be a general A2A Simulator rather than a Jira-only or coding-agent-only fake. Jira remote-agent and coding-agent behavior are important initial scenarios, but the reusable component should emit explicit A2A-compatible task, status, message, and artifact updates from editable scenarios so implementers can try A2A state and streaming behavior directly.
