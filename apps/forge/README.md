# Forge App for the Remote Agent

This workspace contains
the Forge app used by the sample remote-agent integration.
The app is the Atlassian-facing installable component:
it declares the Jira remote agent connector,
wires Jira task traffic to a remote backend,
and configures the scopes and remote permissions needed by the integration.

## Responsibilities

The Forge app demonstrates how to:

- register a Jira remote agent through a `rovo:agentConnector` module
- route Agent2Agent-inspired JSON-RPC traffic to the remote backend
- route Forge installation lifecycle events to the remote backend
- request app system and app user token forwarding for the remote service
- declare the Jira scopes required by the sample

This app is middleware.
It does not run the actual external AI agent;
that belongs in the remote backend or an agent runtime called by the backend.

## Architecture role

```text
Jira Cloud
  │
  │ invokes the installed remote agent connector
  ▼
Forge app
  │
  ├─ manifest declares agent connector, endpoints, remote, scopes, and tokens
  ├─ endpoint modules proxy task traffic to the backend remote
  └─ installation trigger delivers lifecycle events to the backend remote
  ▼
Remote backend service
```

The main source of truth for Forge wiring is [`manifest.yml`](manifest.yml).
