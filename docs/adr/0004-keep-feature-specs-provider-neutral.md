# Keep Feature Specs Provider Neutral

The feature specs describe Jira remote-agent integration behavior in terms of Remote Agents rather than any specific model provider. This keeps the repository useful as a reference implementation for integrating Jira with any implementing agent runtime, while still allowing provider-specific executor code to map its own runtime signals into the shared A2A task and streaming model.
