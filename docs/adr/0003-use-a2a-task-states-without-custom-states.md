# Use A2A Task States Without Custom States

The streaming state model adheres to the formal A2A-compatible task states used by Jira remote agents and does not introduce custom task states for feature-specific interactions. Feature language such as Tool Approval maps to the existing `auth-required` task state, keeping the protocol compatible with A2A/Jira semantics while still allowing product-specific interaction details to appear in streamed content.
